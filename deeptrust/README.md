# DeepTrust — AI Integrity Monitor v2.1

A real-time P2P video call app with **liveness / deepfake detection** powered by:
- **WebRTC** (peer-to-peer video/audio, no media server needed)
- **face-api.js** (TinyFaceDetector + 68-point landmark model)
- **FastAPI + WebSockets** (signalling server)
- **Chart.js** (live telemetry chart)

---

## Project Structure

```
deeptrust/
├── backend/
│   ├── main.py           ← FastAPI signalling server + static file server
│   └── requirements.txt
├── frontend/
│   ├── index.html        ← Full app (CSS + HTML)
│   ├── script.js         ← All client logic (WebRTC, face-api, analysis)
│   └── models/           ← face-api.js model weights (auto-downloaded by setup)
├── setup.sh              ← Linux/macOS setup
├── setup.bat             ← Windows setup
└── README.md
```

---

## Quick Start

### 1. Run setup (downloads models + installs deps)

**Linux / macOS:**
```bash
chmod +x setup.sh && ./setup.sh
```

**Windows:**
```
setup.bat
```

### 2. Start the server

```bash
cd backend
python main.py
```

Server starts on **http://localhost:8000**

### 3. Open on two browsers / devices

- Open `http://localhost:8000` in **two browser tabs** (same machine for LAN test)  
- Or open on two devices on the same local network using `http://<your-ip>:8000`
- Type the **same room code** in both (e.g. `ALPHA-123`) and click **Join Meeting**
- The call connects automatically — DeepTrust begins analyzing the remote feed

---

## How It Works

| Signal | What it means |
|--------|--------------|
| ✓ HUMAN VERIFIED (≥65) | Natural blink rate, landmark jitter & motion entropy in expected range |
| ⚠ INCONCLUSIVE (40–64) | Some signals present but insufficient confidence |
| ⚠ AI / STATIC DETECTED (<40) | Low entropy, no blinks, rigid landmark positions — deepfake/static frame signature |

### Analysis pipeline (runs every 250 ms on **remote feed only**)

1. **Pixel motion** — frame diff on 80×60 downsampled canvas
2. **Face detection** — TinyFaceDetector @ 224px input
3. **68-point landmarks** — eye aspect ratio blink detection, inter-frame jitter
4. **Entropy** — variance / mean of last 30 motion samples
5. **Score** — weighted combination, smoothed over last 8 frames

---

## Network Notes

- **Same LAN**: works with Google STUN only (default)
- **Different networks**: add a TURN server to `ICE_CONFIG` in `script.js`
- **Room limit**: 2 participants per room (3rd peer is rejected)
- **Peer disconnect**: both sides are notified and the call view resets

---

## Manual Model Download (if setup script fails)

Download these 4 files from:
`https://github.com/justadudewhohacks/face-api.js/tree/master/weights`

- `tiny_face_detector_model-weights_manifest.json`
- `tiny_face_detector_model-shard1`
- `face_landmark_68_model-weights_manifest.json`
- `face_landmark_68_model-shard1`

Place all 4 in `frontend/models/`.

---

## Bugs Fixed vs Original

- **Duplicate functions** — `toggleMic`, `toggleCam`, `endCall`, `clamp`, `updateIntegrityUI`, `initChart`, `updateChart` were all duplicated in original `script.js` (corrupted file). All cleaned up.
- **Frontend path** — original `main.py` pointed to `../frontend` which is correct; kept as-is.
- **Peer disconnect handling** — server now notifies remaining peer and client handles `peer_disconnected` message gracefully.
- **Room overflow** — 3rd+ participant is now rejected with an error message.
- **Call guard** — `onCallConnected` now guards against double-invocation.
- **Enter key** — room code input now supports pressing Enter to join.
- **WebSocket cleanup** — `endCall()` now properly closes the WebSocket.
- **ICE drain** — extracted `drainIceQueue()` helper called consistently after both offer and answer paths.
