"use strict";

/* =========================================================
 *  Test harness for the pure core.
 *
 *  No dependencies: plain Node, ES modules. The helpers build
 *  deterministic scenarios (board from a string, forced active
 *  piece, forced bag order) so every test is reproducible.
 * ========================================================= */

import { createGame, COLS, ROWS, PIECES } from "../src/core.js";

// Deterministic rng: always returns 0. Fisher-Yates with j = 0 on every
// step is a stable shuffle, so the bag order is fixed and reproducible.
export function fixedRng() {
  return 0;
}

// rng that never swaps during the Fisher-Yates shuffle: returning a value
// close to 1 makes j === i on every step, so PIECE_TYPES comes out in
// declaration order and the first spawned piece is always "I".
export function noShuffleRng() {
  return 0.999999;
}

// Build a new game.
//
// The 7-bag refill consumes the injected rng (6 Fisher-Yates calls), so a
// queue-based rng cannot address individual pieces: the shuffle eats it.
// Instead we force the bag directly, after the game has booted, and place
// the piece we want at the FRONT of the queue (bag.shift() feeds spawn()).
//
// `order` lists the piece types in the order they should be spawned:
// order[0] becomes the active piece, order[1] becomes "next", and so on.
export function makeGame({ order } = {}) {
  const queue = (order || ["I", "O", "T", "S", "Z", "J", "L"]).slice();
  if (queue.length === 0) queue.push("I");
  const game = createGame({ rng: noShuffleRng });
  forceBag(game, queue);
  return game;
}

// Replace the bag so the next spawn() returns `order[0]`, then respawn the
// active piece from it. Keeps the rest of the bag as a plain rotation.
export function forceBag(game, order) {
  game.state.bag = order.slice();
  game.state.current = null;
  // Re-seed the bag, then pull the active piece and the preview from it.
  game.state.bag = order.slice();
  game.reset();
  // reset() refills the bag from rng and consumes two entries; restore the
  // requested order and respawn so the active piece is order[0] again.
  game.state.bag = order.slice();
  game.state.nextType = game.state.bag.shift();
  game.state.current = null;
  respawn(game);
  return game;
}

// Minimal respawn: build the active piece from nextType and refill next from
// the bag, without touching the rest of the state.
function respawn(game) {
  game.state.current = pieceFromType(game.state.nextType);
  game.state.nextType = game.state.bag.length > 0 ? game.state.bag.shift() : "I";
  game.state.lockTimer = 0;
  game.state.lockResets = 0;
  game.state.lowestY = game.state.current.y;
  game.state.dropCounter = 0;
  // Emit so any listeners stay in sync with the forced state.
  return game;
}

// Build a piece object from a type, mirroring the core's spawn shape.
function pieceFromType(type) {
  const def = PIECES[type];
  return {
    type,
    matrix: def.matrix.map((row) => row.slice()),
    color: def.color,
    x: Math.floor((COLS - def.matrix.length) / 2),
    y: type === "I" ? 0 : 1,
    rot: 0,
  };
}

// Spawn the next piece from the forced bag, bypassing the active piece.
// Used after a lock when the test wants a specific follow-up piece.
export function spawnFrom(game) {
  return respawn(game);
}

// Force the active piece: type, rotation state and position.
export function forcePiece(game, type, { x = 3, y = 0, rot = 0 } = {}) {
  const base = PIECES[type].matrix.map((row) => row.slice());
  let matrix = base;
  for (let k = 0; k < rot; k++) matrix = rotateCWM(matrix);
  game.state.current = {
    type,
    matrix,
    color: PIECES[type].color,
    x,
    y,
    rot,
  };
  game.state.lockTimer = 0;
  game.state.lockResets = 0;
  game.state.lowestY = y;
  game.state.dropCounter = 0;
  return game.state.current;
}

function rotateCWM(matrix) {
  const n = matrix.length;
  const result = Array.from({ length: n }, () => Array(n).fill(0));
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      result[c][n - 1 - r] = matrix[r][c];
  return result;
}

// Build a board grid from a string: rows top to bottom, one char per cell.
// "." or " " is empty; any other char is a settled block.
export function boardFromString(str) {
  const lines = str
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length !== ROWS) {
    throw new Error(`boardFromString: expected ${ROWS} rows, got ${lines.length}`);
  }
  return lines.map((line) => {
    if (line.length !== COLS) {
      throw new Error(`boardFromString: expected ${COLS} cols, got ${line.length}`);
    }
    return line.split("").map((ch) => (ch === "." || ch === " " ? null : "#000000"));
  });
}

// Empty 20x10 board.
export function emptyBoardString() {
  return Array.from({ length: ROWS }, () => ".".repeat(COLS)).join("\n");
}

// Apply a board string to a game, keeping the active piece untouched.
export function setBoard(game, str) {
  game.state.board = boardFromString(str);
  return game.state.board;
}

// Board string with the bottom row completely filled.
// A piece landing above it sits on row ROWS-2, so the bottom row clears.
export function bottomRowFilled() {
  const rows = Array.from({ length: ROWS - 1 }, () => ".".repeat(COLS));
  rows.push("#".repeat(COLS));
  return rows.join("\n");
}

// Board string with one gap of `gap` cells at column `gapStart` on the
// bottom row. A horizontal I piece dropped into that gap clears the row.
export function bottomRowWithGap(gapStart, gap) {
  const rows = Array.from({ length: ROWS - 1 }, () => ".".repeat(COLS));
  rows.push("#".repeat(gapStart) + ".".repeat(gap) + "#".repeat(COLS - gapStart - gap));
  return rows.join("\n");
}

// Count non-null cells in the whole grid.
export function countCells(game) {
  let n = 0;
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) if (game.state.board[r][c]) n++;
  return n;
}

export { COLS, ROWS };
