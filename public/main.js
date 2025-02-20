// ===== Lobby and Game UI Setup =====
const lobbyDiv = document.getElementById('lobby');
const joinGameBtn = document.getElementById('joinGame');
const playerCountSpan = document.getElementById('playerCount');
const gameContainer = document.getElementById('gameContainer');
const returnLobbyBtn = document.getElementById('returnLobby');

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const socket = io();

let myPlayerRole = null; // Will be set by the server when the game starts

// When the user clicks "Join Game", notify the server.
joinGameBtn.addEventListener('click', () => {
  socket.emit('joinLobby');
});

// When the user clicks "Return to Lobby", notify the server and stop the game.
returnLobbyBtn.addEventListener('click', () => {
  socket.emit('returnToLobby');
  gameContainer.style.display = 'none';
  lobbyDiv.style.display = 'block';
  stopGame();
});

// Update lobby info (number of players waiting)
socket.on('lobbyUpdate', (data) => {
  playerCountSpan.textContent = data.count;
});

// When the server signals to start the game, assign roles, hide the lobby, and start the game.
socket.on('startGame', (data) => {
  myPlayerRole = data.role;
  // Assign myPlayer and remotePlayer based on the role received:
  if (myPlayerRole === "player1") {
    myPlayer = player1;
    remotePlayer = player2;
    player1.isControlled = true;
    player2.isControlled = false;
  } else {
    myPlayer = player2;
    remotePlayer = player1;
    player2.isControlled = true;
    player1.isControlled = false;
  }
  // Reset remote update timestamp so we don't immediately flag disconnection.
  remoteLastUpdate = performance.now();
  lobbyDiv.style.display = 'none';
  gameContainer.style.display = 'block';
  startGame();
});

// (Optional) When the server tells you to return to the lobby.
socket.on('returnedToLobby', () => {
  gameContainer.style.display = 'none';
  lobbyDiv.style.display = 'block';
  stopGame();
});

// ===== Game Code =====

// Capture keyboard inputs
const keys = {};
window.addEventListener('keydown', (e) => { keys[e.key.toLowerCase()] = true; });
window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

// Global game state for round and match management
let roundOver = false;
let matchOver = false;
let roundWinner = null;
let score1 = 0;
let score2 = 0;
let roundCount = 1;
const roundResetDelay = 2000; // ms delay after round finishes

// Countdown state for new rounds
let inCountdown = true;
const countdownDuration = 3000; // ms countdown
const goDelay = 1000;           // ms "Go!" display duration
let countdownStartTime = performance.now();

// Flags for opponent state
let remoteDisconnected = false;
let remoteLastUpdate = performance.now();

// Starting positions
const startingPositions = {
  player1: { x: 100, y: 100 },
  player2: { x: 300, y: 300 }
};

// Utility functions
function clamp(val, min, max) {
  return Math.max(min, Math.min(val, max));
}
function circleRectCollision(cx, cy, radius, rx, ry, rw, rh) {
  let closestX = clamp(cx, rx, rx + rw);
  let closestY = clamp(cy, ry, ry + rh);
  let distX = cx - closestX;
  let distY = cy - closestY;
  return (distX * distX + distY * distY) <= (radius * radius);
}

// --- Sword Class ---
class Sword {
  constructor(owner) {
    this.owner = owner;
    this.state = "idle"; // "idle", "swinging", "cooldown"
    this.startTime = 0;
    this.swingDuration = 150;
    this.cooldownDuration = 200;
    this.swingArc = Math.PI / 2;
    this.startAngle = 0;
    this.endAngle = 0;
    this.currentAngle = 0;
    this.length = 40;
    this.width = 8;
  }
  
  startSwing(targetAngle) {
    if (this.state === "idle" && !roundOver && !inCountdown && !matchOver && !remoteDisconnected) {
      this.state = "swinging";
      this.startTime = performance.now();
      this.startAngle = targetAngle - this.swingArc / 2;
      this.endAngle = targetAngle + this.swingArc / 2;
    }
  }
  
  update() {
    if (this.state === "swinging") {
      const now = performance.now();
      const elapsed = now - this.startTime;
      if (elapsed >= this.swingDuration) {
        this.currentAngle = this.endAngle;
        this.state = "cooldown";
        this.startTime = now;
      } else {
        const t = elapsed / this.swingDuration;
        this.currentAngle = this.startAngle + (this.endAngle - this.startAngle) * t;
      }
    } else if (this.state === "cooldown") {
      const now = performance.now();
      const elapsed = now - this.startTime;
      if (elapsed >= this.cooldownDuration) {
        this.state = "idle";
      }
    }
  }
  
  draw(ctx) {
    if (this.state === "swinging" || this.state === "cooldown") {
      const owner = this.owner;
      ctx.save();
      ctx.translate(owner.x, owner.y);
      ctx.rotate(this.currentAngle);
      ctx.fillStyle = "gray";
      ctx.fillRect(0, -this.width / 2, this.length, this.width);
      ctx.restore();
    }
  }
}

// --- Player Class ---
// The key change here: Only the controlled player will run physics simulation.
class Player {
  constructor(x, y, radius, color) {
    this.x = x; this.y = y; this.radius = radius; this.color = color;
    this.vx = 0; this.vy = 0;
    this.acceleration = 0.7; this.friction = 0.85; this.maxSpeed = 6; this.bounceFactor = 0.2;
    this.sword = new Sword(this);
    this.isControlled = false;
  }
  
  update() {
    // Only run physics simulation if this is the controlled player.
    if (!this.isControlled) return;
    
    if (this.isControlled && !roundOver && !inCountdown && !matchOver && !remoteDisconnected) {
      if (keys['w']) { this.vy -= this.acceleration; }
      if (keys['s']) { this.vy += this.acceleration; }
      if (keys['a']) { this.vx -= this.acceleration; }
      if (keys['d']) { this.vx += this.acceleration; }
    }
    this.vx *= this.friction; 
    this.vy *= this.friction;
    const speed = Math.hypot(this.vx, this.vy);
    if (speed > this.maxSpeed) {
      this.vx = (this.vx / speed) * this.maxSpeed;
      this.vy = (this.vy / speed) * this.maxSpeed;
    }
    this.x += this.vx; 
    this.y += this.vy;
    
    if (this.x - this.radius < 0) { this.x = this.radius; this.vx = Math.abs(this.vx) * this.bounceFactor; }
    if (this.x + this.radius > canvas.width) { this.x = canvas.width - this.radius; this.vx = -Math.abs(this.vx) * this.bounceFactor; }
    if (this.y - this.radius < 0) { this.y = this.radius; this.vy = Math.abs(this.vy) * this.bounceFactor; }
    if (this.y + this.radius > canvas.height) { this.y = canvas.height - this.radius; this.vy = -Math.abs(this.vy) * this.bounceFactor; }
    
    // Update sword only for the controlled player.
    this.sword.update();
  }
  
  draw() {
    ctx.beginPath();
    ctx.fillStyle = this.color;
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fill();
    this.sword.draw(ctx);
  }
}

function drawArena() {
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, canvas.width, canvas.height);
}

function handlePlayerCollision(p1, p2) {
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const distance = Math.hypot(dx, dy), minDistance = p1.radius + p2.radius;
  if (distance < minDistance) {
    const nx = dx / distance, ny = dy / distance, pushback = 2;
    p1.x -= nx * pushback; p1.y -= ny * pushback;
    if (p2.isControlled) { p2.x += nx * pushback; p2.y += ny * pushback; }
  }
}

function circleRectCollisionForSword(sword, opponent) {
  const owner = sword.owner;
  let dx = opponent.x - owner.x, dy = opponent.y - owner.y;
  let angle = -sword.currentAngle;
  let localX = dx * Math.cos(angle) - dy * Math.sin(angle);
  let localY = dx * Math.sin(angle) + dy * Math.cos(angle);
  return circleRectCollision(localX, localY, opponent.radius, 0, -sword.width / 2, sword.length, sword.width);
}

function checkSwordHits() {
  if (!roundOver && !matchOver && myPlayerRole) {
    if ((myPlayer.sword.state === "swinging" || myPlayer.sword.state === "cooldown") &&
        circleRectCollisionForSword(myPlayer.sword, remotePlayer)) {
      socket.emit("roundOver", { winner: myPlayerRole });
    } else if ((remotePlayer.sword.state === "swinging" || remotePlayer.sword.state === "cooldown") &&
               circleRectCollisionForSword(remotePlayer.sword, myPlayer)) {
      const winner = (myPlayerRole === "player1" ? "player2" : "player1");
      socket.emit("roundOver", { winner: winner });
    }
  }
}

socket.on('roundOver', (data) => {
  if (!roundOver && !matchOver) {
    roundOver = true;
    roundWinner = data.winner;
    if (data.winner === "player1") { score1++; } else { score2++; }
    setTimeout(resetRound, roundResetDelay);
  }
});

function resetRound() {
  // Reset remoteLastUpdate so remote isn't marked disconnected immediately.
  remoteLastUpdate = performance.now();
  
  player1.x = startingPositions.player1.x; player1.y = startingPositions.player1.y;
  player1.vx = 0; player1.vy = 0; player1.sword.state = "idle";
  player2.x = startingPositions.player2.x; player2.y = startingPositions.player2.y;
  player2.vx = 0; player2.vy = 0; player2.sword.state = "idle";
  
  if (score1 === 3 || score2 === 3) { matchOver = true; }
  else { roundOver = false; inCountdown = true; countdownStartTime = performance.now(); roundCount++; }
}

function drawUI() {
  ctx.fillStyle = 'black';
  ctx.font = '20px Arial';
  ctx.textAlign = 'left';
  ctx.fillText(`Player 1: ${score1}`, 10, 25);
  ctx.fillText(`Player 2: ${score2}`, 10, 50);
  ctx.fillText(`Round: ${roundCount}`, 10, 75);
  
  if (remoteDisconnected) {
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "white";
    ctx.font = "36px Arial";
    ctx.textAlign = "center";
    ctx.fillText("Waiting for opponent...", canvas.width / 2, canvas.height / 2);
  }
}

function drawCountdownOverlay() {
  let now = performance.now();
  let elapsed = now - countdownStartTime;
  ctx.fillStyle = "rgba(0,0,0,0.7)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "white";
  ctx.font = "48px Arial";
  ctx.textAlign = "center";
  
  if (elapsed < countdownDuration) {
    let remaining = Math.ceil((countdownDuration - elapsed) / 1000);
    ctx.fillText(remaining, canvas.width / 2, canvas.height / 2);
  } else if (elapsed < countdownDuration + goDelay) {
    ctx.fillText("Go!", canvas.width / 2, canvas.height / 2);
  } else {
    inCountdown = false;
  }
}

function drawRoundWinnerOverlay() {
  ctx.fillStyle = "rgba(0,0,0,0.7)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "white";
  ctx.font = "36px Arial";
  ctx.textAlign = "center";
  ctx.fillText(`${roundWinner} wins the round!`, canvas.width / 2, canvas.height / 2);
}

function drawMatchOverOverlay() {
  ctx.fillStyle = "rgba(0,0,0,0.7)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "white";
  ctx.font = "36px Arial";
  ctx.textAlign = "center";
  let winner = score1 === 3 ? "Player 1" : "Player 2";
  ctx.fillText(`Game Over - Winner: ${winner}`, canvas.width / 2, canvas.height / 2);
}

// ---- Initialization ----
let player1 = new Player(startingPositions.player1.x, startingPositions.player1.y, 20, 'blue');
let player2 = new Player(startingPositions.player2.x, startingPositions.player2.y, 20, 'red');

let myPlayer, remotePlayer;
// Role assignment now happens in the 'startGame' event from the server.

// Update remote player's state when received.
socket.on('playerState', (data) => {
  remoteLastUpdate = performance.now();
  remotePlayer.x += (data.x - remotePlayer.x) * 0.05;
  remotePlayer.y += (data.y - remotePlayer.y) * 0.05;
  remotePlayer.vx = data.vx;
  remotePlayer.vy = data.vy;
  remotePlayer.sword.state = data.swordState;
  remotePlayer.sword.startAngle = data.swordStartAngle;
  remotePlayer.sword.endAngle = data.swordEndAngle;
  if (data.swordState === "swinging") {
    remotePlayer.sword.currentAngle = data.swordStartAngle + (data.swordEndAngle - data.swordStartAngle) * data.swordProgress;
  } else if (data.swordState === "cooldown") {
    remotePlayer.sword.currentAngle = data.swordEndAngle;
  }
});

function checkRemoteConnection() {
  // During countdown, assume remote is connected.
  if (inCountdown) {
    remoteDisconnected = false;
    return;
  }
  if (performance.now() - remoteLastUpdate > 5000) {
    remoteDisconnected = true;
  } else {
    remoteDisconnected = false;
  }
}

socket.on('playerDisconnected', () => {
  remoteDisconnected = true;
});

canvas.addEventListener('mousedown', (e) => {
  if (!roundOver && !inCountdown && !matchOver && !remoteDisconnected && myPlayer) {
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const targetAngle = Math.atan2(mouseY - myPlayer.y, mouseX - myPlayer.x);
    myPlayer.sword.startSwing(targetAngle);
  }
});

let gameLoopId = null;
function gameLoop() {
  if (!myPlayer || !remotePlayer) {
    requestAnimationFrame(gameLoop);
    return;
  }
  
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawArena();
  
  checkRemoteConnection();
  
  if (!matchOver && !roundOver && !inCountdown && !remoteDisconnected && myPlayer && remotePlayer) {
    myPlayer.update();
    // Remote player's update() is now a no-op.
    handlePlayerCollision(myPlayer, remotePlayer);
    checkSwordHits();
    let swordProgress = 0;
    if (myPlayer.sword.state === "swinging") {
      swordProgress = (performance.now() - myPlayer.sword.startTime) / myPlayer.sword.swingDuration;
      if (swordProgress > 1) swordProgress = 1;
    } else if (myPlayer.sword.state === "cooldown") {
      swordProgress = 1;
    }
    socket.emit('playerState', {
      x: myPlayer.x,
      y: myPlayer.y,
      vx: myPlayer.vx,
      vy: myPlayer.vy,
      swordState: myPlayer.sword.state,
      swordStartAngle: myPlayer.sword.startAngle,
      swordEndAngle: myPlayer.sword.endAngle,
      swordProgress: swordProgress
    });
  } else if (inCountdown && myPlayer && remotePlayer) {
    myPlayer.update();
    // Remote player's state is updated via network.
  }
  
  myPlayer.draw();
  remotePlayer.draw();
  drawUI();
  
  if (matchOver) {
    drawMatchOverOverlay();
  } else if (inCountdown) {
    drawCountdownOverlay();
  } else if (roundOver) {
    drawRoundWinnerOverlay();
  }
  
  gameLoopId = requestAnimationFrame(gameLoop);
}

function startGame() {
  // Reset game variables
  roundOver = false;
  matchOver = false;
  roundWinner = null;
  score1 = 0;
  score2 = 0;
  roundCount = 1;
  inCountdown = true;
  countdownStartTime = performance.now();
  remoteDisconnected = false;
  remoteLastUpdate = performance.now();
  
  // Reset player positions and states
  player1.x = startingPositions.player1.x;
  player1.y = startingPositions.player1.y;
  player1.vx = 0;
  player1.vy = 0;
  player1.sword.state = "idle";
  
  player2.x = startingPositions.player2.x;
  player2.y = startingPositions.player2.y;
  player2.vx = 0;
  player2.vy = 0;
  player2.sword.state = "idle";
  
  gameLoop();
}

function stopGame() {
  if (gameLoopId) {
    cancelAnimationFrame(gameLoopId);
  }
}
