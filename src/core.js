"use strict";

/* =========================================================
 *  Tetris core - pure state + simulation.
 *
 *  This module does not know a browser exists: no DOM, no
 *  canvas, no requestAnimationFrame, no performance.now(),
 *  no localStorage. The caller owns the clock and feeds
 *  step(deltaMs); the core owns every rule.
 *
 *  Determinism: same state + same delta = same result.
 *  Randomness is injected via options.rng so tests can force
 *  the 7-bag. Persistence is exposed as a value, never
 *  written here.
 * ========================================================= */

// ---------- Constants ----------
export const COLS = 10;
export const ROWS = 20;

// Base drop interval (ms) at level 1; decreases every level.
export const BASE_DROP_INTERVAL = 800;

// Points per line-clear count (single/double/triple/tetris), x level.
export const SCORE_TABLE = [0, 100, 300, 500, 800];
export const LINES_PER_LEVEL = 10;

// v0.2 tuning (unchanged by the v0.3 refactor).
export const LOCK_DELAY_MS = 500;   // grace period before a grounded piece locks
export const MAX_LOCK_RESETS = 15;  // cap on lock-delay resets per piece
export const CLEAR_FLASH_MS = 180;  // line-clear flash; simulation freezes
export const DAS_MS = 170;          // delayed auto shift: hold delay
export const ARR_MS = 50;           // auto repeat rate once DAS has charged

// ---------- Tetromino definitions (SRS spawn states) ----------
export const PIECES = {
  I: { color: "#22d3ee", matrix: [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]] },
  O: { color: "#facc15", matrix: [[1,1],[1,1]] },
  T: { color: "#c084fc", matrix: [[0,1,0],[1,1,1],[0,0,0]] },
  S: { color: "#4ade80", matrix: [[0,1,1],[1,1,0],[0,0,0]] },
  Z: { color: "#f87171", matrix: [[1,1,0],[0,1,1],[0,0,0]] },
  J: { color: "#60a5fa", matrix: [[1,0,0],[1,1,1],[0,0,0]] },
  L: { color: "#fb923c", matrix: [[0,0,1],[1,1,1],[0,0,0]] },
};

export const PIECE_TYPES = Object.keys(PIECES);

// ---------- SRS wall-kick tables ----------
// Kicks are attempted in order after a rotation. Keys are the rotation
// transition as "from>to"; the SAME lookup serves both directions.
export const KICKS = {
  normal: {
    "0>1": [[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]],
    "1>0": [[0,0],[1,0],[1,-1],[0,2],[1,2]],
    "1>2": [[0,0],[1,0],[1,-1],[0,2],[1,2]],
    "2>1": [[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]],
    "2>3": [[0,0],[1,0],[1,1],[0,-2],[1,-2]],
    "3>2": [[0,0],[-1,0],[-1,-1],[0,2],[-1,2]],
    "3>0": [[0,0],[-1,0],[-1,-1],[0,2],[-1,2]],
    "0>3": [[0,0],[1,0],[1,1],[0,-2],[1,-2]],
  },
  I: {
    "0>1": [[0,0],[-2,0],[1,0],[-2,-1],[1,2]],
    "1>0": [[0,0],[2,0],[-1,0],[2,1],[-1,-2]],
    "1>2": [[0,0],[-1,0],[2,0],[-1,2],[2,-1]],
    "2>1": [[0,0],[1,0],[-2,0],[1,-2],[-2,1]],
    "2>3": [[0,0],[2,0],[-1,0],[2,1],[-1,-2]],
    "3>2": [[0,0],[-2,0],[1,0],[-2,-1],[1,2]],
    "3>0": [[0,0],[1,0],[-2,0],[1,-2],[-2,1]],
    "0>3": [[0,0],[-1,0],[2,0],[-1,2],[2,-1]],
  },
};

// ---------- Matrix helpers (pure) ----------

// Rotate an NxN matrix clockwise.
export function rotateCW(matrix) {
  const n = matrix.length;
  const result = Array.from({ length: n }, () => Array(n).fill(0));
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      result[c][n - 1 - r] = matrix[r][c];
  return result;
}

// Rotate counter-clockwise.
export function rotateCCW(matrix) {
  const n = matrix.length;
  const result = Array.from({ length: n }, () => Array(n).fill(0));
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      result[n - 1 - c][r] = matrix[r][c];
  return result;
}

// Occupied cell coordinates of a matrix, relative to its origin.
export function cellsOf(matrix) {
  const cells = [];
  for (let r = 0; r < matrix.length; r++)
    for (let c = 0; c < matrix.length; c++)
      if (matrix[r][c]) cells.push([r, c]);
  return cells;
}

// Build an empty board grid.
function emptyBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}

/* =========================================================
 *  createGame(options)
 *  options.rng: () => number in [0,1). Defaults to Math.random.
 * ========================================================= */
export function createGame(options = {}) {
  const rng = typeof options.rng === "function" ? options.rng : Math.random;

  // ---------- Internal state (single owner) ----------
  const state = {
    board: emptyBoard(),
    current: null,      // active piece {type, matrix, color, x, y, rot}
    nextType: null,     // preview piece type
    bag: [],            // 7-bag randomizer queue
    score: 0,
    level: 1,
    lines: 0,
    dropCounter: 0,
    dropInterval: BASE_DROP_INTERVAL,
    gameOver: false,
    paused: false,
    // v0.2 state
    holdType: null,     // piece type parked in reserve, or null when empty
    holdUsed: false,    // true once the hold slot is spent for this piece
    lockTimer: 0,       // ms spent grounded without downward progress
    lockResets: 0,      // lock-delay resets consumed by the current piece
    lowestY: 0,         // lowest row the current piece has reached
    clearing: null,     // { rows, timer } while the clear flash plays
    moveDir: 0,         // -1 / 0 / 1 horizontal direction held
    dasTimer: 0,        // ms since the direction was pressed
    arrTimer: 0,        // ms accumulator once DAS has charged
    dasCharged: false,  // true once the initial DAS delay has elapsed
    highScore: 0,       // best score ever (persisted by the caller)
    recordBeaten: false,// running game has beaten the stored record
  };

  // Listeners notified about things the UI must react to. The core never
  // touches storage or the DOM; it just reports.
  const listeners = new Set();

  function emit(type, payload) {
    for (const fn of listeners) fn(type, payload);
  }

  // ---------- 7-bag randomizer ----------
  function refillBag() {
    const types = PIECE_TYPES.slice();
    for (let i = types.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [types[i], types[j]] = [types[j], types[i]];
    }
    state.bag.push(...types);
  }

  function nextPieceType() {
    if (state.bag.length === 0) refillBag();
    return state.bag.shift();
  }

  // ---------- Piece creation & collision ----------
  function createPiece(type) {
    const def = PIECES[type];
    return {
      type,
      matrix: def.matrix.map((row) => row.slice()),
      color: def.color,
      x: Math.floor((COLS - def.matrix.length) / 2),
      y: type === "I" ? 0 : 1, // spawn just below the top edge
      rot: 0,
    };
  }

  // `piece` may be the live active piece or a plain {matrix, x, y} target.
  function collides(piece, x, y) {
    const matrix = piece.matrix;
    for (const [r, c] of cellsOf(matrix)) {
      const bx = x + c;
      const by = y + r;
      if (bx < 0 || bx >= COLS || by >= ROWS) return true;
      if (by >= 0 && state.board[by][bx]) return true;
    }
    return false;
  }

  function grounded() {
    return collides(state.current, state.current.x, state.current.y + 1);
  }

  // ---------- Lock delay ----------
  function resetLockDelay() {
    if (!grounded() || state.lockResets >= MAX_LOCK_RESETS) return;
    state.lockTimer = 0;
    state.lockResets++;
  }

  function resetLockState() {
    state.lockTimer = 0;
    state.lockResets = 0;
    state.lowestY = state.current.y;
    state.dropCounter = 0;
  }

  function clearMoveState() {
    state.moveDir = 0;
    state.dasTimer = 0;
    state.arrTimer = 0;
    state.dasCharged = false;
  }

  // ---------- Intents ----------

  // dir: +1 clockwise, -1 counter-clockwise. No-op during the flash.
  function rotate(dir) {
    if (state.clearing || state.gameOver || state.paused) return false;
    const cur = state.current;
    const rotated = dir > 0 ? rotateCW(cur.matrix) : rotateCCW(cur.matrix);
    const from = cur.rot;
    const to = (from + (dir > 0 ? 1 : 3)) % 4;

    // Unified lookup: the SAME "from>to" key serves both directions.
    // (v0.1 mirrored the index for CCW, which read the inverse row.)
    const table = cur.type === "I" ? KICKS.I : KICKS.normal;
    const key = `${from}>${to}`;
    const kicks = cur.type === "O" ? [[0, 0]] : table[key];

    for (const [dx, dy] of kicks) {
      // SRS tables use y-up; the grid grows downward, so invert dy.
      const nx = cur.x + dx;
      const ny = cur.y - dy;
      if (!collides({ matrix: rotated, x: nx, y: ny }, nx, ny)) {
        cur.matrix = rotated;
        cur.x = nx;
        cur.y = ny;
        cur.rot = to;
        resetLockDelay();
        return true;
      }
    }
    return false; // all kicks failed: rotation cancelled
  }

  // dir: -1 left, +1 right. No-op during the flash.
  function move(dir) {
    if (state.clearing || state.gameOver || state.paused) return false;
    const cur = state.current;
    if (collides(cur, cur.x + dir, cur.y)) return false;
    cur.x += dir;
    resetLockDelay();
    return true;
  }

  // One row down on request; the lock delay decides when it settles.
  function softDrop() {
    if (state.clearing || state.gameOver || state.paused) return false;
    if (grounded()) return false;
    state.current.y++;
    state.score += 1;
    state.dropCounter = 0;
    checkHighScore();
    return true;
  }

  function hardDrop() {
    if (state.clearing || state.gameOver || state.paused) return false;
    let distance = 0;
    while (!collides(state.current, state.current.x, state.current.y + 1)) {
      state.current.y++;
      distance++;
    }
    state.score += distance * 2;
    checkHighScore();
    lockPiece(); // hard drop always locks at once, bypassing the lock delay
    return true;
  }

  // Park the active piece and bring in the held one (or the next piece on
  // the first hold). One hold per locked piece.
  function holdPiece() {
    if (state.holdUsed || state.gameOver || state.paused || state.clearing) return false;

    const incoming = state.holdType; // null the first time around
    state.holdType = state.current.type;
    state.holdUsed = true;

    if (incoming) {
      state.current = createPiece(incoming);
    } else {
      state.current = createPiece(state.nextType);
      state.nextType = nextPieceType();
      emit("next", { nextType: state.nextType });
    }

    resetLockState();

    // A swap can land on top of the stack, same as a fresh spawn.
    if (collides(state.current, state.current.x, state.current.y)) endGame();
    return true;
  }

  function togglePause() {
    if (state.gameOver) return false;
    state.paused = !state.paused;
    if (state.paused) clearMoveState(); // don't resume mid-DAS
    return true;
  }

  // Horizontal key press: one immediate step, then DAS/ARR while held.
  function pressMove(dir) {
    if (state.gameOver || state.paused) return;
    state.moveDir = dir;
    state.dasTimer = 0;
    state.arrTimer = 0;
    state.dasCharged = false;
    move(dir);
  }

  // Horizontal key release. Ignored when the other direction is held.
  function releaseMove(dir) {
    if (state.moveDir === dir) clearMoveState();
  }

  // ---------- Locking, clearing, spawning ----------
  function findFullRows() {
    const full = [];
    for (let r = 0; r < ROWS; r++) {
      if (state.board[r].every((cell) => cell !== null)) full.push(r);
    }
    return full;
  }

  function lockPiece() {
    for (const [r, c] of cellsOf(state.current.matrix)) {
      const by = state.current.y + r;
      const bx = state.current.x + c;
      if (by >= 0) state.board[by][bx] = state.current.color;
    }

    const full = findFullRows();
    if (full.length > 0) {
      // Freeze the simulation and flash the rows before removing them.
      state.clearing = { rows: full, timer: 0 };
      emit("clearing", { rows: full });
    } else {
      afterLock();
    }
  }

  // Spawn the next piece once the board has settled (post-clear, or no clear).
  function afterLock() {
    // The reserve refills here, NOT in lockPiece(): the hold preview must
    // stay dimmed for the whole flash, not 180ms before it is usable.
    state.holdUsed = false;
    emit("holdUsed", { holdUsed: false });
    spawn();
    if (collides(state.current, state.current.x, state.current.y)) endGame();
  }

  function applyClear(full) {
    for (const r of full) {
      state.board.splice(r, 1);
      state.board.unshift(Array(COLS).fill(null));
    }

    state.lines += full.length;
    state.score += SCORE_TABLE[full.length] * state.level;

    // Level up every 10 lines; gravity speeds up each level.
    state.level = Math.floor(state.lines / LINES_PER_LEVEL) + 1;
    state.dropInterval = Math.max(60, BASE_DROP_INTERVAL - (state.level - 1) * 70);
    checkHighScore();
    emit("clear", { rows: full.length, lines: state.lines, level: state.level });
  }

  function spawn() {
    state.current = createPiece(state.nextType);
    state.nextType = nextPieceType();
    emit("next", { nextType: state.nextType });
    resetLockState();
  }

  // ---------- Ghost ----------
  function ghostY() {
    let y = state.current.y;
    while (!collides(state.current, state.current.x, y + 1)) y++;
    return y;
  }

  // ---------- High score ----------
  // Live update only: the record display tracks the running score, but the
  // caller persists the value once, when the game ends.
  function checkHighScore() {
    if (state.score <= state.highScore) return;
    state.highScore = state.score;
    state.recordBeaten = true;
    emit("highscore", { highScore: state.highScore });
  }

  function endGame() {
    state.gameOver = true;
    clearMoveState();
    checkHighScore();
    emit("gameover", { score: state.score, highScore: state.highScore });
  }

  // ---------- DAS/ARR ----------
  function updateDAS(delta) {
    if (state.moveDir === 0) return;
    if (!state.dasCharged) {
      state.dasTimer += delta;
      if (state.dasTimer >= DAS_MS) {
        state.dasCharged = true;
        state.arrTimer = 0;
        move(state.moveDir);
      }
      return;
    }
    state.arrTimer += delta;
    while (state.arrTimer >= ARR_MS) {
      state.arrTimer -= ARR_MS;
      move(state.moveDir);
    }
  }

  // ---------- Simulation ----------
  function updatePlaying(delta) {
    // Reaching a new lowest row refreshes the lock budget: the cap only
    // limits wiggling in place, not legitimate descent.
    if (state.current.y > state.lowestY) {
      state.lowestY = state.current.y;
      state.lockTimer = 0;
      state.lockResets = 0;
    }

    if (grounded()) {
      // No downward progress: run the lock countdown instead of gravity.
      state.lockTimer += delta;
      if (state.lockTimer >= LOCK_DELAY_MS) {
        lockPiece();
        return;
      }
    } else {
      state.dropCounter += delta;
      if (state.dropCounter > state.dropInterval) {
        state.current.y++;
        state.dropCounter = 0;
      }
    }

    updateDAS(delta);
  }

  // Advance the simulation by deltaMs. The caller clamps the delta
  // (main.js does Math.max(0, Math.min(delta, 100))).
  function step(deltaMs) {
    const delta = deltaMs;
    if (state.gameOver || state.paused) return;

    if (state.clearing) {
      // The flash freezes the game; the rows vanish when it ends. Input
      // during the flash is ignored, so this timer cannot be reset.
      state.clearing.timer += delta;
      if (state.clearing.timer >= CLEAR_FLASH_MS) {
        const rows = state.clearing.rows;
        state.clearing = null;
        applyClear(rows);
        afterLock();
      }
      return;
    }

    updatePlaying(delta);
  }

  function reset() {
    state.board = emptyBoard();
    state.bag = [];
    state.score = 0;
    state.level = 1;
    state.lines = 0;
    state.dropInterval = BASE_DROP_INTERVAL;
    state.dropCounter = 0;
    state.gameOver = false;
    state.paused = false;

    state.holdType = null;
    state.holdUsed = false;
    state.clearing = null;
    state.recordBeaten = false;
    clearMoveState();
    state.lockTimer = 0;
    state.lockResets = 0;
    state.lowestY = 0;

    state.nextType = nextPieceType();
    spawn();
    emit("reset", {});
  }

  // ---------- Public surface ----------
  reset();

  return {
    state,
    step,
    // intents
    move,
    rotate,
    softDrop,
    hardDrop,
    holdPiece,
    togglePause,
    reset,
    pressMove,
    releaseMove,
    // helpers the renderer/UI need
    collides,
    grounded,
    ghostY,
    // events
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
