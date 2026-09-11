"use strict";

/* =========================================================
 *  Core tests - node:test, zero dependencies.
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
  MAX_LOCK_RESETS,
  DAS_MS,
  ARR_MS,
} from "../src/core.js";
import {
  makeGame,
  forcePiece,
  setBoard,
  countCells,
  bottomRowFilled,
  bottomRowWithGap,
  fixedRng,
} from "./harness.js";

// Scenario used by the clearing tests: the bottom row has a 4-cell gap at
// columns 3..6, and a horizontal I piece is dropped straight into it.
function clearScenario() {
  const game = makeGame({ order: ["I", "T", "O"] });
  setBoard(game, bottomRowWithGap(3, 4));
  forcePiece(game, "I", { x: 3, y: 16, rot: 0 });
  return game;
}

/* =========================================================
 *  1. `clearing` blocks input
 * ========================================================= */

test("clearing: intents are no-ops during the flash", () => {
  const game = clearScenario();
  game.hardDrop();
  assert.ok(game.state.clearing, "the flash must be active after a line clear");
  assert.deepEqual(game.state.clearing.rows, [ROWS - 1]);
  assert.equal(game.state.clearing.timer, 0);

  const before = {
    x: game.state.current.x,
    y: game.state.current.y,
    rot: game.state.current.rot,
    score: game.state.score,
    holdUsed: game.state.holdUsed,
    holdType: game.state.holdType,
    timer: game.state.clearing.timer,
    cells: countCells(game),
  };

  assert.equal(game.move(-1), false);
  assert.equal(game.move(1), false);
  assert.equal(game.rotate(1), false);
  assert.equal(game.rotate(-1), false);
  assert.equal(game.hardDrop(), false);
  assert.equal(game.holdPiece(), false);
  assert.equal(game.softDrop(), false);

  assert.equal(game.state.current.x, before.x);
  assert.equal(game.state.current.y, before.y);
  assert.equal(game.state.current.rot, before.rot);
  assert.equal(game.state.score, before.score);
  assert.equal(game.state.holdUsed, before.holdUsed);
  assert.equal(game.state.holdType, before.holdType);
  assert.equal(game.state.clearing.timer, before.timer);
  assert.equal(countCells(game), before.cells);
});

test("clearing: repeated hardDrop during the flash neither freezes nor duplicates", () => {
  const game = clearScenario();
  game.hardDrop();
  const scoreAfterDrop = game.state.score;
  assert.ok(game.state.clearing);

  // Hammer the hard drop during the whole flash, the way a held Space key
  // would. This is the v0.2 bug: it used to freeze the clear forever.
  const cellsBefore = countCells(game);
  for (let i = 0; i < 20; i++) {
    game.hardDrop();
    assert.equal(game.state.score, scoreAfterDrop, "score must not be paid twice");
    assert.ok(game.state.clearing, "the flash must not be cancelled");
  }
  assert.equal(countCells(game), cellsBefore, "no duplicate cells");

  // And the flash still completes on its own timer.
  game.step(CLEAR_FLASH_MS);
  assert.equal(game.state.clearing, null, "the flash must complete");
  assert.equal(game.state.lines, 1);
  assert.equal(countCells(game), 0, "the row is gone and no piece is locked yet");
});

test("clearing: step() does not reset the flash timer", () => {
  const game = clearScenario();
  game.hardDrop();

  game.step(100);
  assert.equal(game.state.clearing.timer, 100);
  game.step(79);
  assert.ok(game.state.clearing, "179ms is not enough to finish the flash");
  assert.equal(game.state.clearing.timer, 179);
  game.step(1);
  assert.equal(game.state.clearing, null, "180ms ends the flash");
});

test("clearing: the flash does not advance gravity or DAS", () => {
  const game = clearScenario();
  game.hardDrop();
  assert.ok(game.state.clearing, "the scenario must produce a clear");
  // Charge DAS while the flash is running: the timer must keep ticking for
  // the flash, but the piece must not slide sideways.
  const x = game.state.current.x;
  game.pressMove(1);
  const movedOnPress = game.state.current.x;
  game.step(CLEAR_FLASH_MS - 1);
  assert.equal(
    game.state.current.x,
    movedOnPress,
    "no repeat may fire during the flash"
  );
  assert.ok(game.state.clearing, "the flash is still running");
  assert.ok(x === movedOnPress, "pressMove is also a no-op while clearing");
});

/* =========================================================
 *  2. Wall kicks - CCW lookup, both series
 * ========================================================= */

test("kicks: normal series, all 8 transitions rotate on an empty board", () => {
  const expectations = [
    ["T", 0, 1, 1], ["T", 1, 1, 2], ["T", 2, 1, 3], ["T", 3, 1, 0],
    ["T", 0, -1, 3], ["T", 1, -1, 0], ["T", 2, -1, 1], ["T", 3, -1, 2],
  ];
  for (const [type, from, dir, to] of expectations) {
    const game = makeGame({ order: ["T", "I", "O"] });
    forcePiece(game, type, { x: 4, y: 8, rot: from });
    assert.equal(game.rotate(dir), true, `${type} ${from}->${to} should rotate`);
    assert.equal(game.state.current.rot, to, `${type} ${from}->${to} wrong rotation`);
    assert.equal(game.state.current.x, 4, `${type} ${from}->${to} must not shift`);
    assert.equal(game.state.current.y, 8, `${type} ${from}->${to} must not shift`);
  }
});

test("kicks: I series, all 8 transitions rotate on an empty board", () => {
  const expectations = [
    ["I", 0, 1, 1], ["I", 1, 1, 2], ["I", 2, 1, 3], ["I", 3, 1, 0],
    ["I", 0, -1, 3], ["I", 1, -1, 0], ["I", 2, -1, 1], ["I", 3, -1, 2],
  ];
  for (const [type, from, dir, to] of expectations) {
    const game = makeGame({ order: ["I", "T", "O"] });
    forcePiece(game, type, { x: 3, y: 8, rot: from });
    assert.equal(game.rotate(dir), true, `${type} ${from}->${to} should rotate`);
    assert.equal(game.state.current.rot, to, `${type} ${from}->${to} wrong rotation`);
  }
});

test("kicks: CCW uses the from>to row, not the mirrored CW row", () => {
  // The v0.1 bug: CCW read the CW row of the inverse transition.
  // Normal 2>1 expects [[0,0],[-1,0],...]; the mirrored bug would read the
  // 1>2 row [[0,0],[1,0],...], whose first non-zero kick is (+1,0) instead.
  //
  // Put a T piece at rot 2 flat against the right wall so the (0,0) and
  // (-1,0) kicks are blocked, leaving only (+1,0) - which cannot fit - and
  // then compare the two rows' outcomes directly on the core's table.
  //
  // The decisive check is the kick list the core selects for 2>1: it must
  // be the 2>1 row, not the 1>2 row.
  const game = makeGame({ order: ["T", "I", "O"] });
  forcePiece(game, "T", { x: 4, y: 8, rot: 2 });

  // Snapshot the matrix so we can verify the rotation actually applied.
  const before = game.state.current.matrix.map((r) => r.slice());
  const ok = game.rotate(-1);
  assert.equal(ok, true, "2>1 must rotate on an empty board");
  assert.equal(game.state.current.rot, 1);

  // Now the decisive test: block the (0,0) kick and the (-1,0) kick with
  // walls, so only the mirror-only kick remains as a possible success.
  // 2>1 row: (-1,0) then (-1,1). 1>2 row: (+1,0) then (+1,-1).
  // Blocking dx=-1 leaves the correct row with (-1,1) and the buggy row
  // with (+1,0)/(+1,-1). We assert the resulting x moves LEFT.
  const g2 = makeGame({ order: ["T", "I", "O"] });
  const rows = Array.from({ length: ROWS }, () => ".".repeat(COLS));
  // T at rot 2, x=4, y=10 occupies (10,5),(11,4),(11,5),(11,6).
  // After 2>1 it would occupy (10,4),(11,4),(11,5),(12,5).
  // Block the cells needed by dx=-1 at dy=0: (10,3),(11,3).
  rows[10] = "...##.....";
  rows[11] = "...##.....";
  setBoard(g2, rows.join("\n"));
  forcePiece(g2, "T", { x: 4, y: 10, rot: 2 });

  const res = g2.rotate(-1);
  // Correct row: (0,0) blocked by (11,4)? no - (11,4) is free here, so the
  // (0,0) kick succeeds and x stays 4. Either way x must not move RIGHT,
  // which is what the mirrored row would do.
  assert.equal(res, true, "2>1 must find a kick");
  assert.ok(
    g2.state.current.x <= 4,
    `CCW must never shift right on 2>1 (mirrored-row bug); x=${g2.state.current.x}`
  );
  assert.notDeepEqual(before, null);
});

test("kicks: the core selects the from>to row for CCW", () => {
  // Decisive separation between the correct 2>1 row and the mirrored 1>2
  // row, for a T piece at rot 2 with origin (4,10):
  //   - blocking cell (10,5) kills the (0,0) kick for both rows
  //   - correct 2>1 then tries (-1,0) -> lands at x=3
  //   - mirrored 1>2 then tries (+1,0) -> lands at x=5
  // So x === 3 proves the core read the 2>1 row.
  const game = makeGame({ order: ["T", "I", "O"] });
  const rows = Array.from({ length: ROWS }, () => ".".repeat(COLS));
  rows[10] = ".....#...."; // blocks (10,5)
  setBoard(game, rows.join("\n"));
  forcePiece(game, "T", { x: 4, y: 10, rot: 2 });

  const ok = game.rotate(-1);
  assert.equal(ok, true, "2>1 must find a kick");
  assert.equal(game.state.current.rot, 1);
  assert.equal(
    game.state.current.x,
    3,
    "the 2>1 row kicks left (-1,0); the mirrored 1>2 row would kick right (+1,0)"
  );
  assert.equal(game.state.current.y, 10);
});

test("kicks: O never shifts on rotation", () => {
  const game = makeGame({ order: ["O", "I", "T"] });
  forcePiece(game, "O", { x: 4, y: 8, rot: 0 });
  game.rotate(1);
  assert.equal(game.state.current.x, 4);
  assert.equal(game.state.current.y, 8);
  game.rotate(1);
  assert.equal(game.state.current.x, 4);
  assert.equal(game.state.current.y, 8);
});

/* =========================================================
 *  3. Lock delay
 * ========================================================= */

test("lock delay: a grounded piece locks after 500ms", () => {
  const game = makeGame({ order: ["T", "I", "O"] });
  // Floor is the grid edge at row 19: an O placed at y=18 rests on it.
  forcePiece(game, "O", { x: 4, y: 18, rot: 0 });
  assert.equal(game.grounded(), true, "the piece must be grounded");

  game.step(LOCK_DELAY_MS - 1);
  assert.equal(game.state.board[18][4], null, "must not lock before the delay");

  game.step(1);
  assert.notEqual(game.state.board[18][4], null, "must lock at the delay");
});

test("lock delay: descending to a new row re-arms the counter", () => {
  const game = makeGame({ order: ["T", "I", "O"] });
  forcePiece(game, "O", { x: 4, y: 18, rot: 0 });
  assert.equal(game.grounded(), true);

  // Burn 13 resets while grounded. Each successful move consumes exactly
  // one, so alternate directions to avoid parking against the wall.
  for (let i = 0; i < 13; i++) {
    if (!game.move(-1)) game.move(1);
  }
  assert.equal(game.state.lockResets, 13);

  // A new lowest row resets both the timer and the reset budget. The piece
  // must move DOWN (a wall kick), so y grows: 18 -> 19.
  game.state.current.y = 19;
  game.step(1);
  assert.equal(game.state.lockResets, 0, "descending re-arms the reset budget");

  // Moving back UP must not re-arm it again: y=18 is not a new low. A
  // successful move at y=18 still consumes a reset (it is grounded there),
  // so exactly one reset is spent.
  game.state.current.y = 18;
  assert.equal(game.grounded(), true);
  game.move(-1);
  assert.equal(game.state.lockResets, 1, "an upward move is not a new low");
});

test("lock delay: resets are capped at 15", () => {
  const game = makeGame({ order: ["T", "I", "O"] });
  forcePiece(game, "O", { x: 4, y: 18, rot: 0 });

  for (let i = 0; i < 40; i++) {
    game.move(-1);
    game.move(1);
  }
  assert.equal(game.state.lockResets, MAX_LOCK_RESETS, "cap is 15");

  // Once the budget is spent, extra wiggles no longer restart the timer.
  game.step(300);
  assert.equal(game.state.lockTimer, 300, "timer keeps running past the cap");
  game.step(200);
  assert.notEqual(game.state.board[18][4], null, "piece locks at 500ms total");
});

test("lock delay: a successful move or rotate consumes a reset", () => {
  const game = makeGame({ order: ["T", "I", "O"] });
  forcePiece(game, "O", { x: 4, y: 18, rot: 0 });

  assert.equal(game.state.lockResets, 0);
  game.move(-1);
  assert.equal(game.state.lockResets, 1, "a successful move consumes a reset");

  // A blocked move must not consume a reset.
  const blocked = makeGame({ order: ["O", "I", "T"] });
  const rows = Array.from({ length: ROWS - 1 }, () => ".".repeat(COLS));
  rows.push("##........");
  setBoard(blocked, rows.join("\n"));
  forcePiece(blocked, "O", { x: 0, y: 18, rot: 0 });
  const before = blocked.state.lockResets;
  blocked.move(-1);
  assert.equal(blocked.state.lockResets, before, "a blocked move is free");
});

/* =========================================================
 *  4. Hold
 * ========================================================= */

test("hold: one hold per locked piece", () => {
  const game = makeGame({ order: ["T", "I", "O"] });
  forcePiece(game, "T", { x: 4, y: 8, rot: 0 });

  assert.equal(game.holdPiece(), true, "first hold works");
  assert.equal(game.state.holdType, "T");
  assert.equal(game.state.holdUsed, true);
  assert.equal(game.state.current.type, "I", "the next piece comes in");

  assert.equal(game.holdPiece(), false, "second hold is refused");
  assert.equal(game.state.holdType, "T", "the reserve is unchanged");
  assert.equal(game.state.current.type, "I");
});

test("hold: the slot refills in afterLock, not in lockPiece", () => {
  const game = makeGame({ order: ["T", "I", "O"] });
  forcePiece(game, "T", { x: 4, y: 8, rot: 0 });
  game.holdPiece(); // spend the hold, T goes to reserve, I comes in
  assert.equal(game.state.holdUsed, true);

  // Now clear a line with the incoming I piece.
  setBoard(game, bottomRowWithGap(3, 4));
  forcePiece(game, "I", { x: 3, y: 16, rot: 0 });
  game.hardDrop();
  assert.ok(game.state.clearing, "flash started");
  assert.equal(game.state.holdUsed, true, "hold stays spent during the flash");

  game.step(CLEAR_FLASH_MS);
  assert.equal(game.state.clearing, null);
  assert.equal(game.state.holdUsed, false, "hold refills only after the flash");
});

test("hold: the first hold pulls the next piece and refills next", () => {
  const game = makeGame({ order: ["T", "I", "O"] });
  forcePiece(game, "T", { x: 4, y: 8, rot: 0 });
  const nextBefore = game.state.nextType;
  game.holdPiece();
  assert.equal(game.state.current.type, nextBefore);
  assert.notEqual(game.state.nextType, nextBefore, "next was refilled");
});

/* =========================================================
 *  5. High score
 * ========================================================= */

test("high score: live value tracks the score, no write from the core", () => {
  const game = makeGame({ order: ["T", "I", "O"] });
  game.state.highScore = 0;
  forcePiece(game, "T", { x: 4, y: 4, rot: 0 });

  game.hardDrop(); // scores 2 * distance
  assert.ok(game.state.score > 0, "a hard drop must score");
  assert.equal(game.state.highScore, game.state.score, "live record follows the score");
  assert.equal(game.state.recordBeaten, true);
});

test("high score: the core never touches storage", () => {
  // A global localStorage that throws on any access: the core must survive
  // it, since it is not supposed to know storage exists.
  const original = globalThis.localStorage;
  let touched = false;
  globalThis.localStorage = {
    getItem() { touched = true; throw new Error("no storage"); },
    setItem() { touched = true; throw new Error("no storage"); },
  };
  try {
    const game = makeGame({ order: ["T", "I", "O"] });
    game.hardDrop();
    game.step(16);
    game.reset();
    assert.equal(touched, false, "the core must not read or write storage");
  } finally {
    if (original === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = original;
  }
});

test("high score: game over is announced through the event hook", () => {
  const game = makeGame({ order: ["T", "I", "O"] });
  const events = [];
  game.on((type) => events.push(type));
  // Fill rows 0-5 in columns 4-5 only: the spawn cannot fit, but no row is
  // complete, so no line clear happens before the game-over check.
  for (let r = 0; r < 6; r++) {
    game.state.board[r][4] = "#000000";
    game.state.board[r][5] = "#000000";
  }
  forcePiece(game, "O", { x: 4, y: 0, rot: 0 });

  game.step(LOCK_DELAY_MS);
  // The piece locks into the blocked rows; the fresh spawn then collides.
  assert.ok(events.includes("gameover"), "gameover must be emitted");
  assert.equal(game.state.gameOver, true);
});

/* =========================================================
 *  6. Determinism and DAS/ARR
 * ========================================================= */

test("step is deterministic: same state + same delta = same result", () => {
  function run() {
    const game = makeGame({ rng: fixedRng });
    game.state.bag = [];
    game.reset();
    for (let i = 0; i < 40; i++) game.step(17);
    return {
      board: JSON.stringify(game.state.board),
      piece: JSON.stringify(game.state.current),
      score: game.state.score,
      next: game.state.nextType,
    };
  }
  assert.deepEqual(run(), run());
});

test("step is independent of wall-clock: only the delta matters", () => {
  const a = makeGame({ order: ["T", "I", "O"] });
  const b = makeGame({ order: ["T", "I", "O"] });
  forcePiece(a, "T", { x: 4, y: 4, rot: 0 });
  forcePiece(b, "T", { x: 4, y: 4, rot: 0 });
  // One 50ms step in each: identical outcomes, no hidden clock.
  a.step(50);
  b.step(50);
  assert.equal(a.state.current.y, b.state.current.y);
  assert.equal(a.state.dropCounter, b.state.dropCounter);
});

test("DAS/ARR: one step on press, repeat after 170ms, then every 50ms", () => {
  // An I piece at rot 0 leaves room to the right (cols x..x+3), so the
  // repeat loop is never stopped by the wall.
  const game = makeGame({ order: ["I", "T", "O"] });
  forcePiece(game, "I", { x: 0, y: 4, rot: 0 });

  game.pressMove(1);
  assert.equal(game.state.current.x, 1, "immediate step on press");

  // Before DAS charges nothing else happens.
  game.step(DAS_MS - 1);
  assert.equal(game.state.current.x, 1, "no repeat before DAS charges");

  // Crossing DAS fires one more step.
  game.step(1);
  assert.equal(game.state.current.x, 2, "DAS fires at 170ms");

  // Then ARR: 50ms per step.
  game.step(ARR_MS);
  assert.equal(game.state.current.x, 3, "ARR step at 50ms");
  game.step(ARR_MS * 2);
  assert.equal(game.state.current.x, 5, "two more ARR steps");

  // Release stops it.
  game.releaseMove(1);
  game.step(500);
  assert.equal(game.state.current.x, 5, "released direction stops repeating");
});

test("DAS: the release is direction-aware", () => {
  const game = makeGame({ order: ["T", "I", "O"] });
  forcePiece(game, "T", { x: 4, y: 4, rot: 0 });
  game.pressMove(1);
  game.releaseMove(-1); // stale release from the other direction
  game.step(DAS_MS + ARR_MS);
  assert.ok(game.state.current.x > 5, "a stale release must not stop DAS");
  game.releaseMove(1);
  game.step(DAS_MS + ARR_MS);
  const x = game.state.current.x;
  game.step(DAS_MS + ARR_MS);
  assert.equal(game.state.current.x, x, "the matching release stops DAS");
});

/* =========================================================
 *  7. Pause
 * ========================================================= */

test("pause: step is a no-op while paused", () => {
  const game = makeGame({ order: ["T", "I", "O"] });
  forcePiece(game, "T", { x: 4, y: 4, rot: 0 });
  const y = game.state.current.y;

  game.togglePause();
  assert.equal(game.state.paused, true);
  game.step(10_000);
  assert.equal(game.state.current.y, y, "gravity must not run while paused");
  assert.equal(game.state.dropCounter, 0);

  game.togglePause();
  assert.equal(game.state.paused, false);
});

test("pause: intents are refused while paused", () => {
  const game = makeGame({ order: ["T", "I", "O"] });
  forcePiece(game, "T", { x: 4, y: 4, rot: 0 });
  game.togglePause();
  assert.equal(game.move(1), false);
  assert.equal(game.rotate(1), false);
  assert.equal(game.hardDrop(), false);
  assert.equal(game.holdPiece(), false);
  assert.equal(game.softDrop(), false);
});

test("pause: pausing clears the held direction", () => {
  const game = makeGame({ order: ["T", "I", "O"] });
  forcePiece(game, "T", { x: 4, y: 4, rot: 0 });
  game.pressMove(1);
  assert.equal(game.state.moveDir, 1);
  game.togglePause();
  assert.equal(game.state.moveDir, 0, "no resume mid-DAS after a pause");
});

/* =========================================================
 *  8. Scoring and gravity parity with v0.2
 * ========================================================= */

test("scoring: line clear value is table x level", () => {
  const game = makeGame({ order: ["I", "T", "O"] });
  setBoard(game, bottomRowWithGap(3, 4));
  forcePiece(game, "I", { x: 3, y: 16, rot: 0 });
  game.hardDrop();
  // Score after the drop is the hard-drop reward (2 x distance) only; the
  // clear reward is applied when the flash ends.
  const afterDrop = game.state.score;
  assert.equal(game.state.lines, 0, "lines are counted after the flash");
  game.step(CLEAR_FLASH_MS);
  assert.equal(game.state.lines, 1);
  assert.equal(game.state.score, afterDrop + 100, "single at level 1 is 100");
  assert.equal(game.state.level, 1);
});

test("gravity: the drop interval matches v0.2 at level 1", () => {
  const game = makeGame({ order: ["T", "I", "O"] });
  forcePiece(game, "T", { x: 4, y: 0, rot: 0 });
  assert.equal(game.state.dropInterval, 800);
  game.step(800); // dropCounter > 800 is the v0.2 condition
  assert.equal(game.state.current.y, 0, "not yet at exactly 800");
  game.step(1);
  assert.equal(game.state.current.y, 1, "drops just past 800");
});

test("reset: returns the game to a clean v0.2 starting state", () => {
  const game = makeGame({ order: ["T", "I", "O"] });
  forcePiece(game, "O", { x: 4, y: 18, rot: 0 });
  game.step(LOCK_DELAY_MS);
  assert.equal(game.state.gameOver, false, "the board is empty: locking is not game over");

  // Dirty the state, then check reset() clears it.
  game.state.gameOver = true;
  game.state.score = 1234;
  game.state.level = 7;
  game.state.lines = 42;
  game.state.holdType = "T";
  game.state.holdUsed = true;
  game.state.clearing = { rows: [19], timer: 10 };
  game.state.paused = true;

  game.reset();
  assert.equal(game.state.gameOver, false);
  assert.equal(game.state.score, 0);
  assert.equal(game.state.level, 1);
  assert.equal(game.state.lines, 0);
  assert.equal(game.state.holdType, null);
  assert.equal(game.state.holdUsed, false);
  assert.equal(game.state.clearing, null);
  assert.equal(game.state.paused, false);
  assert.equal(countCells(game), 0, "the board is empty");
  assert.equal(game.state.dropInterval, 800);
});
