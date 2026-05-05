#!/usr/bin/env bash
# DeepTrust setup — downloads face-api.js models and installs Python deps

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODELS_DIR="$SCRIPT_DIR/frontend/models"
BACKEND_DIR="$SCRIPT_DIR/backend"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  DeepTrust Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 1. Python deps
echo ""
echo "[1/3] Installing Python dependencies..."
cd "$BACKEND_DIR"
pip install -r requirements.txt --quiet

# 2. Download face-api.js models
echo ""
echo "[2/3] Downloading face-api.js models..."
mkdir -p "$MODELS_DIR"

BASE="https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights"

FILES=(
  "tiny_face_detector_model-weights_manifest.json"
  "tiny_face_detector_model-shard1"
  "face_landmark_68_model-weights_manifest.json"
  "face_landmark_68_model-shard1"
)

for f in "${FILES[@]}"; do
  if [ ! -f "$MODELS_DIR/$f" ]; then
    echo "  Downloading $f..."
    curl -sSL "$BASE/$f" -o "$MODELS_DIR/$f"
  else
    echo "  Skipping $f (already exists)"
  fi
done

echo ""
echo "[3/3] Done!"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Run the server:"
echo "    cd backend && python main.py"
echo ""
echo "  Open in browser:"
echo "    http://localhost:8000"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
