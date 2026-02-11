const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const scoreEl = document.getElementById("score");
const linesEl = document.getElementById("lines");
const raidersEl = document.getElementById("raiders");
const hullEl = document.getElementById("hull");
const statusEl = document.getElementById("status");
const restartBtn = document.getElementById("restart");

const COLS = 10;
const ROWS = 20;
const CELL = canvas.width / COLS;

const COLORS = {
  I: "#57d6ff",
  O: "#ffe164",
  T: "#d782ff",
  S: "#67ff91",
  Z: "#ff7a7a",
  J: "#7ca4ff",
  L: "#ffb067"
};

const SHAPES = {
  I: [[1, 1, 1, 1]],
  O: [[1, 1], [1, 1]],
  T: [[0, 1, 0], [1, 1, 1]],
  S: [[0, 1, 1], [1, 1, 0]],
  Z: [[1, 1, 0], [0, 1, 1]],
  J: [[1, 0, 0], [1, 1, 1]],
  L: [[0, 0, 1], [1, 1, 1]]
};

const state = {
  board: [],
  active: null,
  score: 0,
  lines: 0,
  hull: 5,
  raidersDestroyed: 0,
  bullets: [],
  enemies: [],
  gameOver: false,
  lastDrop: 0,
  dropMs: 500,
  enemyTimer: 0,
  enemyEvery: 1400,
  fireCooldown: 0,
  gameOverReason: ""
};

function makeBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(0));
}

function randomPiece() {
  const keys = Object.keys(SHAPES);
  const type = keys[Math.floor(Math.random() * keys.length)];
  return {
    type,
    matrix: SHAPES[type].map((row) => [...row]),
    x: Math.floor((COLS - SHAPES[type][0].length) / 2),
    y: -1
  };
}

function rotate(matrix) {
  return matrix[0].map((_, x) => matrix.map((row) => row[x]).reverse());
}

function collides(piece, board = state.board) {
  return piece.matrix.some((row, y) =>
    row.some((value, x) => {
      if (!value) return false;
      const nx = piece.x + x;
      const ny = piece.y + y;
      return nx < 0 || nx >= COLS || ny >= ROWS || (ny >= 0 && board[ny][nx]);
    })
  );
}

function mergePiece() {
  state.active.matrix.forEach((row, y) => {
    row.forEach((value, x) => {
      if (value) {
        const ny = state.active.y + y;
        if (ny >= 0) {
          state.board[ny][state.active.x + x] = state.active.type;
        }
      }
    });
  });
}

function clearLines() {
  let cleared = 0;
  state.board = state.board.filter((row) => {
    if (row.every(Boolean)) {
      cleared += 1;
      return false;
    }
    return true;
  });

  while (state.board.length < ROWS) {
    state.board.unshift(Array(COLS).fill(0));
  }

  if (cleared > 0) {
    state.lines += cleared;
    state.score += [0, 100, 260, 500, 900][cleared];
    state.dropMs = Math.max(150, state.dropMs - cleared * 8);
  }
}

function spawnEnemy() {
  const side = Math.floor(Math.random() * 4);
  const speed = 0.4 + Math.random() * 0.45;
  let x;
  let y;

  if (side === 0) {
    x = Math.random() * COLS;
    y = -1;
  } else if (side === 1) {
    x = COLS + 1;
    y = Math.random() * 8;
  } else if (side === 2) {
    x = Math.random() * COLS;
    y = 9 + Math.random() * 6;
  } else {
    x = -1;
    y = Math.random() * 8;
  }

  state.enemies.push({ x, y, speed, hp: 1 });
}

function settlePieceAndSpawnNext() {
  mergePiece();
  clearLines();
  state.active = randomPiece();
  if (collides(state.active)) {
    state.gameOver = true;
    state.gameOverReason = "Top-out: no space for the next piece.";
  }
}

function move(dx) {
  if (state.gameOver) return;
  const moved = { ...state.active, x: state.active.x + dx };
  if (!collides(moved)) {
    state.active = moved;
  }
}

function softDrop() {
  if (state.gameOver) return;
  const dropped = { ...state.active, y: state.active.y + 1 };
  if (collides(dropped)) {
    settlePieceAndSpawnNext();
  } else {
    state.active = dropped;
  }
}

function tryRotate() {
  if (state.gameOver) return;
  const rotated = { ...state.active, matrix: rotate(state.active.matrix) };
  if (!collides(rotated)) {
    state.active = rotated;
    return;
  }

  const kickedLeft = { ...rotated, x: rotated.x - 1 };
  if (!collides(kickedLeft)) {
    state.active = kickedLeft;
    return;
  }

  const kickedRight = { ...rotated, x: rotated.x + 1 };
  if (!collides(kickedRight)) {
    state.active = kickedRight;
  }
}

function fireBullet() {
  if (state.gameOver || state.fireCooldown > 0) return;
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  state.active.matrix.forEach((row, y) => {
    row.forEach((value, x) => {
      if (value) {
        sumX += state.active.x + x + 0.5;
        sumY += state.active.y + y + 0.5;
        count += 1;
      }
    });
  });

  if (count === 0) return;
  state.bullets.push({ x: sumX / count, y: sumY / count, vy: -0.6 });
  state.fireCooldown = 140;
}

function updateBullets(deltaMs) {
  const velocityFactor = deltaMs / 16.67;
  state.bullets.forEach((b) => {
    b.y += b.vy * velocityFactor;
  });
  state.bullets = state.bullets.filter((b) => b.y > -1.5);
}

function updateEnemies(deltaMs) {
  const velocityFactor = deltaMs / 16.67;
  const targetX = COLS / 2;
  const targetY = ROWS - 1;

  state.enemies.forEach((enemy) => {
    const dx = targetX - enemy.x;
    const dy = targetY - enemy.y;
    const length = Math.hypot(dx, dy) || 1;
    enemy.x += (dx / length) * enemy.speed * velocityFactor;
    enemy.y += (dy / length) * enemy.speed * velocityFactor;
  });

  state.enemies.forEach((enemy) => {
    if (enemy.y > ROWS - 0.8) {
      enemy.hp = 0;
      state.hull -= 1;
    }

    state.active.matrix.forEach((row, py) => {
      row.forEach((cell, px) => {
        if (!cell) return;
        const cx = state.active.x + px + 0.5;
        const cy = state.active.y + py + 0.5;
        const dist = Math.hypot(enemy.x - cx, enemy.y - cy);
        if (dist < 0.6) {
          enemy.hp = 0;
          state.hull -= 1;
        }
      });
    });
  });

  for (const bullet of state.bullets) {
    for (const enemy of state.enemies) {
      const dist = Math.hypot(enemy.x - bullet.x, enemy.y - bullet.y);
      if (enemy.hp > 0 && dist < 0.55) {
        enemy.hp -= 1;
        bullet.y = -10;
        if (enemy.hp <= 0) {
          state.score += 70;
          state.raidersDestroyed += 1;
        }
      }
    }
  }

  state.enemies = state.enemies.filter((enemy) => enemy.hp > 0);

  if (state.hull <= 0) {
    state.gameOver = true;
    state.gameOverReason = "Hull depleted: raiders breached your defenses.";
  }
}

function drawCell(x, y, color, glow = false) {
  const px = x * CELL;
  const py = y * CELL;
  ctx.fillStyle = color;
  ctx.fillRect(px + 1, py + 1, CELL - 2, CELL - 2);
  if (glow) {
    ctx.strokeStyle = "rgba(103,246,255,0.9)";
    ctx.lineWidth = 2;
    ctx.strokeRect(px + 1.5, py + 1.5, CELL - 3, CELL - 3);
  }
}

function drawBoard() {
  ctx.fillStyle = "#060913";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      ctx.strokeStyle = "#171b36";
      ctx.strokeRect(x * CELL, y * CELL, CELL, CELL);
      const cell = state.board[y][x];
      if (cell) {
        drawCell(x, y, COLORS[cell]);
      }
    }
  }

  state.active.matrix.forEach((row, y) => {
    row.forEach((value, x) => {
      if (!value) return;
      const py = state.active.y + y;
      if (py >= 0) {
        drawCell(state.active.x + x, py, COLORS[state.active.type], true);
      }
    });
  });

  state.bullets.forEach((bullet) => {
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(bullet.x * CELL, bullet.y * CELL, CELL * 0.14, 0, Math.PI * 2);
    ctx.fill();
  });

  state.enemies.forEach((enemy) => {
    ctx.fillStyle = "#ff2e7a";
    ctx.beginPath();
    ctx.arc(enemy.x * CELL, enemy.y * CELL, CELL * 0.32, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#ffc3d8";
    ctx.lineWidth = 2;
    ctx.stroke();
  });

  if (state.gameOver) {
    ctx.fillStyle = "rgba(3,4,10,0.78)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ff3f89";
    ctx.font = "bold 42px Trebuchet MS";
    ctx.textAlign = "center";
    ctx.fillText("RUN FAILED", canvas.width / 2, canvas.height / 2 - 12);
    ctx.fillStyle = "#d8e2ff";
    ctx.font = "20px Trebuchet MS";
    const reason = state.gameOverReason || "Run ended.";
    ctx.fillText(reason, canvas.width / 2, canvas.height / 2 + 20);
    ctx.font = "18px Trebuchet MS";
    ctx.fillText("Hit Restart to drop again", canvas.width / 2, canvas.height / 2 + 52);
  }
}

function updateHud() {
  scoreEl.textContent = state.score;
  linesEl.textContent = state.lines;
  raidersEl.textContent = state.raidersDestroyed;
  hullEl.textContent = Math.max(0, state.hull);
  if (state.gameOver) {
    statusEl.textContent = `Status: ${state.gameOverReason}`;
    return;
  }

  if (state.hull <= 2) {
    statusEl.textContent = "Status: Critical hull! Keep raiders off your stack.";
  } else {
    statusEl.textContent = "Status: Hold the line.";
  }
}

function update(timestamp) {
  if (!state.lastFrame) {
    state.lastFrame = timestamp;
  }

  const deltaMs = timestamp - state.lastFrame;
  state.lastFrame = timestamp;

  if (!state.gameOver) {
    state.lastDrop += deltaMs;
    state.enemyTimer += deltaMs;
    state.fireCooldown = Math.max(0, state.fireCooldown - deltaMs);

    if (state.lastDrop > state.dropMs) {
      softDrop();
      state.lastDrop = 0;
    }

    if (state.enemyTimer > state.enemyEvery) {
      spawnEnemy();
      state.enemyTimer = 0;
      state.enemyEvery = Math.max(500, state.enemyEvery - 3);
    }

    updateBullets(deltaMs);
    updateEnemies(deltaMs);
  }

  drawBoard();
  updateHud();
  requestAnimationFrame(update);
}

function reset() {
  state.board = makeBoard();
  state.active = randomPiece();
  state.score = 0;
  state.lines = 0;
  state.hull = 5;
  state.raidersDestroyed = 0;
  state.bullets = [];
  state.enemies = [];
  state.gameOver = false;
  state.lastDrop = 0;
  state.dropMs = 500;
  state.enemyTimer = 0;
  state.enemyEvery = 1400;
  state.fireCooldown = 0;
  state.gameOverReason = "";
  state.lastFrame = 0;
  updateHud();
}

window.addEventListener("keydown", (event) => {
  switch (event.key) {
    case "ArrowLeft":
      event.preventDefault();
      move(-1);
      break;
    case "ArrowRight":
      event.preventDefault();
      move(1);
      break;
    case "ArrowDown":
      event.preventDefault();
      softDrop();
      break;
    case "ArrowUp":
      event.preventDefault();
      tryRotate();
      break;
    case " ":
    case "Spacebar":
      event.preventDefault();
      fireBullet();
      break;
    default:
      break;
  }
});

restartBtn.addEventListener("click", reset);

reset();
requestAnimationFrame(update);
