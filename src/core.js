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

// v0.4 scoring (guideline).
// T-spin values, x level. Indexed by line count (single/double/triple).
export const TSPIN_FULL_TABLE = [400, 800, 1200, 1600];
export const TSPIN_MINI_TABLE = [100, 200, 400, 400];
export const COMBO_BONUS = 50;   // x combo x level

// The kick whose success marks a rotation as "the T-spin kick".
// The 5th entry of every SRS table is the one that only succeeds when
// the piece is already nested into a cavity; it is the signal that the
// player rotated late, in place.
export const TSPIN_KICK_INDEX = 4;

// Queue depth the renderer draws (R4).
export const NEXT_QUEUE_SIZE = 5;

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
    // v0.4 scoring state
    combo: -1,          // consecutive clears minus one; -1 = no chain
    b2b: false,         // a difficult clear is waiting to chain
    lastAction: null,   // {type:"rotate",kick} | {type:"move"} | null
    lastClear: null,    // {type, lines, tspin, b2b, combo, points}
    pendingTSpin: null, // detection stashed at lock, consumed when the clear applies
    // UI-owned, never touched by the core: the renderer reads it to draw the
    // T-spin announcement and main.js stamps it from the `clear` event.
    announce: null,
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
    // A brand new piece has no history: it has neither rotated nor moved,
    // so no lock of it can be a T-spin until the player acts.
    state.lastAction = null;
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

    for (let i = 0; i < kicks.length; i++) {
      // SRS tables use y-up; the grid grows downward, so invert dy.
      const [dx, dy] = kicks[i];
      const nx = cur.x + dx;
      const ny = cur.y - dy;
      if (!collides({ matrix: rotated, x: nx, y: ny }, nx, ny)) {
        cur.matrix = rotated;
        cur.x = nx;
        cur.y = ny;
        cur.rot = to;
        // R1: a successful rotation is the FIRST half of the T-spin rule.
        // The kick index matters later: index 4 is the late kick.
        state.lastAction = { type: "rotate", kick: i };
        resetLockDelay();
        return true;
      }
    }
    // All kicks failed: rotation cancelled. lastAction is NOT touched, so
    // a failed rotation does not pretend to be a move either.
    return false;
  }

  // dir: -1 left, +1 right. No-op during the flash.
  function move(dir) {
    if (state.clearing || state.gameOver || state.paused) return false;
    const cur = state.current;
    if (collides(cur, cur.x + dir, cur.y)) return false;
    cur.x += dir;
    // Any translation cancels the rotation: a T that rotated and then slid
    // is not a T-spin, it is a T that moved.
    state.lastAction = { type: "move" };
    resetLockDelay();
    return true;
  }

  // One row down on request; the lock delay decides when it settles.
  function softDrop() {
    if (state.clearing || state.gameOver || state.paused) return false;
    if (grounded()) return false;
    state.current.y++;
    // Falling (soft drop included) does NOT break a T-spin: the guideline
    // rewards "a T that is dropped" into its slot (TetrisWiki, FOUR). Only
    // a lateral maneuver invalidates the rotation. The corner rule is
    // re-evaluated at the final position, so the spin is still checked
    // against the board the T landed in.
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
    // The drop itself never breaks the spin: the canonical TSD is "rotate
    // into the slot, then hard drop" (TetrisWiki: "A T is dropped"). Only
    // a lateral maneuver does. The corner rule is checked at the landing
    // position by resolveLock.
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

  // Is (x, y) blocking for the T-spin corner rule? Out of bounds counts
  // as blocking, INCLUDING above the ceiling: a corner that left the
  // board through the top is wall, not air.
  function blocked(x, y) {
    if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return true;
    return state.board[y][x] !== null;
  }

  /* =======================================================
   *  T-spin detection (R1).
   *
   *  IMPORTANT about coordinates: the matrix origin (x, y) is
   *  the TOP-LEFT of the NxN matrix, not its center. A 3x3
   *  piece draws cells (x+c, y+r) with r,c in 0..2, so the
   *  bounding box corners are the OUTER cells:
   *    (x, y), (x+2, y), (x, y+2), (x+2, y+2)
   *  Reading "center +/- 1" would test a box shifted one row
   *  and one column up-left, which silently misclassifies
   *  every corner (found while building the tests: the mini
   *  scenario reported 0 blocked corners).
   *
   *  Rule set used here:
   *  - Full T-spins: the classic "T pointing down" slot (nub
   *    on the bottom matrix row with the two front corners
   *    blocked) or the late kick (index 4). A kick landing the
   *    T wedged with all four corners filled is full too: that
   *    is a 1-wide, 1-deep slot a T cannot enter without one.
   *  - Mini T-spins: a 3-corner T that is not one of those.
   *
   *  Which matrix row holds the nub is read from the matrix, so
   *  the test cannot drift from the SRS tables: rot 0 nub up,
   *  rot 2 nub down, rot 1 nub right, rot 3 nub left.
   * ======================================================= */
  // Classify the piece as it stands RIGHT NOW. Returns normal when it is not a
  // T, when the last action was not a rotation, or when fewer than 3 corners
  // are blocked. Must be called before the piece is replaced or the board
  // changes, because it reads the live pivot and matrix.
  function detectTSpin() {
    if (!state.current || state.current.type !== "T") return { tspin: false, type: "normal" };
    if (state.lastAction === null || state.lastAction.type !== "rotate") {
      return { tspin: false, type: "normal" };
    }
    return isTSpin(state.current.x, state.current.y);
  }

  function isTSpin(cx, cy) {
    const corners = [
      [cx, cy],
      [cx + 2, cy],
      [cx, cy + 2],
      [cx + 2, cy + 2],
    ];
    const [tl, tr, bl, br] = corners.map(([x, y]) => blocked(x, y));
    const filled = [tl, tr, bl, br].filter(Boolean).length;
    if (filled < 3) return { tspin: false, type: "normal" };

    const full = isFullTSpin(tl, tr, bl, br);
    return { tspin: true, type: full ? "tspin_full" : "tspin_mini" };
  }

  function isFullTSpin(tl, tr, bl, br) {
    // "Nub down" = T pointing at the floor, the shape of a real T-spin
    // slot. Read from the rotated matrix itself, never from the corners.
    const nubDown = nubRow(state.current.matrix) === 2;

    // Front corners depend on where the nub points: the two cells the T
    // is wedged against. Nub left/right uses left/right column pairs.
    const rot = state.current.rot;
    let frontBlocked;
    let backBlocked;
    if (rot === 0) {          // nub up: front is the bottom row
      frontBlocked = bl && br;
      backBlocked = tl && tr;
    } else if (rot === 2) {   // nub down: front is the top row
      frontBlocked = tl && tr;
      backBlocked = bl && br;
    } else if (rot === 1) {   // nub right: front is the right column
      frontBlocked = tr && br;
      backBlocked = tl && bl;
    } else {                  // rot 3, nub left: front is the left column
      frontBlocked = tl && bl;
      backBlocked = tr && br;
    }

    const kick = state.lastAction && state.lastAction.type === "rotate"
      ? state.lastAction.kick
      : -1;

    if (kick === TSPIN_KICK_INDEX) return true;  // the late kick: full
    if (nubDown) return true;                    // the classic full slot
    // The promotion rule: both front corners blocked AND both back
    // corners filled. That is a 1-wide, 1-deep slot, which a T can only
    // enter by kicking - it is a full T-spin even without the late kick.
    return frontBlocked && backBlocked;
  }

  // Which matrix row holds the T's nub (its single-cell row).
  function nubRow(matrix) {
    for (let r = 0; r < matrix.length; r++) {
      const count = matrix[r].filter(Boolean).length;
      if (count === 1) return r;
    }
    return -1;
  }

  // Step 1 of a lock: classify the piece and stash the detection. Called
  // BEFORE the piece is stamped onto the grid, because the corner rule must
  // judge the board the piece landed into, not the board with the piece
  // already written into it. The result is consumed by finalizeLock.
  function resolveLock() {
    state.pendingTSpin = detectTSpin();
    return state.pendingTSpin;
  }

  // Step 2 of a lock: given the rows that turned out to be full, apply combo,
  // back-to-back and the score. The detection is stashed by resolveLock at
  // lock time and consumed here, when the clear is actually applied.
  function finalizeLock(full) {
    const detected = state.pendingTSpin || { tspin: false, type: "normal" };
    const lines = full.length;
    const type = detected.type;

    // Combo (R2): -1 means no chain. A clear extends it, a lock without
    // a clear breaks it. Only a chain of 2+ (combo >= 1) pays.
    // COMBO_BONUS * combo * level is the bonus in FLAT points: it must NOT
    // be multiplied by level again below (that would square the level).
    let comboBonus = 0;
    if (lines > 0) {
      state.combo += 1;
      if (state.combo >= 1) comboBonus = COMBO_BONUS * state.combo * state.level;
    } else {
      state.combo = -1;
    }

    // Back-to-back (R3): difficult clears chain, normal clears break it.
    // A lock WITHOUT lines leaves b2b untouched (guideline).
    const difficult = lines > 0 && (lines === 4 || detected.tspin);
    const b2bActive = state.b2b && difficult;

    let base = 0;
    if (lines > 0) {
      if (detected.tspin) {
        base = type === "tspin_full"
          ? TSPIN_FULL_TABLE[lines]
          : TSPIN_MINI_TABLE[lines];
      } else {
        base = SCORE_TABLE[lines];
      }
    } else if (detected.tspin) {
      // The guideline exception: a T-spin that clears nothing still pays.
      base = type === "tspin_full" ? TSPIN_FULL_TABLE[0] : TSPIN_MINI_TABLE[0];
    }

    // Each part is scaled by level exactly once: `base * level` for the clear
    // (SCORE_TABLE / TSPIN tables are per-level values), `b2bBonus` derived
    // from that same base, and `comboBonus` which already carries its level.
    const b2bBonus = b2bActive ? Math.floor(base * 0.5) : 0;
    const points = (base + b2bBonus) * state.level + comboBonus;
    state.score += points;

    if (difficult) state.b2b = true;
    else if (lines > 0) state.b2b = false; // normal clear breaks the chain

    state.lastClear = {
      type,
      lines,
      tspin: detected.tspin,
      b2b: b2bActive,
      combo: state.combo,
      points,
    };
    return state.lastClear;
  }

  // applyClear runs after the flash. The scoring pass already happened at lock
  // time, so this only removes the rows and reports the stored result.
  function applyClear(full) {
    for (const r of full) {
      state.board.splice(r, 1);
      state.board.unshift(Array(COLS).fill(null));
    }

    state.lines += full.length;

    const result = finalizeLock(full);

    // Level up every 10 lines; gravity speeds up each level. Order matters:
    // the score pass above ran at the pre-level-up level, as before.
    state.level = Math.floor(state.lines / LINES_PER_LEVEL) + 1;
    state.dropInterval = Math.max(60, BASE_DROP_INTERVAL - (state.level - 1) * 70);
    checkHighScore();
    emit("clear", {
      rows: full.length,
      lines: state.lines,
      level: state.level,
      type: result.type,
      tspin: result.tspin,
      b2b: result.b2b,
      combo: result.combo,
    });
  }

  // Lock the active piece, score it, then let the flash or the next spawn run.
  function lockPiece() {
    // Order matters, in exactly this sequence:
    //   1. resolveLock - reads the live pivot, lastAction and matrix, so it
    //      must run BEFORE afterLock/spawn replaces the piece. It also reads
    //      the corners against the board WITHOUT the piece stamped in, which
    //      is the correct moment (a corner under the piece's own body is the
    //      piece, not a wall).
    //   2. stamp the piece into the grid.
    //   3. findFullRows - the completed rows only exist after step 2.
    // The detection is stashed in state.pendingTSpin: scoring runs when the
    // clear is applied (flash end, or immediately when nothing clears), which
    // is the contract the score tests already pin down.
    resolveLock();

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
      // No clear: combo and B2B still need to move for this lock.
      const result = finalizeLock(full);
      emit("clear", { ...result, rows: 0, lines: state.lines, level: state.level });
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
        // Falling by gravity does NOT invalidate a prior rotation either:
        // "A T is dropped" still scores (TetrisWiki). The corner rule runs
        // at the final position in resolveLock, so a T that rotates and
        // then settles one row down in the slot still counts.
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

    // v0.4 scoring state. combo -1 = no chain; b2b false = no chain;
    // lastAction null = nothing has happened to the new piece yet.
    state.combo = -1;
    state.b2b = false;
    state.lastAction = null;
    state.pendingTSpin = null;
    state.announce = null;
    state.lastClear = { type: "normal", lines: 0, tspin: false, b2b: false, combo: -1, points: 0 };

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
    // R4: the upcoming pieces, active-adjacent order. It never consumes
    // the bag: it only refills when the bag cannot cover the request.
    get queue() {
      while (state.bag.length < NEXT_QUEUE_SIZE) refillBag();
      const types = [state.nextType, ...state.bag];
      return types.slice(0, NEXT_QUEUE_SIZE);
    },
    // events
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
