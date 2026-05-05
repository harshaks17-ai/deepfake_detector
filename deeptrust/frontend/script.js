// ══════════════════════════════════════════════
//  DEEPTRUST — Full Application Script (clean)
// ══════════════════════════════════════════════

// ── STATE ──────────────────────────────────────
let pc = null;
let localStream = null;
let remoteStream = null;
let callStartTime = null;
let callTimerInterval = null;
let micEnabled = true;
let camEnabled = true;
let ws = null;
let currentRoom = null;
let iceQueue = [];

// Jitter analysis state
let prevLandmarks = null;
let blinkEvents = [];
let motionHistory = [];
let scoreHistory = [];
let chartInstance = null;
const MAX_HISTORY = 60;

// Face detection state
let faceDetectionReady = false;
let prevFrameData = null;

// Analysis loop
let analysisRunning = false;

// Pixel canvas (off-screen, reused)
const pixelCanvas = document.createElement('canvas');
const pixelCtx = pixelCanvas.getContext('2d', { willReadFrequently: true });

// ICE config — Google STUN for same-LAN & internet
const ICE_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ]
};

// ── UTILS ──────────────────────────────────────
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

// ── LOGGING ────────────────────────────────────
function log(msg, type = '') {
  const feed = document.getElementById('logFeed');
  if (!feed) return;
  const now = new Date();
  const t = [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map(n => String(n).padStart(2, '0')).join(':');
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = `<span class="log-time">${t}</span><span class="log-msg ${type}">${msg}</span>`;
  feed.prepend(entry);
  if (feed.children.length > 40) feed.removeChild(feed.lastChild);
  console.log(`[DeepTrust ${t}] ${msg}`);
}

function showAlert(msg, type = 'success') {
  const el = document.getElementById('alertBanner');
  if (!el) return;
  el.textContent = msg;
  el.className = `alert-banner ${type} show`;
  setTimeout(() => { el.classList.remove('show'); }, 3500);
}

// ── MODEL LOADING ──────────────────────────────
async function loadModels() {
  const loadingText = document.getElementById('loadingText');
  const pill = document.getElementById('modelStatusPill');
  const pillText = document.getElementById('modelStatusText');
  const MODEL_URL = './models';

  try {
    loadingText.textContent = 'Loading TinyFaceDetector…';
    await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
    log('TinyFaceDetector loaded', 'ok');

    loadingText.textContent = 'Loading FaceLandmark68…';
    await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
    log('FaceLandmark68 loaded', 'ok');

    faceDetectionReady = true;
    pill.classList.add('active');
    pillText.textContent = 'Models Ready';
    log('All AI models loaded ✓', 'ok');
  } catch (err) {
    log(`Model load error: ${err.message}`, 'err');
    pill.classList.add('warning');
    pillText.textContent = 'Pixel Mode';
    log('Falling back to pixel-diff analysis only', 'warn');
  }
}

// ── CAMERA INIT ────────────────────────────────
async function initCamera() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      audio: true
    });
    document.getElementById('localVideo').srcObject = localStream;
    log('Camera & mic initialized', 'ok');
    return true;
  } catch (err) {
    log(`Camera error: ${err.name} — ${err.message}`, 'err');
    showAlert('Camera access denied', 'danger');
    return false;
  }
}

// ── INIT SEQUENCE ─────────────────────────────
async function init() {
  document.getElementById('loadingText').textContent = 'Requesting camera access…';
  const camOk = await initCamera();
  if (!camOk) {
    document.getElementById('loadingText').textContent = '⚠ Camera denied — check permissions';
    return;
  }

  document.getElementById('loadingText').textContent = 'Loading AI models…';
  await loadModels();

  initChart();

  const overlay = document.getElementById('loadingOverlay');
  overlay.classList.add('done');
  setTimeout(() => overlay.style.display = 'none', 600);
  log('DeepTrust initialized — ready to connect', 'info');
}

// ── WEBSOCKET & ROOM LOGIC ─────────────────────
function joinRoom() {
  const input = document.getElementById('roomCodeInput');
  const code = input.value.trim().toUpperCase();
  if (!code) {
    showAlert('Please enter a valid room code', 'danger');
    return;
  }

  currentRoom = code;
  document.getElementById('lobbyInputArea').style.display = 'none';
  document.getElementById('lobbyStatusArea').style.display = 'block';
  document.getElementById('displayRoomCode').textContent = currentRoom;

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}/ws/${currentRoom}`);

  ws.onopen = () => {
    log(`Connected to Room: ${currentRoom}`, 'info');
    updateConnPill('waiting', 'Waiting for Peer');
  };

  ws.onmessage = async (msg) => {
    const data = JSON.parse(msg.data);

    if (data.type === 'ready') {
      log(`Peer joined. Role: ${data.role}`, 'info');
      if (data.role === 'caller') {
        await startCall();
      } else {
        log('Waiting for caller offer…', 'info');
      }
    } else if (data.type === 'error') {
      showAlert(data.msg, 'danger');
      log(data.msg, 'err');
    } else if (data.type === 'peer_disconnected') {
      showAlert('⚠ Peer disconnected', 'danger');
      log('Peer disconnected remotely', 'warn');
      endCall();
    } else if (data.offer) {
      log('Remote offer received', 'info');
      createPeerConnection();
      await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      ws.send(JSON.stringify({ answer: pc.localDescription }));
      log('Answer sent', 'ok');
      drainIceQueue();
    } else if (data.answer) {
      log('Remote answer received', 'ok');
      await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
      drainIceQueue();
    } else if (data.ice) {
      if (pc && pc.remoteDescription && pc.remoteDescription.type) {
        try { await pc.addIceCandidate(new RTCIceCandidate(data.ice)); } catch {}
      } else {
        iceQueue.push(data.ice);
      }
    }
  };

  ws.onerror = () => {
    showAlert('WebSocket Error — check server connection', 'danger');
    log('WebSocket Error', 'err');
  };

  ws.onclose = () => {
    log('WebSocket closed', 'warn');
    updateConnPill('', 'Disconnected');
  };
}

async function drainIceQueue() {
  while (iceQueue.length > 0) {
    const ice = iceQueue.shift();
    try { await pc.addIceCandidate(new RTCIceCandidate(ice)); } catch {}
  }
}

// ── WEBRTC ────────────────────────────────────
function createPeerConnection() {
  if (pc) return pc;

  pc = new RTCPeerConnection(ICE_CONFIG);
  log('PeerConnection created', 'info');

  if (localStream) {
    localStream.getTracks().forEach(track => {
      pc.addTrack(track, localStream);
    });
  }

  pc.ontrack = (evt) => {
    log(`Remote track: ${evt.track.kind}`, 'ok');
    if (evt.streams && evt.streams[0]) {
      document.getElementById('remoteVideo').srcObject = evt.streams[0];
      remoteStream = evt.streams[0];
    }
  };

  pc.onicecandidate = (evt) => {
    if (evt.candidate && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ ice: evt.candidate }));
    }
  };

  pc.oniceconnectionstatechange = () => {
    const state = pc.iceConnectionState;
    log(`ICE state: ${state}`, state === 'connected' || state === 'completed' ? 'ok' : state === 'failed' ? 'err' : 'info');

    if (state === 'connected' || state === 'completed') {
      updateConnPill('active', 'Connected');
      onCallConnected();
    } else if (state === 'failed') {
      updateConnPill('warning', 'ICE Failed');
      showAlert('⚠ Connection failed — check network / STUN', 'danger');
    } else if (state === 'disconnected') {
      updateConnPill('warning', 'Disconnected');
    }
  };

  return pc;
}

function updateConnPill(cls, text) {
  const pill = document.getElementById('connStatusPill');
  const pillText = document.getElementById('connStatusText');
  pill.className = `status-pill${cls ? ' ' + cls : ''}`;
  pillText.textContent = text;
}

async function startCall() {
  createPeerConnection();
  try {
    const offer = await pc.createOffer({ offerToReceiveVideo: true, offerToReceiveAudio: true });
    await pc.setLocalDescription(offer);
    log('Sending offer…', 'info');
    ws.send(JSON.stringify({ offer: pc.localDescription }));
  } catch (err) {
    log(`Offer error: ${err.message}`, 'err');
    showAlert('Failed to start call', 'danger');
  }
}

// ── CALL CONNECTED ────────────────────────────
function onCallConnected() {
  if (callStartTime) return; // guard duplicate calls
  showAlert('🔗 Peer connected — DeepTrust active', 'success');

  document.getElementById('setupPanel').classList.add('hidden');
  document.getElementById('callView').classList.add('active');
  document.getElementById('sidebar').classList.add('active');

  setTimeout(resizeFaceCanvas, 300);

  callStartTime = Date.now();
  callTimerInterval = setInterval(updateCallTimer, 1000);

  document.getElementById('scanOverlay').classList.add('active');
  startAnalysis();
  setInterval(updateStats, 2000);

  log('Call established — liveness analysis started', 'ok');
}

function updateCallTimer() {
  const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
  const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const s = String(elapsed % 60).padStart(2, '0');
  document.getElementById('callDuration').textContent = `${m}:${s}`;
}

async function updateStats() {
  if (!pc) return;
  try {
    const stats = await pc.getStats();
    stats.forEach(report => {
      if (report.type === 'candidate-pair' && report.state === 'succeeded') {
        const rtt = Math.round((report.currentRoundTripTime || 0) * 1000);
        document.getElementById('pingVal').textContent = rtt || '—';
      }
      if (report.type === 'inbound-rtp' && report.kind === 'video') {
        document.getElementById('framesVal').textContent = Math.round(report.framesPerSecond || 0);
      }
    });
  } catch {}
}

function resizeFaceCanvas() {
  const wrapper = document.getElementById('remoteWrapper');
  const canvas = document.getElementById('faceCanvas');
  if (!wrapper || !canvas) return;
  canvas.width = wrapper.offsetWidth;
  canvas.height = wrapper.offsetHeight;
}

window.addEventListener('resize', resizeFaceCanvas);

// ── LIVENESS ANALYSIS (REMOTE ONLY) ───────────
function startAnalysis() {
  if (analysisRunning) return;
  analysisRunning = true;

  async function analyzeFrame() {
    if (!analysisRunning) return;

    const video = document.getElementById('remoteVideo');
    if (!video || video.readyState < 2 || video.videoWidth === 0) {
      setTimeout(analyzeFrame, 250);
      return;
    }

    const motionScore = computePixelMotion(video);

    let detected = false;
    let landmarkJitter = 0;
    let blinkDetected = false;
    let confidence = 0;

    if (faceDetectionReady) {
      try {
        const canvas = document.getElementById('faceCanvas');
        const ctx = canvas.getContext('2d');
        const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.2 });
        const detections = await faceapi.detectAllFaces(video, options).withFaceLandmarks();

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (detections && detections.length > 0) {
          detected = true;
          const det = detections[0];
          confidence = det.detection.score;

          drawFaceBox(ctx, det, canvas);

          const lms = det.landmarks.positions;
          landmarkJitter = computeLandmarkJitter(lms);

          blinkDetected = detectBlink(lms);
          if (blinkDetected) {
            blinkEvents.push(Date.now());
          }

          prevLandmarks = lms;
        } else {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          if (prevLandmarks) {
            log('Face lost — obscured or turned', 'warn');
            prevLandmarks = null;
          }
        }
      } catch (err) {
        // Silently swallow face-api errors during analysis
      }
    }

    // Filter blink events to last 60 seconds
    const now60 = Date.now() - 60000;
    blinkEvents = blinkEvents.filter(t => t > now60);
    const blinkRate = blinkEvents.length;

    motionHistory.push(motionScore);
    if (motionHistory.length > 30) motionHistory.shift();
    const motionEntropy = computeEntropy(motionHistory);

    // ── SCORE COMPUTATION ──
    let integrityScore = 50;

    if (faceDetectionReady && detected) {
      if (landmarkJitter < 0.1 || landmarkJitter > 5.0) {
        integrityScore = 15;
      } else {
        const entropyBoost = clamp(motionEntropy * 60, 0, 25);
        const blinkBoost = blinkRate >= 8 && blinkRate <= 35 ? 20 : blinkRate > 0 ? 5 : -10;
        const jitterBoost = (landmarkJitter > 0.2 && landmarkJitter < 3.0) ? 15 : 0;
        const confBoost = confidence > 0.7 ? 10 : confidence > 0.5 ? 5 : 0;
        integrityScore = 30 + entropyBoost + blinkBoost + jitterBoost + confBoost;
      }
    } else if (motionScore > 0) {
      integrityScore = 30 + clamp(motionEntropy * 50, 0, 30);
    } else {
      integrityScore = 5;
    }

    integrityScore = clamp(Math.round(integrityScore), 0, 100);
    scoreHistory.push(integrityScore);
    if (scoreHistory.length > MAX_HISTORY) scoreHistory.shift();

    const smoothedScore = Math.round(
      scoreHistory.slice(-8).reduce((a, b) => a + b, 0) / Math.min(8, scoreHistory.length)
    );

    updateIntegrityUI(smoothedScore, { motionEntropy, blinkRate, landmarkJitter, confidence, detected });
    updateChart(smoothedScore, landmarkJitter, motionEntropy * 100);

    setTimeout(analyzeFrame, 250);
  }

  analyzeFrame();
}

// ── PIXEL MOTION ──────────────────────────────
function computePixelMotion(video) {
  const w = 80, h = 60;
  pixelCanvas.width = w;
  pixelCanvas.height = h;
  pixelCtx.drawImage(video, 0, 0, w, h);
  const frame = pixelCtx.getImageData(0, 0, w, h).data;

  if (!prevFrameData || prevFrameData.length !== frame.length) {
    prevFrameData = frame.slice();
    return 0;
  }

  let diff = 0;
  const step = 4;
  for (let i = 0; i < frame.length; i += step) {
    diff += (Math.abs(frame[i] - prevFrameData[i]) +
             Math.abs(frame[i + 1] - prevFrameData[i + 1]) +
             Math.abs(frame[i + 2] - prevFrameData[i + 2])) / 3;
  }

  prevFrameData = frame.slice();
  return diff / (frame.length / step);
}

function computeLandmarkJitter(current) {
  if (!prevLandmarks || prevLandmarks.length !== current.length) return 0;
  let totalDist = 0;
  for (let i = 0; i < current.length; i++) {
    const dx = current[i].x - prevLandmarks[i].x;
    const dy = current[i].y - prevLandmarks[i].y;
    totalDist += Math.sqrt(dx * dx + dy * dy);
  }
  return totalDist / current.length;
}

function detectBlink(landmarks) {
  const leftEar = eyeAspectRatio(landmarks, 36, 37, 38, 39, 40, 41);
  const rightEar = eyeAspectRatio(landmarks, 42, 43, 44, 45, 46, 47);
  return (leftEar + rightEar) / 2 < 0.22;
}

function eyeAspectRatio(pts, p1, p2, p3, p4, p5, p6) {
  const d = (a, b) => {
    const dx = pts[a].x - pts[b].x, dy = pts[a].y - pts[b].y;
    return Math.sqrt(dx * dx + dy * dy);
  };
  const h = d(p1, p4);
  return h > 0 ? (d(p2, p6) + d(p3, p5)) / (2 * h) : 0;
}

function computeEntropy(arr) {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length;
  return Math.sqrt(variance) / (mean + 1);
}

function drawFaceBox(ctx, det, canvas) {
  const box = det.detection.box;
  const vidEl = document.getElementById('remoteVideo');
  const sx = canvas.width / vidEl.videoWidth;
  const sy = canvas.height / vidEl.videoHeight;

  const x = box.x * sx, y = box.y * sy;
  const w = box.width * sx, h = box.height * sy;
  const score = scoreHistory.length > 0 ? scoreHistory[scoreHistory.length - 1] : 50;
  const color = score >= 65 ? '#7fff6e' : score >= 40 ? '#00f0ff' : '#ff3c6e';
  const cs = 16;

  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.shadowColor = color;
  ctx.shadowBlur = 10;

  ctx.beginPath();
  ctx.moveTo(x, y + cs); ctx.lineTo(x, y); ctx.lineTo(x + cs, y);
  ctx.moveTo(x + w - cs, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + cs);
  ctx.moveTo(x + w, y + h - cs); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - cs, y + h);
  ctx.moveTo(x + cs, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - cs);
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.fillStyle = color;
  ctx.font = '10px "Space Mono", monospace';
  ctx.fillText(`${Math.round(det.detection.score * 100)}%`, x + 4, y - 4);
}

// ── UI UPDATES ────────────────────────────────
function updateIntegrityUI(score, metrics) {
  const circ = 314;
  const ring = document.getElementById('ringFill');
  if (ring) {
    ring.style.strokeDashoffset = circ - (score / 100) * circ;
    const c = score >= 65 ? '#7fff6e' : score >= 40 ? '#ffbb00' : '#ff3c6e';
    ring.style.stroke = c;
    ring.style.filter = `drop-shadow(0 0 6px ${c})`;
  }

  const ringScoreEl = document.getElementById('ringScore');
  if (ringScoreEl) ringScoreEl.textContent = score;

  const verdict = document.getElementById('verdictText');
  const badge = document.getElementById('trustBadge');

  if (verdict && badge) {
    if (!metrics.detected && scoreHistory.length < 5) {
      verdict.textContent = 'Awaiting Face…';
      verdict.style.color = 'var(--text-dim)';
      badge.className = 'trust-badge analyzing show';
      badge.textContent = '🔍 Analyzing…';
    } else if (score >= 65) {
      verdict.textContent = '✓ HUMAN VERIFIED';
      verdict.style.color = 'var(--accent3)';
      badge.className = 'trust-badge human show';
      badge.textContent = '✓ HUMAN VERIFIED';
    } else if (score >= 40) {
      verdict.textContent = '⚠ INCONCLUSIVE';
      verdict.style.color = 'var(--warn)';
      badge.className = 'trust-badge analyzing show';
      badge.textContent = '⚠ INCONCLUSIVE';
    } else {
      verdict.textContent = '⚠ AI SIGNATURE DETECTED';
      verdict.style.color = 'var(--accent2)';
      badge.className = 'trust-badge ai show';
      badge.textContent = '⚠ AI / STATIC DETECTED';
      if (scoreHistory.length % 20 === 0) log('AI/Static signature — score: ' + score, 'err');
    }
  }

  const entropy = metrics.motionEntropy || 0;
  document.getElementById('metricEntropy').textContent = entropy.toFixed(3);
  document.getElementById('barEntropy').style.width = clamp(entropy * 200, 0, 100) + '%';

  const blink = metrics.blinkRate || 0;
  document.getElementById('metricBlink').textContent = blink + ' /min';
  document.getElementById('barBlink').style.width = clamp((blink / 30) * 100, 0, 100) + '%';
  document.getElementById('barBlink').style.background =
    blink >= 8 && blink <= 35 ? 'var(--accent3)' : 'var(--warn)';

  const jitter = metrics.landmarkJitter || 0;
  document.getElementById('metricJitter').textContent = jitter.toFixed(2);
  document.getElementById('barJitter').style.width = clamp(jitter * 25, 0, 100) + '%';

  const micro = metrics.motionEntropy ? (metrics.motionEntropy * 5).toFixed(2) : '0.00';
  document.getElementById('metricMicro').textContent = micro + ' px';
  document.getElementById('barMicro').style.width = clamp(parseFloat(micro) * 20, 0, 100) + '%';

  const conf = Math.round((metrics.confidence || 0) * 100);
  document.getElementById('metricConf').textContent = conf + '%';
  document.getElementById('barConf').style.width = conf + '%';
}

// ── CHART.JS ──────────────────────────────────
function initChart() {
  const ctx = document.getElementById('analyticsChart');
  if (!ctx) return;

  Chart.defaults.color = '#4a6080';
  Chart.defaults.font.family = "'Space Mono', monospace";

  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: Array(MAX_HISTORY).fill(''),
      datasets: [
        {
          label: 'Integrity Score',
          data: Array(MAX_HISTORY).fill(null),
          borderColor: '#00f0ff',
          backgroundColor: 'rgba(0,240,255,0.1)',
          borderWidth: 2,
          fill: true,
          tension: 0.4,
          yAxisID: 'y'
        },
        {
          label: 'Jitter (px)',
          data: Array(MAX_HISTORY).fill(null),
          borderColor: '#ffbb00',
          borderDash: [5, 5],
          borderWidth: 1.5,
          tension: 0.3,
          yAxisID: 'y1'
        },
        {
          label: 'Entropy ×100',
          data: Array(MAX_HISTORY).fill(null),
          borderColor: '#7fff6e',
          borderWidth: 1.5,
          tension: 0.3,
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: true, position: 'bottom', labels: { boxWidth: 10, font: { size: 9 } } },
        tooltip: { enabled: false }
      },
      scales: {
        x: { display: false },
        y: {
          min: 0, max: 100,
          grid: { color: 'rgba(30,45,74,0.3)' },
          ticks: { stepSize: 25, font: { size: 9 } }
        },
        y1: {
          min: 0, max: 20, position: 'right',
          grid: { display: false },
          ticks: { font: { size: 9 } }
        }
      }
    }
  });
}

function updateChart(score, jitter, entropyScaled) {
  if (!chartInstance) return;
  const ds = chartInstance.data.datasets;

  ds[0].data.push(score); ds[0].data.shift();
  ds[1].data.push(jitter); ds[1].data.shift();
  ds[2].data.push(entropyScaled); ds[2].data.shift();

  ds[0].borderColor = score < 40 ? '#ff3c6e' : '#00f0ff';
  ds[0].backgroundColor = score < 40 ? 'rgba(255,60,110,0.2)' : 'rgba(0,240,255,0.1)';

  chartInstance.update();
}

// ── CONTROLS ──────────────────────────────────
function toggleMic() {
  if (!localStream) return;
  micEnabled = !micEnabled;
  localStream.getAudioTracks().forEach(t => t.enabled = micEnabled);
  const btn = document.getElementById('btnMicToggle');
  btn.textContent = micEnabled ? '🎙️' : '🔇';
  btn.classList.toggle('muted', !micEnabled);
}

function toggleCam() {
  if (!localStream) return;
  camEnabled = !camEnabled;
  localStream.getVideoTracks().forEach(t => t.enabled = camEnabled);
  const btn = document.getElementById('btnCamToggle');
  btn.textContent = camEnabled ? '📷' : '🚫';
  btn.classList.toggle('muted', !camEnabled);
}

function endCall() {
  analysisRunning = false;
  if (callTimerInterval) { clearInterval(callTimerInterval); callTimerInterval = null; }
  callStartTime = null;

  if (pc) { pc.close(); pc = null; }
  if (ws && ws.readyState === WebSocket.OPEN) { ws.close(); ws = null; }

  document.getElementById('remoteVideo').srcObject = null;
  document.getElementById('callView').classList.remove('active');
  document.getElementById('sidebar').classList.remove('active');
  document.getElementById('setupPanel').classList.remove('hidden');
  document.getElementById('scanOverlay').classList.remove('active');

  document.getElementById('lobbyInputArea').style.display = 'block';
  document.getElementById('lobbyStatusArea').style.display = 'none';

  scoreHistory = [];
  motionHistory = [];
  blinkEvents = [];
  prevLandmarks = null;
  prevFrameData = null;
  iceQueue = [];

  if (chartInstance) {
    chartInstance.data.datasets.forEach(ds => ds.data.fill(null));
    chartInstance.update();
  }

  updateConnPill('', 'Disconnected');
  log('Call ended', 'warn');
  showAlert('Call ended');
}

// ── BOOT ──────────────────────────────────────
init();
