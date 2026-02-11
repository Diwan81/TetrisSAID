const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const hud = document.getElementById('hud');

const COLS = 7;
const CELL = 60;
const VISIBLE_ROWS = 12;
const PLAYER_START_COL = Math.floor(COLS / 2);
const PLAYER_START_ROW = 2;
const MAX_SAFE_GAP = 3;

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
  elapsedMs: 0,
  lastFrameTime: null,
};

function createLane(type, speed, density) {
  return { type, speed, density, seed: Math.random() * 1000 };
}

function generateLane() {
  const roll = Math.random();
  if (roll < 0.3) return createLane('grass', 0, 0);
  if (roll < 0.7) {
    const speed = (Math.random() * 0.45 + 0.38) * (Math.random() < 0.5 ? -1 : 1);
    return createLane('road', speed, 0.14 + Math.random() * 0.1);
  }
  const speed = (Math.random() * 0.45 + 0.28) * (Math.random() < 0.5 ? -1 : 1);
  return createLane('river', speed, 0.12 + Math.random() * 0.1);
}

function ensureLanes() {
  while (state.lanes.length < state.laneCursor + VISIBLE_ROWS + 10) {
    state.lanes.push(generateLane());
  }
}

function ensureSafeStartPlatform() {
  for (let i = 0; i <= PLAYER_START_ROW + 1; i += 1) {
    state.lanes[i] = createLane('grass', 0, 0);
  }
}

function difficultyFactor() {
  // Adaptive AI: hesitation slightly amplifies spawn chance and speed.
  const h = Math.min(1, state.hesitation.streak / 24);
  return 1 + h * 0.12;
}

function progressionFactor() {
  // Gradual systemic ramp by score + survival time.
  const fromScore = Math.min(0.28, state.score * 0.008);
  const fromTime = Math.min(0.2, state.elapsedMs / 50000);
  return 1 + fromScore + fromTime;
}

function spawnObstacle(laneIndex, forcedX = null, ignoreCap = false) {
  const lane = state.lanes[laneIndex];
  if (!lane || lane.type === 'grass') return;

  const existingInLane = state.obstacles.filter((obs) => obs.laneIndex === laneIndex).length;
  if (!ignoreCap && existingInLane >= 2) return;

  const adaptive = difficultyFactor();
  const progression = progressionFactor();
  if (forcedX === null && Math.random() > lane.density * adaptive * progression) return;

  const direction = Math.sign(lane.speed) || 1;
  // Cars should always enter from lane edges for consistent readability.
  const edgeSpawnX = direction >= 0 ? -1.2 : COLS + 1.2;
  const x = lane.type === 'road' ? edgeSpawnX : (forcedX ?? edgeSpawnX);
  const width = lane.type === 'road' ? 0.75 + Math.random() * 0.2 : 1.05 + Math.random() * 0.3;
  const speed = lane.speed * adaptive * progression;

  if (lane.type === 'road') {
    const tooClose = state.obstacles
      .filter((obs) => obs.laneIndex === laneIndex && obs.type === 'car')
      .some((obs) => {
        const minDistance = 1.2;
        const newCenter = x + width / 2;
        const existingCenter = obs.x + obs.width / 2;
        return Math.abs(newCenter - existingCenter) < minDistance;
      });
    if (tooClose) return;
  }

  state.obstacles.push({
    laneIndex,
    x,
    width,
    speed,
    type: lane.type === 'road' ? 'car' : 'log',
  });
}

function enforceRoadGapLimit(laneIndex) {
  const lane = state.lanes[laneIndex];
  if (!lane || lane.type !== 'road') return;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const cars = state.obstacles
      .filter((obs) => obs.laneIndex === laneIndex && obs.type === 'car')
      .map((obs) => ({ start: obs.x, end: obs.x + obs.width }))
      .filter((seg) => seg.end > 0 && seg.start < COLS)
      .sort((a, b) => a.start - b.start);

    const gaps = [];
    let cursor = 0;
    cars.forEach((seg) => {
      if (seg.start > cursor) gaps.push({ start: cursor, end: seg.start });
      cursor = Math.max(cursor, seg.end);
    });
    if (cursor < COLS) gaps.push({ start: cursor, end: COLS });

    const wideGap = gaps.find((gap) => gap.end - gap.start > MAX_SAFE_GAP);
    if (!wideGap) return;

    const center = wideGap.start + (wideGap.end - wideGap.start) / 2;
    const forcedX = Math.max(0, Math.min(COLS - 1.05, center - 0.5));
    spawnObstacle(laneIndex, forcedX, true);
  }
}

function updateObstacles() {
  const low = state.laneCursor - 2;
  const high = state.laneCursor + VISIBLE_ROWS + 2;

  for (let laneIdx = low; laneIdx <= high; laneIdx += 1) {
    if (Math.random() < 0.14) spawnObstacle(laneIdx);
  }

  state.obstacles.forEach((obs) => {
    obs.x += obs.speed * 0.05;
  });

  for (let laneIdx = low; laneIdx <= high; laneIdx += 1) {
    enforceRoadGapLimit(laneIdx);
  }

  state.obstacles = state.obstacles.filter((obs) => obs.x > -3 && obs.x < COLS + 3);
}

function checkCollision() {
  if (!state.player.alive) return;

  const relevant = state.obstacles.filter((obs) => obs.laneIndex === state.player.row);
  const col = state.player.col;
  const hitMovingObject = relevant.some(
    (obs) => col > obs.x - 0.45 && col < obs.x + obs.width - 0.15,
  );

  if (hitMovingObject) {
    state.player.alive = false;
  }
}

function recordRunStep() {
  state.runPositions.push({ tick: state.tick, col: state.player.col, row: state.player.row });
}

function updateGhosts() {
  state.ghosts = state.runs.slice(-8).map((run, idx) => ({
    run,
    alpha: 0.16 + idx * 0.12,
  }));
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
  if (state.runPositions.length > 6) {
    state.runs.push(state.runPositions);
    if (state.runs.length > 8) state.runs.shift();
  }
  state.player = { col: PLAYER_START_COL, row: PLAYER_START_ROW, alive: true };
  state.obstacles = [];
  state.tick = 0;
  state.score = 0;
  state.elapsedMs = 0;
  state.lastFrameTime = null;
  state.runPositions = [];
  state.hesitation = { streak: 0, moveRate: 1 };
  updateCamera();
  ensureLanes();
  ensureSafeStartPlatform();
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
  state.ghosts.forEach((ghostRun) => {
    const { run, alpha } = ghostRun;
    if (run.length === 0) return;

    for (let i = 0; i < 40; i += 1) {
      const idx = (state.tick - i + run.length * 10) % run.length;
      const ghost = run[idx];
      const y = canvas.height - (ghost.row - state.laneCursor + 0.5) * CELL;
      if (y < -CELL || y > canvas.height) continue;
      const trailAlpha = alpha * (1 - i / 45);
      ctx.fillStyle = `rgba(143, 201, 255, ${trailAlpha})`;
      ctx.beginPath();
      ctx.arc((ghost.col + 0.5) * CELL, y, i === 0 ? 12 : 7, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function drawPlayer() {
  const y = canvas.height - (state.player.row - state.laneCursor + 0.5) * CELL;
  ctx.fillStyle = state.player.alive ? '#f5ff7c' : '#ff2f6d';
  ctx.beginPath();
  ctx.arc((state.player.col + 0.5) * CELL, y, 16, 0, Math.PI * 2);
  ctx.fill();
}

function formatTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
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
  const timerText = formatTime(state.elapsedMs);
  hud.textContent = state.player.alive
    ? `Score ${state.score} · Time ${timerText} · Echoes ${state.runs.length} · Adaptive +${adaptiveLevel}%`
    : `You failed. Press R to restart instantly. Score ${state.score} · Time ${timerText}`;
}

function step(timestamp) {
  if (state.lastFrameTime === null) state.lastFrameTime = timestamp;
  const delta = Math.min(50, timestamp - state.lastFrameTime);
  state.lastFrameTime = timestamp;

  if (state.player.alive) {
    state.elapsedMs += delta;
  }

  state.tick += 1;
  ensureLanes();
  ensureSafeStartPlatform();
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
requestAnimationFrame(step);
