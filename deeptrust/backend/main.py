import uvicorn
import os
import json
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

rooms: dict[str, list[WebSocket]] = {}

@app.websocket("/ws/{room_code}")
async def websocket_endpoint(websocket: WebSocket, room_code: str):
    await websocket.accept()
    room_code = room_code.upper()

    if room_code not in rooms:
        rooms[room_code] = []

    rooms[room_code].append(websocket)
    count = len(rooms[room_code])
    print(f"[Room {room_code}] {count} participant(s)")

    if count == 2:
        await rooms[room_code][0].send_text(json.dumps({"type": "ready", "role": "caller"}))
        await rooms[room_code][1].send_text(json.dumps({"type": "ready", "role": "callee"}))
    elif count > 2:
        await websocket.send_text(json.dumps({"type": "error", "msg": "Room is full (max 2 participants)"}))
        await websocket.close()
        rooms[room_code].remove(websocket)
        return

    try:
        while True:
            data = await websocket.receive_text()
            for client in rooms[room_code]:
                if client != websocket:
                    await client.send_text(data)
    except WebSocketDisconnect:
        if room_code in rooms and websocket in rooms[room_code]:
            rooms[room_code].remove(websocket)
            print(f"[Room {room_code}] Peer disconnected — {len(rooms[room_code])} remaining")
            # Notify remaining peer
            for client in rooms[room_code]:
                try:
                    await client.send_text(json.dumps({"type": "peer_disconnected"}))
                except Exception:
                    pass
            if len(rooms[room_code]) == 0:
                del rooms[room_code]

# Serve frontend — path is relative to backend/main.py → ../frontend
frontend_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "frontend")
app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=False)
