# deepfake_detector
🛡️ DeepTrust: AI Integrity & Deepfake Monitor
DeepTrust is a professional-grade, peer-to-peer (P2P) video communication platform designed to verify the authenticity of digital identities in real-time. By leveraging Temporal Jitter Analysis and Biometric Scanning, the system distinguishes between a live human and synthetic media (deepfakes, static photos, or virtual camera injections).

🚀 Core Features
P2P Biometric Handshake: Secure video calling using WebRTC and an automated WebSocket signaling server.

Temporal Jitter Analysis: Monitors 68 facial landmarks to detect "Algorithmic Noise" (common in AI) vs. natural human micro-movements.

Integrity Scoring: A real-time 0–100 trust score based on blink rates, motion entropy, and landmark variance.

Audio Integrity: Integrated detection for specific acoustic signatures, such as crying baby sounds, using Teachable Machine.

Remote-First Analysis: The engine strictly monitors the remote peer, ensuring you can verify the identity of the person you are talking to.

🛠️ Technical Stack
Frontend: HTML5, CSS3 (Syne & Space Mono typography), Vanilla JavaScript.

AI Engine: face-api.js (TensorFlow.js under the hood).

Communication: WebRTC (RTCPeerConnection) for video/audio, WebSockets for signaling.

Backend: Python (FastAPI/Uvicorn) signaling server.

📂 Folder Structure
Plaintext
DeepTrust/
├── backend/
│   └── main.py          # WebSocket signaling server
├── frontend/
│   ├── index.html       # UI with Integrity Ring & Sparklines
│   ├── script.js        # Core WebRTC & AI Detection logic
│   └── models/          # Weights for TinyFaceDetector & Landmarks
└── README.md
⚙️ Installation & Setup
1. Configure the Backend
Ensure you have Python installed, then run the signaling server:

Bash
pip install fastapi uvicorn
python backend/main.py
2. Configure the Frontend
Open frontend/script.js.

Update the HOST_IP constant with your machine's IPv4 address (found via ipconfig in CMD).

Ensure your model files in /models are named exactly:

tiny_face_detector_model-shard1

face_landmark_68_model-shard1

3. Browser Permissions (Chrome/Edge)
Since this uses local IP addresses, you must bypass "Insecure Origin" blocks for the camera to work:

Go to chrome://flags/#unsafely-treat-insecure-origin-as-secure.

Enable it and add your URL (e.g., [http://192.168.](http://192.168.)x.x:5500).

Relaunch the browser.

📊 Understanding the Integrity Monitor
Verified Human (Score > 70): Detects natural movement, regular blink rates (8-35/min), and organic jitter.

AI Signature (Score < 40): Triggered by static feeds (jitter < 0.1) or deepfake distortions (jitter > 4.5).

Event Log: Real-time terminal output tracking connectivity and biometric changes.
