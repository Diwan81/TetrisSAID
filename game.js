const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const hud = document.getElementById('hud');

const COLS = 7;
const CELL = 60;
const VISIBLE_ROWS = 12;
const PLAYER_START_COL = Math.floor(COLS / 2);
const PLAYER_START_ROW = 2;

const COLORS = {
  grass: '#365f35',
  road: '#2f3238',
  river: '#215a87',
};

const state = {
  lanes: [],
  laneCursor: 0,
  player: { col: PLAYER_START_COL, row: PLAYER_START_ROW, alive: true },
  obstacles: [],
  tick: 0,
  score: 0,
  runs: [],
  runPositions: [],
  ghosts: [],
  hesitation: { streak: 0, moveRate: 1 },
};

function createLane(type, speed, density) {
  return { type, speed, density, seed: Math.random() * 1000 };
}

function generateLane() {
  const roll = Math.random();
  if (roll < 0.3) return createLane('grass', 0, 0);
  if (roll < 0.7) {
    const speed = (Math.random() * 1.4 + 0.8) * (Math.random() < 0.5 ? -1 : 1);
    return createLane('road', speed, 0.2 + Math.random() * 0.18);
  }
  const speed = (Math.random() * 0.6 + 0.4) * (Math.random() < 0.5 ? -1 : 1);
  return createLane('river', speed, 0.26 + Math.random() * 0.14);
}

function ensureLanes() {
  while (state.lanes.length < state.laneCursor + VISIBLE_ROWS + 10) {
    state.lanes.push(generateLane());
  }
}

function difficultyFactor() {
  // Adaptive AI: hesitation slightly amplifies spawn chance and speed.
  const h = Math.min(1, state.hesitation.streak / 24);
  return 1 + h * 0.35;
}

function spawnObstacle(laneIndex) {
  const lane = state.lanes[laneIndex];
  if (!lane || lane.type === 'grass') return;

  const adaptive = difficultyFactor();
  if (Math.random() > lane.density * adaptive) return;

  const direction = Math.sign(lane.speed);
  const x = direction >= 0 ? -1.2 : COLS + 1.2;
  const width = lane.type === 'road' ? 1.2 : 1.8;
  const speed = lane.speed * adaptive;

  state.obstacles.push({
    laneIndex,
    x,
    width,
    speed,
    type: lane.type === 'road' ? 'car' : 'log',
  });
}

function updateObstacles() {
  const low = state.laneCursor - 2;
  const high = state.laneCursor + VISIBLE_ROWS + 2;

  for (let laneIdx = low; laneIdx <= high; laneIdx += 1) {
    if (Math.random() < 0.25) spawnObstacle(laneIdx);
  }

  state.obstacles.forEach((obs) => {
    obs.x += obs.speed * 0.05;
  });

  state.obstacles = state.obstacles.filter((obs) => obs.x > -3 && obs.x < COLS + 3);
}

function laneAtPlayer() {
  return state.lanes[state.player.row];
}

function checkCollision() {
  const lane = laneAtPlayer();
  if (!lane || !state.player.alive) return;

  const relevant = state.obstacles.filter((obs) => obs.laneIndex === state.player.row);
  const col = state.player.col;

  if (lane.type === 'road') {
    const hit = relevant.some((obs) => col > obs.x - 0.45 && col < obs.x + obs.width - 0.15);
    if (hit) state.player.alive = false;
    return;
  }

  if (lane.type === 'river') {
    const carryingLog = relevant.find((obs) => col > obs.x - 0.4 && col < obs.x + obs.width - 0.2);
    if (!carryingLog) {
      state.player.alive = false;
      return;
    }
    state.player.col += carryingLog.speed * 0.05;
    if (state.player.col < 0 || state.player.col > COLS - 1) {
      state.player.alive = false;
    }
  }
}

function recordRunStep() {
  state.runPositions.push({ tick: state.tick, col: state.player.col, row: state.player.row });
}

function updateGhosts() {
  state.ghosts = state.runs.slice(-3).map((run, idx) => {
    const step = run[state.tick % run.length];
    return { ...step, alpha: 0.22 + idx * 0.2 };
  });
}

function playerMove(dx, dy) {
  if (!state.player.alive) return;
  const oldRow = state.player.row;
  state.player.col = Math.max(0, Math.min(COLS - 1, state.player.col + dx));
  state.player.row = Math.max(0, state.player.row + dy);
  if (state.player.row > oldRow) {
    state.score = Math.max(state.score, state.player.row - PLAYER_START_ROW);
    state.hesitation.streak = Math.max(0, state.hesitation.streak - 5);
  }
}

function updateCamera() {
  state.laneCursor = Math.max(0, Math.floor(state.player.row) - 2);
}

function updateHesitation(movedForward) {
  if (!movedForward) state.hesitation.streak += 1;
  state.hesitation.moveRate *= 0.92;
}

function resetRun() {
  if (state.runPositions.length > 20) {
    state.runs.push(state.runPositions);
  }
  state.player = { col: PLAYER_START_COL, row: PLAYER_START_ROW, alive: true };
  state.obstacles = [];
  state.tick = 0;
  state.score = 0;
  state.runPositions = [];
  state.hesitation = { streak: 0, moveRate: 1 };
  updateCamera();
  ensureLanes();
}

window.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  let movedForward = false;
  if (key === 'w') {
    playerMove(0, 1);
    movedForward = true;
    state.hesitation.moveRate += 1;
  } else if (key === 'a') {
    playerMove(-1, 0);
  } else if (key === 'd') {
    playerMove(1, 0);
  } else if (key === 'r') {
    resetRun();
    return;
  }
  updateHesitation(movedForward);
});

function drawLane(y, lane) {
  ctx.fillStyle = COLORS[lane.type];
  ctx.fillRect(0, y, canvas.width, CELL);

  if (lane.type === 'road') {
    ctx.strokeStyle = '#c8c8c833';
    ctx.setLineDash([12, 12]);
    ctx.beginPath();
    ctx.moveTo(0, y + CELL / 2);
    ctx.lineTo(canvas.width, y + CELL / 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawObstacles() {
  state.obstacles.forEach((obs) => {
    const y = canvas.height - (obs.laneIndex - state.laneCursor + 1) * CELL;
    if (y < -CELL || y > canvas.height) return;
    ctx.fillStyle = obs.type === 'car' ? '#ff5f5f' : '#b0814e';
    ctx.fillRect(obs.x * CELL, y + 8, obs.width * CELL, CELL - 16);
  });
}

function drawGhosts() {
  state.ghosts.forEach((ghost) => {
    const y = canvas.height - (ghost.row - state.laneCursor + 0.5) * CELL;
    if (y < -CELL || y > canvas.height) return;
    ctx.fillStyle = `rgba(143, 201, 255, ${ghost.alpha})`;
    ctx.beginPath();
    ctx.arc((ghost.col + 0.5) * CELL, y, 14, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawPlayer() {
  const y = canvas.height - (state.player.row - state.laneCursor + 0.5) * CELL;
  ctx.fillStyle = state.player.alive ? '#f5ff7c' : '#ff2f6d';
  ctx.beginPath();
  ctx.arc((state.player.col + 0.5) * CELL, y, 16, 0, Math.PI * 2);
  ctx.fill();
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (let row = 0; row < VISIBLE_ROWS; row += 1) {
    const laneIndex = state.laneCursor + row;
    const lane = state.lanes[laneIndex] || createLane('grass', 0, 0);
    const y = canvas.height - (row + 1) * CELL;
    drawLane(y, lane);
  }

  drawObstacles();
  drawGhosts();
  drawPlayer();

  const adaptiveLevel = ((difficultyFactor() - 1) * 100).toFixed(0);
  hud.textContent = state.player.alive
    ? `Score ${state.score} · Echoes ${state.runs.length} · Adaptive pressure +${adaptiveLevel}%`
    : `You failed. Press R to restart instantly. Score ${state.score}`;
}

function step() {
  state.tick += 1;
  ensureLanes();
  updateCamera();

  if (state.player.alive) {
    updateObstacles();
    checkCollision();
    recordRunStep();
  }

  updateGhosts();
  render();
  requestAnimationFrame(step);
}

resetRun();
step();
