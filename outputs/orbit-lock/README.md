# Orbit Lock

A two-player, real-time Connect Four game. The server is authoritative: it assigns seats, enforces turn order, rejects full columns, and verifies every win.

## Run locally

```powershell
node server.js
```

Open `http://localhost:3000`. One person creates a room and copies the invite link; a second person opens it to join. Red starts. The first player to connect four beacons horizontally, vertically, or diagonally wins.

## Make it public

Run a public HTTPS tunnel to port 3000, then share the generated URL while the server and tunnel are running. The game needs one always-running Node process because its room state is held in memory.
