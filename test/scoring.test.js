"use strict";

/* =========================================================
 *  v0.4 scoring tests: T-spins (R1), combos (R2),
 *  back-to-back (R3) and the 5-piece queue (R4).
 *
 *  Every board here comes from a geometry that was verified by
 *  search before being frozen, and the T-spin cases go through
 *  the real rotation path (forcePiece + rotate), never a
 *  patched lastAction.
 *
 *  Run with: node --test test/
 * ========================================================= */

import test from "node:test";
import assert from "node:assert/strict";

import {
  createGame,
  COLS,
  ROWS,
  CLEAR_FLASH_MS,
  LOCK_DELAY_MS,
  TSPIN_FULL_TABLE,
  TSPIN_MINI_TABLE,
  NEXT_QUEUE_SIZE,
} from "../src/core.js";
import { makeGame, forcePiece, setBoard, noShuffleRng } from "./harness.js";

// Build a board string from a list of "r,c" keys.
function boardWith(cellList) {
  const grid = Array.from({ length: ROWS }, () => Array(COLS).fill("."));
  for (const key of cellList) {
    const [r, c] = key.split(",").map(Number);
    if (r >= 0 && r < ROWS) grid[r][c] = "#";
  }
  return grid.map((row) => row.join("")).join("\n");
}

// End the clear flash so the pending clear is applied and scored.
function finishFlash(game) {
  if (game.state.clearing) game.step(CLEAR_FLASH_MS);
  return game;
}

/* ---- Verified geometries -------------------------------------------
 * S1 full:   blocks (15,1) (15,3) (17,1). T starts nub-right at box
 *            (1,15), rotates CW to nub-down, lands on 3 blocked corners.
 * S2 mini:   blocks (16,1) (16,3) (18,3). T starts nub-up at box (1,16),
 *            rotates CW to nub-right (not nub-down) on 3 blocked corners.
 * TSD board: rows 18/19 full except the T's own cells, plus an overhang
 *            at (17,1) and (17,3). A nub-down T fills both rows.
 * -------------------------------------------------------------------- */

const S1_FULL = ["15,1", "15,3", "17,1"];
const S2_MINI = ["16,1", "16,3", "18,3"];

function tsdBoard() {
  const cells = [];
  for (let c = 0; c < COLS; c++) {
    if (!(c >= 1 && c <= 3)) cells.push(`18,${c}`); // only the bar fits row 18
    if (c !== 2) cells.push(`19,${c}`);             // only the nub fits row 19
  }
  cells.push("17,1", "17,3");                       // overhang: blocks 2 more corners
  return cells;
}

// A vertical I dropped into a 1-wide, 4-row gap: the classic tetris.
function tetrisBoard() {
  const cells = [];
  for (const r of [16, 17, 18, 19]) {
    for (let c = 0; c < COLS; c++) if (c !== 9) cells.push(`${r},${c}`);
  }
  return cells;
}

function playTetris(game) {
  setBoard(game, boardWith(tetrisBoard()));
  forcePiece(game, "I", { x: 7, y: 16, rot: 1 });
  game.hardDrop();
  finishFlash(game);
  return game.state.lastClear;
}

// Bottom row with a 4-wide gap: a flat I clears exactly one row.
function bottomGap(start) {
  const cells = [];
  for (let c = 0; c < COLS; c++) if (c < start || c >= start + 4) cells.push(`${ROWS - 1},${c}`);
  return boardWith(cells);
}

function playSingle(game, start) {
  setBoard(game, bottomGap(start));
  forcePiece(game, "I", { x: start, y: 18, rot: 0 });
  game.hardDrop();
  finishFlash(game);
  return game.state.lastClear;
}

/* =========================================================
 *  R1 - T-spin detection
 * ========================================================= */

test("tspin: a T rotated into a 3-corner slot is a full T-spin", () => {
  const game = makeGame({ order: ["T", "I", "O"] });
  setBoard(game, boardWith(S1_FULL));
  forcePiece(game, "T", { x: 1, y: 15, rot: 1 });
  assert.equal(game.collides(game.state.current, 1, 15), false, "the start must be legal");

  assert.equal(game.rotate(1), true, "the rotation succeeds");
  assert.equal(game.state.lastAction.type, "rotate");
  assert.equal(game.state.current.rot, 2, "it lands nub-down");
  assert.equal(game.grounded(), true, "the slot holds it in place");

  game.step(LOCK_DELAY_MS);
  const last = game.state.lastClear;
  assert.equal(last.tspin, true, "3 of 4 corners are blocked");
  assert.equal(last.type, "tspin_full", "nub-down with the front corners blocked");
  assert.equal(last.points, TSPIN_FULL_TABLE[0], "a T-spin with no lines pays 400");
});

test("tspin: a T with the nub sideways on 3 corners is a mini", () => {
  const game = makeGame({ order: ["T", "I", "O"] });
  setBoard(game, boardWith(S2_MINI));
  forcePiece(game, "T", { x: 1, y: 16, rot: 0 });
  assert.equal(game.collides(game.state.current, 1, 16), false, "the start must be legal");

  assert.equal(game.rotate(1), true, "the rotation succeeds");
  assert.equal(game.state.current.rot, 1, "it lands nub-right");

  game.step(LOCK_DELAY_MS);
  const last = game.state.lastClear;
  assert.equal(last.tspin, true, "3 corners are blocked");
  assert.equal(last.type, "tspin_mini", "not nub-down and not the late kick");
  assert.equal(last.points, TSPIN_MINI_TABLE[0], "a mini with no lines pays 100");
});

// The intuition-breaker, proved by contrast: two Ts reach the SAME final
// position and SAME 3 blocked corners, but only the one whose last maneuver
// was a rotation scores. Falling is not a maneuver (guideline: "A T is
// dropped" still counts) - but never rotating at all cannot be a twist.
test("tspin: gravity preserves a prior rotation, never-rotating does not", () => {
  const viaRotate = makeGame({ order: ["T", "I", "O"] });
  setBoard(viaRotate, boardWith(S1_FULL));
  forcePiece(viaRotate, "T", { x: 1, y: 15, rot: 1 });
  viaRotate.rotate(1);
  viaRotate.step(LOCK_DELAY_MS);
  assert.equal(viaRotate.state.lastClear.tspin, true, "rotating is a T-spin");
  assert.equal(viaRotate.state.current.type, "I", "the next piece already spawned over");

  // A T rotated in open air, then GRAVITY walks it down. Falling must NOT
  // wipe the rotation: the guideline rewards "a T that is dropped" into its
  // slot, and the corner rule is re-checked at the landing position.
  const viaGravity = makeGame({ order: ["T", "I", "O"] });
  setBoard(viaGravity, boardWith(S1_FULL));
  forcePiece(viaGravity, "T", { x: 3, y: 10, rot: 1 }); // open air, room below
  assert.equal(viaGravity.grounded(), false, "the piece must start airborne");
  viaGravity.rotate(1);
  assert.equal(viaGravity.state.lastAction.type, "rotate", "the rotation happened first");

  viaGravity.step(801); // gravity pulls it down one row
  assert.equal(viaGravity.state.current.y, 11, "gravity moved it down");
  assert.equal(viaGravity.state.lastAction.type, "rotate",
    "a fall by gravity is not a lateral maneuver; it keeps the twist alive");

  // Control: a T that arrives at the slot WITH NO rotation history at all
  // (fresh spawn, dropped in place by gravity) is not a T-spin.
  const neverRotated = makeGame({ order: ["T", "I", "O"] });
  setBoard(neverRotated, boardWith(S1_FULL));
  forcePiece(neverRotated, "T", { x: 1, y: 14, rot: 2 }); // already nub-down
  assert.equal(neverRotated.state.lastAction, null, "fresh piece, no history");
  neverRotated.step(801); // gravity drops it into the same box
  assert.equal(neverRotated.state.current.y, 15, "it lands in the same box");
  neverRotated.step(LOCK_DELAY_MS);
  assert.equal(neverRotated.state.lastClear.tspin, false,
    "no rotation ever happened: not a T-spin");
  assert.equal(neverRotated.state.lastClear.type, "normal");
});

// The canonical TSD: rotate into the slot, then hard drop. The drop is the
// LOCK trigger, not a maneuver - the spin is evaluated at the final position.
test("tspin: a hard drop after the rotation IS a T-spin", () => {
  const game = makeGame({ order: ["T", "I", "O"] });
  setBoard(game, boardWith(S1_FULL));
  forcePiece(game, "T", { x: 1, y: 15, rot: 1 });
  assert.equal(game.rotate(1), true, "the rotation lands in the slot");
  assert.equal(game.state.lastAction.type, "rotate");

  let atLock = null;
  game.on((type) => {
    if (type === "clear" && atLock === null) atLock = { ...game.state.lastAction };
  });

  game.hardDrop();
  assert.equal(atLock.type, "rotate", "the drop leaves the rotation as the last maneuver");
  assert.equal(game.state.lastClear.tspin, true, "rotate + hard drop is the classic TSD");
  assert.equal(game.state.lastClear.type, "tspin_full");
});

test("tspin: a T that rotates and then slides is NOT a T-spin", () => {
  const game = makeGame({ order: ["T", "I", "O"] });
  setBoard(game, boardWith(S1_FULL));
  forcePiece(game, "T", { x: 1, y: 15, rot: 1 });
  assert.equal(game.rotate(1), true, "the rotation lands first");
  assert.equal(game.state.lastAction.type, "rotate");

  // The first kick that lands is to the RIGHT, so step that way.
  const moved = game.move(1);
  assert.equal(moved, true, "there must be room to the right");
  assert.equal(game.state.lastAction.type, "move");

  game.step(LOCK_DELAY_MS);
  assert.equal(game.state.lastClear.tspin, false, "a move kills the T-spin");
});

test("tspin: soft drop and hard drop preserve the rotation", () => {
  const soft = makeGame({ order: ["T", "I", "O"] });
  setBoard(soft, boardWith(S1_FULL));
  forcePiece(soft, "T", { x: 1, y: 12, rot: 1 });
  soft.rotate(1);
  assert.equal(soft.state.lastAction.type, "rotate");
  assert.equal(soft.softDrop(), true, "there is room below in open air");
  assert.equal(soft.state.lastAction.type, "rotate",
    "a soft drop is falling, not a lateral maneuver; the twist survives");

  const hard = makeGame({ order: ["T", "I", "O"] });
  setBoard(hard, boardWith(S1_FULL));
  forcePiece(hard, "T", { x: 1, y: 15, rot: 1 });
  hard.rotate(1);
  hard.hardDrop();
  assert.equal(hard.state.lastClear.tspin, true,
    "rotate + hard drop is a valid T-spin (the canonical TSD)");
});

test("tspin: a T rotated in open space is not a T-spin", () => {
  const game = makeGame({ order: ["T", "I", "O"] });
  forcePiece(game, "T", { x: 4, y: 10, rot: 0 });
  game.rotate(1);
  game.step(LOCK_DELAY_MS);
  assert.equal(game.state.lastClear.tspin, false, "no corners are blocked");
  assert.equal(game.state.lastClear.type, "normal");
});

test("tspin: a failed rotation leaves lastAction untouched", () => {
  const game = makeGame({ order: ["T", "I", "O"] });
  forcePiece(game, "T", { x: 4, y: 5, rot: 0 });
  // Seal a 5x5 pocket around the pivot so no kick can land.
  for (let r = 3; r <= 8; r++) for (let c = 3; c <= 6; c++) game.state.board[r][c] = "#000000";

  const ok = game.rotate(1);
  assert.equal(ok, false, "no kick fits");
  assert.equal(game.state.lastAction, null, "a refused rotation is not an action");
});

// A fresh piece must not inherit the previous piece's rotation. Here a T locks
// as a real T-spin, then the NEXT T sits in the same shape without rotating:
// that second lock must be normal, which only holds if spawn clears lastAction.
test("tspin: a spawned piece never inherits the previous rotation", () => {
  const game = makeGame({ order: ["T", "T", "O"] });
  setBoard(game, boardWith(S1_FULL));
  forcePiece(game, "T", { x: 1, y: 15, rot: 1 });
  game.rotate(1);
  game.step(LOCK_DELAY_MS);
  assert.equal(game.state.lastClear.tspin, true, "the first T is a real T-spin");
  assert.equal(game.state.current.type, "T", "the next T has spawned");
  assert.equal(game.state.lastAction, null, "and it carries no action history");

  // Place that next T into the same shape with no rotation at all.
  forcePiece(game, "T", { x: 1, y: 15, rot: 2 });
  game.state.lastAction = null;
  game.step(LOCK_DELAY_MS);
  assert.equal(game.state.lastClear.tspin, false, "no rotation, no T-spin");
});

test("tspin: a non-T piece never scores as a T-spin", () => {
  const game = makeGame({ order: ["S", "I", "O"] });
  setBoard(game, boardWith(S2_MINI));
  forcePiece(game, "S", { x: 1, y: 16, rot: 0 });
  game.rotate(1);
  game.step(LOCK_DELAY_MS);
  assert.equal(game.state.lastClear.tspin, false, "only a T can be a T-spin");
});

test("tspin: the tables are the guideline values", () => {
  assert.deepEqual(TSPIN_FULL_TABLE, [400, 800, 1200, 1600]);
  assert.deepEqual(TSPIN_MINI_TABLE, [100, 200, 400, 400]);
});

/* =========================================================
 *  T-spin scoring
 * ========================================================= */

test("scoring: a T-spin double pays 1200 x level", () => {
  const game = makeGame({ order: ["T", "I", "O"] });
  setBoard(game, boardWith(tsdBoard()));
  forcePiece(game, "T", { x: 1, y: 17, rot: 2 });
  game.state.lastAction = { type: "rotate", kick: 0 };
  game.hardDrop();
  finishFlash(game);

  const last = game.state.lastClear;
  assert.equal(last.tspin, true, `classified as ${last.type}`);
  assert.equal(last.lines, 2, "two rows must clear");
  assert.equal(last.points, TSPIN_FULL_TABLE[2], "1200 at level 1");
});

test("scoring: T-spin values scale with level", () => {
  const game = makeGame({ order: ["T", "I", "O"] });
  setBoard(game, boardWith(tsdBoard()));
  game.state.level = 3;
  forcePiece(game, "T", { x: 1, y: 17, rot: 2 });
  game.state.lastAction = { type: "rotate", kick: 0 };
  game.hardDrop();
  finishFlash(game);
  assert.equal(game.state.lastClear.points, TSPIN_FULL_TABLE[2] * 3, "x3 at level 3");
});

test("scoring: a T-spin without lines still pays", () => {
  const game = makeGame({ order: ["T", "I", "O"] });
  setBoard(game, boardWith(S1_FULL));
  forcePiece(game, "T", { x: 1, y: 15, rot: 1 });
  game.rotate(1);
  game.step(LOCK_DELAY_MS);
  const last = game.state.lastClear;
  assert.equal(last.lines, 0, "nothing cleared");
  assert.equal(last.tspin, true);
  assert.equal(last.points, TSPIN_FULL_TABLE[0], "the no-line exception pays 400");
});

test("scoring: the normal table is unchanged by the v0.4 pass", () => {
  const game = makeGame({ order: ["I", "T", "O"] });
  const last = playSingle(game, 3);
  assert.equal(last.lines, 1);
  assert.equal(last.tspin, false, "a plain I clear is not a T-spin");
  assert.equal(game.state.score, 100, "a single at level 1 is still 100");
});

/* =========================================================
 *  R2 - Combos
 * ========================================================= */

test("combo: the first clear starts the chain at 0", () => {
  const game = makeGame({ order: ["I", "T", "O"] });
  const last = playSingle(game, 3);
  assert.equal(last.combo, 0, "one clear means combo 0");
  assert.equal(game.state.combo, 0);
});

test("combo: consecutive clears accumulate and only combo >= 1 pays", () => {
  const game = makeGame({ order: ["I", "I", "O"] });
  playSingle(game, 3);
  const afterFirst = game.state.score;
  assert.equal(game.state.combo, 0, "first clear");

  playSingle(game, 2);
  assert.equal(game.state.combo, 1, "second clear in a row");
  assert.equal(game.state.score - afterFirst, 150, "100 base + 50 combo at level 1");
});

test("combo: the bonus scales with level and combo count", () => {
  const game = makeGame({ order: ["I", "I", "I"] });
  playSingle(game, 4);
  playSingle(game, 3);
  assert.equal(game.state.combo, 1, "two clears in a row");

  game.state.level = 2;
  const last = playSingle(game, 2);
  assert.equal(game.state.combo, 2, "third clear in a row");
  // Single at level 2 is 200, combo bonus is 50 * 2 * 2 = 200.
  assert.equal(last.points, 400, "level 2 single plus level 2 combo 2");
});

test("combo: a lock without a clear resets the chain to -1", () => {
  const game = makeGame({ order: ["I", "O", "T"] });
  playSingle(game, 3);
  assert.equal(game.state.combo, 0, "the chain is alive");

  // A dry lock: the O must be GROUNDED or the lock timer never runs.
  setBoard(game, boardWith(["19,9"]));
  forcePiece(game, "O", { x: 0, y: 18, rot: 0 });
  assert.equal(game.grounded(), true, "the piece must rest on the floor");
  game.step(LOCK_DELAY_MS);
  assert.equal(game.state.lastClear.lines, 0, "the lock cleared nothing");
  assert.equal(game.state.combo, -1, "a dry lock breaks the chain");
});

/* =========================================================
 *  R3 - Back to back
 * ========================================================= */

test("b2b: a tetris arms the chain and the second one chains", () => {
  const game = makeGame({ order: ["I", "I", "O"] });
  const first = playTetris(game);
  assert.equal(first.lines, 4, "a tetris clears four rows");
  assert.equal(first.b2b, false, "the first tetris is not chained");
  assert.equal(first.points, 800, "base tetris at level 1");
  assert.equal(game.state.b2b, true, "but it arms the chain");

  const second = playTetris(game);
  assert.equal(second.lines, 4, "another tetris");
  assert.equal(second.b2b, true, "the second tetris chains");
  assert.equal(second.points, 1250, "800 base + 400 b2b + 50 combo");
});

test("b2b: a normal clear breaks the chain", () => {
  const game = makeGame({ order: ["I", "I", "I"] });
  playTetris(game);
  assert.equal(game.state.b2b, true, "tetris arms the chain");

  playSingle(game, 3);
  assert.equal(game.state.lastClear.lines, 1, "one row clears");
  assert.equal(game.state.lastClear.b2b, false, "a single is not chained");
  assert.equal(game.state.b2b, false, "and it breaks the chain");
});

// The case that breaks intuition: a dry lock in the middle must NOT break b2b.
test("b2b: a lock without a clear leaves the chain armed", () => {
  const game = makeGame({ order: ["I", "O", "I"] });
  playTetris(game);
  assert.equal(game.state.b2b, true, "tetris arms the chain");

  setBoard(game, boardWith(["19,9"]));
  forcePiece(game, "O", { x: 0, y: 18, rot: 0 });
  assert.equal(game.grounded(), true, "the piece must rest on the floor");
  game.step(LOCK_DELAY_MS);
  assert.equal(game.state.lastClear.lines, 0, "the lock cleared nothing");
  assert.equal(game.state.b2b, true, "a dry lock does not break the chain");

  // The dry lock broke the combo, so the chained tetris pays base + b2b only.
  const chained = playTetris(game);
  assert.equal(chained.b2b, true, "the chain survived the dry lock");
  assert.equal(chained.points, 1200, "800 base + 400 b2b, no combo after a dry lock");
});

test("b2b: a T-spin with lines is a difficult clear and arms the chain", () => {
  const game = makeGame({ order: ["T", "T", "O"] });
  setBoard(game, boardWith(tsdBoard()));
  forcePiece(game, "T", { x: 1, y: 17, rot: 2 });
  game.state.lastAction = { type: "rotate", kick: 0 };
  game.hardDrop();
  finishFlash(game);
  assert.equal(game.state.lastClear.tspin, true, "a T-spin double is difficult");
  assert.equal(game.state.b2b, true, "so it arms back-to-back");
});

/* =========================================================
 *  R4 - Next queue
 * ========================================================= */

test("queue: five entries, active-adjacent, from the 7-bag", () => {
  const order = ["T", "I", "O", "S", "Z", "J", "L"];
  const game = makeGame({ order });
  const q = game.queue;
  assert.equal(q.length, NEXT_QUEUE_SIZE, "the queue is 5 deep");
  assert.equal(q[0], game.state.nextType, "the head equals nextType");
  assert.deepEqual(q, order.slice(1, 6), "the queue follows the forced bag order");
});

test("queue: reading it does not consume the bag", () => {
  const game = makeGame({ order: ["T", "I", "O", "S", "Z", "J", "L"] });
  const before = game.queue.slice();
  const bagLen = game.state.bag.length;
  assert.deepEqual(game.queue, before, "two reads agree");
  assert.equal(game.state.bag.length, bagLen, "reading never shifts the bag");
});

test("queue: it refills instead of running short at the bag boundary", () => {
  const game = createGame({ rng: noShuffleRng });
  game.state.bag = ["T"];
  game.state.nextType = "I";
  const q = game.queue;
  assert.equal(q.length, NEXT_QUEUE_SIZE, "the queue is never short");
  assert.equal(q[0], "I");
  assert.equal(q[1], "T");
  assert.ok(game.state.bag.length >= NEXT_QUEUE_SIZE, "refilled to cover the window");
});

test("queue: a 5-piece window never repeats a type", () => {
  const game = createGame({ rng: noShuffleRng });
  for (let round = 0; round < 5; round++) {
    const q = game.queue;
    assert.equal(new Set(q).size, q.length, `window ${round} has a duplicate`);
    game.state.nextType = game.state.bag.shift(); // consume one like spawn()
  }
});

// A hold spends the active piece: the window shifts by one, and the held
// piece becomes the head. The window must stay 5 deep and keep its order.
test("queue: a hold shifts the window by exactly one entry", () => {
  const game = makeGame({ order: ["T", "I", "O", "S", "Z", "J", "L"] });
  assert.deepEqual(game.queue, ["I", "O", "S", "Z", "J"], "before the hold");

  game.holdPiece();

  const after = game.queue;
  assert.equal(after.length, NEXT_QUEUE_SIZE, "the window is still 5 deep");
  assert.equal(after[0], "O", "the incoming piece is the new head");
  assert.deepEqual(after, ["O", "S", "Z", "J", "L"], "the rest keeps its order");
  assert.equal(game.state.holdType, "T", "the parked piece is the old active one");
});

test("queue: reset rebuilds a full window", () => {
  const game = makeGame({ order: ["T", "I", "O", "S", "Z", "J", "L"] });
  game.reset();
  const q = game.queue;
  assert.equal(q.length, NEXT_QUEUE_SIZE, "still 5 deep after a reset");
  assert.equal(q[0], game.state.nextType, "the head still matches nextType");
});
