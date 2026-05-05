@echo off
:: DeepTrust setup for Windows

echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo   DeepTrust Setup (Windows)
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

set SCRIPT_DIR=%~dp0
set MODELS_DIR=%SCRIPT_DIR%frontend\models
set BACKEND_DIR=%SCRIPT_DIR%backend

echo.
echo [1/3] Installing Python dependencies...
cd /d "%BACKEND_DIR%"
pip install -r requirements.txt

echo.
echo [2/3] Downloading face-api.js models...
if not exist "%MODELS_DIR%" mkdir "%MODELS_DIR%"

set BASE=https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights

curl -sSL "%BASE%/tiny_face_detector_model-weights_manifest.json" -o "%MODELS_DIR%\tiny_face_detector_model-weights_manifest.json"
curl -sSL "%BASE%/tiny_face_detector_model-shard1" -o "%MODELS_DIR%\tiny_face_detector_model-shard1"
curl -sSL "%BASE%/face_landmark_68_model-weights_manifest.json" -o "%MODELS_DIR%\face_landmark_68_model-weights_manifest.json"
curl -sSL "%BASE%/face_landmark_68_model-shard1" -o "%MODELS_DIR%\face_landmark_68_model-shard1"

echo.
echo [3/3] Done!
echo.
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo   Run:  cd backend ^&^& python main.py
echo   Open: http://localhost:8000
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
pause
