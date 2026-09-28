const lobby = document.querySelector("#lobby");
const game = document.querySelector("#game");
const form = document.querySelector("#join-form");
const nameInput = document.querySelector("#name");
const roomInput = document.querySelector("#room-code");
const board = document.querySelector("#board");
const roomName = document.querySelector("#room-name");
const statusText = document.querySelector("#status");
const redName = document.querySelector("#red-name");
const goldName = document.querySelector("#gold-name");
const redCard = document.querySelector("#red-card");
const goldCard = document.querySelector("#gold-card");
const connection = document.querySelector("#connection");
const shareButton = document.querySelector("#share");
const rematch = document.querySelector("#rematch");
const toast = document.querySelector("#toast");

let socket;
let role = "spectator";
let state;
let toastTimer;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}

function roomFromUrl() { return new URLSearchParams(location.search).get("room")?.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5) || ""; }
function seatKey(room) { return `orbit-lock-seat-${room}`; }
function playerName() { return nameInput.value.trim() || "Pilot"; }
function setConnection(connected) { connection.classList.toggle("live", connected); connection.innerHTML = `<span class="signal"></span> ${connected ? "Channel live" : "Reconnecting…"}`; }

function drawBoard() {
  board.innerHTML = "";
  const canPlay = state?.status === "playing" && state.turn === role;
  for (let row = 0; row < 6; row += 1) {
    for (let col = 0; col < 7; col += 1) {
      const color = state?.board[row * 7 + col];
      const slot = document.createElement("button");
      slot.className = `slot ${color || ""} ${canPlay && !color ? "open" : ""}`;
      slot.type = "button";
      slot.setAttribute("role", "gridcell");
      slot.setAttribute("aria-label", color ? `${color} beacon` : `Drop beacon in column ${col + 1}`);
      slot.disabled = !canPlay || Boolean(color);
      slot.addEventListener("click", () => socket?.send(JSON.stringify({ type: "move", column: col })));
      board.append(slot);
    }
  }
}

function describeState() {
  if (!state) return "Opening a secure channel…";
  if (state.status === "finished") {
    if (state.winner === "draw") return "The starfield is full — this round is a draw.";
    return state.winner === role ? "Orbit Lock achieved — you win this round!" : `${state.names[state.winner]} achieves Orbit Lock!`;
  }
  if (!state.connected.red || !state.connected.gold) {
    const missing = !state.connected.red ? "red" : "gold";
    return role === "spectator" ? `Waiting for the ${missing} pilot to join.` : `Waiting for the other pilot to join this room…`;
  }
  return state.turn === role ? "Your turn — choose an orbit for your beacon." : `${state.names[state.turn]} is choosing an orbit…`;
}

function render(nextState) {
  state = nextState;
  roomName.textContent = state.room;
  redName.textContent = state.names.red;
  goldName.textContent = state.names.gold;
  redCard.classList.toggle("active-red", state.status === "playing" && state.turn === "red");
  goldCard.classList.toggle("active-gold", state.status === "playing" && state.turn === "gold");
  statusText.textContent = describeState();
  rematch.classList.toggle("hidden", state.status !== "finished" || role === "spectator");
  drawBoard();
}

function connect(room, name) {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  socket = new WebSocket(`${protocol}://${location.host}/ws`);
  socket.addEventListener("open", () => {
    setConnection(true);
    socket.send(JSON.stringify({ type: "join", room, name, seatToken: localStorage.getItem(seatKey(room)) || "" }));
  });
  socket.addEventListener("close", () => { setConnection(false); });
  socket.addEventListener("error", () => { setConnection(false); });
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (message.type === "joined") {
      role = message.role;
      if (message.seatToken) localStorage.setItem(seatKey(message.room), message.seatToken);
      const url = new URL(location.href); url.searchParams.set("room", message.room); history.replaceState({}, "", url);
      roomInput.value = message.room;
      roomName.textContent = message.room;
      if (role === "spectator") showToast("Both pilot seats are taken. You are watching live.");
    }
    if (message.type === "state") render(message);
    if (message.type === "notice") showToast(message.message);
  });
}

form.addEventListener("submit", event => {
  event.preventDefault();
  const room = roomInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
  localStorage.setItem("orbit-lock-name", playerName());
  lobby.classList.add("hidden");
  game.classList.remove("hidden");
  connect(room, playerName());
});
shareButton.addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(location.href); showToast("Invite link copied. Send it to your second pilot!"); }
  catch { showToast(`Share this room code: ${state?.room || roomFromUrl()}`); }
});
rematch.addEventListener("click", () => socket?.send(JSON.stringify({ type: "rematch" })));

nameInput.value = localStorage.getItem("orbit-lock-name") || "";
roomInput.value = roomFromUrl();
if (roomFromUrl()) {
  statusText.textContent = "Enter a display name to join this room.";
  nameInput.focus();
}
