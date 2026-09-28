"use strict";

// Orbit Lock is intentionally dependency-free: Node's HTTP and crypto modules
// are all that is needed to run its authoritative multiplayer game server.
const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC = path.join(__dirname, "public");
const rooms = new Map();

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

function safeFile(urlPath) {
  const requestPath = decodeURIComponent(urlPath.split("?")[0]);
  const relativePath = requestPath === "/" ? "/index.html" : requestPath;
  const filePath = path.resolve(PUBLIC, `.${relativePath}`);
  return filePath === PUBLIC || filePath.startsWith(`${PUBLIC}${path.sep}`) ? filePath : null;
}

const server = http.createServer((req, res) => {
  const filePath = safeFile(req.url || "/");
  if (!filePath) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(error.code === "ENOENT" ? 404 : 500).end(error.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }
    res.writeHead(200, { "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(data);
  });
});

function makeRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = Array.from({ length: 5 }, () => alphabet[crypto.randomInt(alphabet.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function cleanName(value) {
  return String(value || "Pilot").replace(/[^a-zA-Z0-9 _-]/g, "").trim().slice(0, 18) || "Pilot";
}

function freshRoom(code) {
  return {
    code,
    board: Array(42).fill(null),
    turn: "red",
    status: "waiting",
    winner: null,
    players: { red: null, gold: null },
    names: { red: "Red pilot", gold: "Gold pilot" },
    tokens: { red: null, gold: null },
    spectators: new Set(),
  };
}

function inGame(room) {
  return Boolean(room.players.red && room.players.gold);
}

function roomPayload(room) {
  return {
    type: "state",
    room: room.code,
    board: room.board,
    turn: room.turn,
    status: room.status,
    winner: room.winner,
    connected: { red: Boolean(room.players.red), gold: Boolean(room.players.gold) },
    names: room.names,
  };
}

function send(socket, message) {
  if (!socket.destroyed) socket.write(encodeFrame(JSON.stringify(message)));
}

function broadcast(room, message = roomPayload(room)) {
  for (const client of [room.players.red, room.players.gold, ...room.spectators]) {
    if (client) send(client.socket, message);
  }
}

function isWinner(board, index, color) {
  const row = Math.floor(index / 7);
  const col = index % 7;
  const directions = [[0, 1], [1, 0], [1, 1], [1, -1]];
  return directions.some(([dr, dc]) => {
    let total = 1;
    for (const sign of [-1, 1]) {
      let r = row + dr * sign;
      let c = col + dc * sign;
      while (r >= 0 && r < 6 && c >= 0 && c < 7 && board[r * 7 + c] === color) {
        total += 1;
        r += dr * sign;
        c += dc * sign;
      }
    }
    return total >= 4;
  });
}

function resetRound(room) {
  room.board = Array(42).fill(null);
  room.turn = "red";
  room.winner = null;
  room.status = inGame(room) ? "playing" : "waiting";
}

function enterRoom(client, raw) {
  const requested = String(raw.room || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
  const code = requested || makeRoomCode();
  let room = rooms.get(code);
  if (!room) {
    room = freshRoom(code);
    rooms.set(code, room);
  }
  const requestedToken = String(raw.seatToken || "");
  let role = "spectator";
  for (const color of ["red", "gold"]) {
    if (room.tokens[color] === requestedToken && !room.players[color]) {
      role = color;
      break;
    }
  }
  if (role === "spectator") {
    for (const color of ["red", "gold"]) {
      if (!room.players[color] && !room.tokens[color]) {
        role = color;
        room.tokens[color] = crypto.randomBytes(18).toString("hex");
        break;
      }
    }
  }
  client.room = room;
  client.role = role;
  if (role === "spectator") {
    room.spectators.add(client);
  } else {
    room.players[role] = client;
    room.names[role] = cleanName(raw.name);
  }
  if (inGame(room) && room.status === "waiting") room.status = "playing";
  send(client.socket, { type: "joined", room: room.code, role, seatToken: role === "spectator" ? null : room.tokens[role] });
  broadcast(room);
}

function leaveRoom(client) {
  const room = client.room;
  if (!room) return;
  if (client.role === "spectator") room.spectators.delete(client);
  else if (room.players[client.role] === client) room.players[client.role] = null;
  if (!inGame(room) && room.status !== "finished") room.status = "waiting";
  broadcast(room);
  client.room = null;
}

function playMove(client, column) {
  const room = client.room;
  if (!room || client.role === "spectator") return;
  if (!inGame(room) || room.status !== "playing") return send(client.socket, { type: "notice", message: "The round starts when both pilots are connected." });
  if (room.turn !== client.role) return send(client.socket, { type: "notice", message: "Hold position — it is the other pilot's turn." });
  const col = Number(column);
  if (!Number.isInteger(col) || col < 0 || col > 6) return;
  let placed = -1;
  for (let row = 5; row >= 0; row -= 1) {
    const index = row * 7 + col;
    if (!room.board[index]) {
      room.board[index] = client.role;
      placed = index;
      break;
    }
  }
  if (placed < 0) return send(client.socket, { type: "notice", message: "That orbit is full. Choose another column." });
  if (isWinner(room.board, placed, client.role)) {
    room.winner = client.role;
    room.status = "finished";
  } else if (room.board.every(Boolean)) {
    room.winner = "draw";
    room.status = "finished";
  } else {
    room.turn = client.role === "red" ? "gold" : "red";
  }
  broadcast(room);
}

function handleMessage(client, message) {
  if (!message || typeof message !== "object") return;
  if (message.type === "join" && !client.room) enterRoom(client, message);
  if (message.type === "move") playMove(client, message.column);
  if (message.type === "rematch" && client.room && client.role !== "spectator") {
    resetRound(client.room);
    broadcast(client.room);
  }
}

function encodeFrame(text) {
  const body = Buffer.from(text);
  if (body.length < 126) return Buffer.concat([Buffer.from([0x81, body.length]), body]);
  return Buffer.concat([Buffer.from([0x81, 126, body.length >> 8, body.length & 255]), body]);
}

function decodeFrames(client, chunk) {
  client.buffer = Buffer.concat([client.buffer, chunk]);
  while (client.buffer.length >= 2) {
    const first = client.buffer[0];
    const opcode = first & 0x0f;
    const masked = (client.buffer[1] & 0x80) !== 0;
    let length = client.buffer[1] & 0x7f;
    let cursor = 2;
    if (length === 126) {
      if (client.buffer.length < 4) return;
      length = client.buffer.readUInt16BE(2);
      cursor = 4;
    }
    if (length > 65535 || !masked || client.buffer.length < cursor + 4 + length) return;
    const mask = client.buffer.subarray(cursor, cursor + 4);
    cursor += 4;
    const payload = Buffer.from(client.buffer.subarray(cursor, cursor + length));
    client.buffer = client.buffer.subarray(cursor + length);
    for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
    if (opcode === 0x8) return client.socket.end();
    if (opcode === 0x9) client.socket.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload]));
    if (opcode === 0x1) {
      try { handleMessage(client, JSON.parse(payload.toString("utf8"))); } catch { send(client.socket, { type: "notice", message: "That message could not be understood." }); }
    }
  }
}

server.on("upgrade", (req, socket) => {
  if (req.url !== "/ws" || req.headers.upgrade?.toLowerCase() !== "websocket") return socket.destroy();
  const key = req.headers["sec-websocket-key"];
  if (!key) return socket.destroy();
  const accept = crypto.createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
  socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n");
  const client = { socket, room: null, role: null, buffer: Buffer.alloc(0) };
  socket.on("data", data => decodeFrames(client, data));
  socket.on("close", () => leaveRoom(client));
  socket.on("error", () => leaveRoom(client));
});

server.listen(PORT, () => console.log(`Orbit Lock is running on http://localhost:${PORT}`));
