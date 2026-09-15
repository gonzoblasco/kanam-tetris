"use strict";

/* =========================================================
 *  UI wiring tests - node:test, zero dependencies.
 *  Run with: node --test test/
 *
 *  This file covers the seam the core tests cannot see: main.js
 *  wired against a fake DOM. Both bugs of v0.4 lived here (the
 *  game-over overlay that never showed, and the empty COLA panel
 *  because the renderer read state.queue while the core exposed
 *  game.queue). The core was green through both.
 *
 *  main.js reads its globals at import time, so the fake DOM is
 *  installed first and the module imported afterwards with a
 *  cache-busting query (a fresh instance per import).
 * ========================================================= */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// A 2D context that records the calls the renderer makes.
function makeCtx() {
  const calls = [];
  return {
    calls,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    shadowBlur: 0,
    shadowColor: "",
    font: "",
    textAlign: "",
    textBaseline: "",
    setLineDash() {},
    clearRect() {},
    fillRect() { calls.push("fillRect"); },
    strokeRect() { calls.push("strokeRect"); },
    beginPath() {},
    arc() { calls.push("arc"); },
    fill() {},
    stroke() {},
    moveTo() {},
    lineTo() {},
    save() {},
    restore() {},
    translate() {},
    fillText() { calls.push("fillText"); },
  };
}

function makeEl(id, width, height) {
  const ctx = makeCtx();
  const classes = new Set();
  const listeners = {};
  let text = "";
  const el = {
    id,
    width,
    height,
    // The real DOM coerces textContent to string; a fake that keeps the raw
    // value would hide a genuine mismatch (and fail assertions that a browser
    // would pass).
    get textContent() { return text; },
    set textContent(v) { text = String(v); },
    style: {},
    ctx,
    classes,
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
      contains: (c) => classes.has(c),
    },
    addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); },
    removeEventListener: () => {},
    blur: () => {},
    getContext: () => ctx,
    fire: (t, ev) => { for (const fn of listeners[t] || []) fn(ev); },
  };
  return el;
}

// Install the fake browser, then load main.js into it.
async function bootApp() {
  const canvasIds = ["board", "next", "hold", "queue"];
  const ids = [
    ...canvasIds,
    "overlay", "overlay-title", "overlay-sub", "restart",
    "hiscore", "score", "level", "lines", "combo", "b2b",
  ];
  const els = {};
  for (const id of ids) {
    const [w, h] = id === "board" ? [300, 600]
      : id === "queue" ? [60, 104]
      : canvasIds.includes(id) ? [80, 60]
      : [0, 0];
    els[id] = makeEl(id, w, h);
  }

  const docListeners = {};
  const document_ = {
    getElementById: (id) => els[id] || null,
    addEventListener: (t, fn) => { (docListeners[t] ||= []).push(fn); },
    removeEventListener: () => {},
    fire: (t, ev) => { for (const fn of docListeners[t] || []) fn(ev); },
  };
  const winListeners = {};
  const window_ = {
    addEventListener: (t, fn) => { (winListeners[t] ||= []).push(fn); },
    removeEventListener: () => {},
    fire: (t, ev) => { for (const fn of winListeners[t] || []) fn(ev); },
  };

  const raf = [];
  let clock = 0;

  globalThis.document = document_;
  globalThis.window = window_;
  globalThis.performance = { now: () => clock };
  globalThis.requestAnimationFrame = (cb) => { raf.push(cb); return raf.length; };

  const mod = await import(`../src/main.js?ui=${Date.now()}-${Math.random()}`);

  return {
    els, document: document_, window: window_, raf,
    tick(ms = 16) { clock += ms; const cb = raf.shift(); if (cb) cb(clock); },
    setClock(v) { clock = v; },
    mod,
  };
}

const key = (k, repeat = false) => ({ key: k, repeat, preventDefault() {} });

/* =========================================================
 *  The COLA panel: the renderer must read the queue from
 *  state, which is the object it is handed.
 *
 *  v0.4 exposed the queue as a getter on the returned game
 *  object while render.js read state.queue. Core tests were
 *  green (they read game.queue) and the panel stayed empty.
 * ========================================================= */
test("ui: the queue panel draws the upcoming pieces", async () => {
  const app = await bootApp();
  const qctx = app.els.queue.ctx;
  const drawn = qctx.calls.filter((c) => c === "strokeRect").length;
  assert.ok(drawn > 0,
    "the queue canvas must receive piece outlines; an empty panel means the renderer cannot see the queue");
});

test("ui: the queue panel shows up to four trailing pieces", async () => {
  const app = await bootApp();
  const qctx = app.els.queue.ctx;
  // A piece is 4 cells; the panel draws indices 1..4 of a 5-piece window,
  // so 4 pieces x 4 cells = 16 outlines (fewer if a cell is clipped).
  const drawn = qctx.calls.filter((c) => c === "strokeRect").length;
  assert.ok(drawn >= 12,
    `expected roughly 16 cell outlines for 4 pieces, got ${drawn}`);
});

/* =========================================================
 *  Pause overlay: the same wiring path the game-over overlay
 *  uses (showOverlay / hideOverlay), exercised end to end.
 * ========================================================= */
test("ui: pause shows the overlay and resuming hides it", async () => {
  const app = await bootApp();
  const overlay = app.els.overlay;

  assert.equal(overlay.classList.contains("visible"), false,
    "the overlay starts hidden");

  app.document.fire("keydown", key("p"));
  assert.equal(overlay.classList.contains("visible"), true,
    "pressing P must show the pause overlay");
  assert.equal(app.els["overlay-title"].textContent, "Pausa");

  app.document.fire("keydown", key("p"));
  assert.equal(overlay.classList.contains("visible"), false,
    "pressing P again must hide it");
});

test("ui: the pause overlay hides the restart button (P resumes)", async () => {
  const app = await bootApp();
  app.document.fire("keydown", key("p"));
  assert.equal(app.els.restart.style.display, "none",
    "while paused there is no restart button; P/Esc resumes");
});

/* =========================================================
 *  HUD: score/level/lines are mirrored from the core state
 *  on every frame.
 * ========================================================= */
test("ui: a frame mirrors the core state into the HUD", async () => {
  const app = await bootApp();
  app.tick(16);
  assert.equal(app.els.score.textContent, "0");
  assert.equal(app.els.level.textContent, "1");
  assert.equal(app.els.lines.textContent, "0");
  assert.equal(app.els.combo.classList.contains("visible"), false,
    "no combo indicator with no chain");
  assert.equal(app.els.b2b.classList.contains("visible"), false,
    "no back-to-back badge at the start");
});

test("ui: the board renders dots and the active piece on the first frame", async () => {
  const app = await bootApp();
  const bctx = app.els.board.ctx;
  const arcs = bctx.calls.filter((c) => c === "arc").length;
  assert.equal(arcs, 200, "the dot floor covers every cell (10x20)");
  const strokes = bctx.calls.filter((c) => c === "strokeRect").length;
  assert.ok(strokes > 0, "the active piece is drawn as outlined cells");
});

/* =========================================================
 *  Game over: the overlay must appear when the game ends,
 *  even if it ends BETWEEN frames.
 *
 *  This is the bug Gonzo reported from the browser: topping
 *  out showed nothing. The UI used to detect the transition
 *  by diffing state.gameOver across frames, but a hard drop
 *  ends the game synchronously inside the keydown handler, so
 *  the next frame saw the flag already set and the transition
 *  was never detected. The core always emitted `gameover`.
 * ========================================================= */
test("ui: game over shows the overlay (including when it ends between frames)", async () => {
  const app = await bootApp();
  const { game } = app.mod;
  const overlay = app.els.overlay;

  // A tall stack with no complete row: the next spawn collides, no line clears.
  for (let r = 2; r < 20; r++)
    for (let c = 0; c < 10; c++)
      if (c % 2 === 0) game.state.board[r][c] = "#22d3ee";

  assert.equal(overlay.classList.contains("visible"), false,
    "precondition: no overlay while the game is alive");

  // End it the way a player does: a keydown, i.e. OUTSIDE the frame loop.
  app.document.fire("keydown", key(" "));

  assert.equal(game.state.gameOver, true, "the hard drop topped out");
  assert.equal(overlay.classList.contains("visible"), true,
    "the overlay must appear even though the game ended between frames");
  assert.equal(app.els["overlay-title"].textContent, "Fin del juego");
  assert.notEqual(app.els.restart.style.display, "none",
    "the restart button is offered on game over");
});

test("ui: restarting after game over hides the overlay", async () => {
  const app = await bootApp();
  const { game } = app.mod;
  const overlay = app.els.overlay;

  for (let r = 2; r < 20; r++)
    for (let c = 0; c < 10; c++)
      if (c % 2 === 0) game.state.board[r][c] = "#22d3ee";
  app.document.fire("keydown", key(" "));
  assert.equal(overlay.classList.contains("visible"), true);

  app.els.restart.fire("click", {});
  assert.equal(overlay.classList.contains("visible"), false,
    "restart hides the overlay");
  assert.equal(game.state.gameOver, false, "and the game is playable again");
});
test("ui: each frame schedules the next one", async () => {
  const app = await bootApp();
  const before = app.raf.length;
  app.tick(16);
  assert.ok(app.raf.length >= before,
    "the loop must re-arm requestAnimationFrame every frame");
});

/* =========================================================
 *  Static structure: the overlay must sit OUTSIDE the
 *  perspective context.
 *
 *  `perspective` on a shared parent puts the overlay and the
 *  tilted canvas in the SAME 3D rendering context, so the
 *  tilted canvas composites over the flat overlay and hides it.
 *  That is exactly what Gonzo saw: the overlay was showing, but
 *  the board painted on top of it. The overlay is flat UI and
 *  belongs outside. No core test can see a CSS contract, so it
 *  is pinned here by reading index.html.
 * ========================================================= */
const HTML = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "index.html"),
  "utf8",
);

// Inner slice of the div with the given id, matching nested <div> tags so the
// result does not depend on formatting or whitespace.
function innerOf(id) {
  const open = new RegExp(`<div[^>]*id="${id}"[^>]*>`);
  const m = open.exec(HTML);
  if (!m) return null;
  const start = m.index + m[0].length;
  const tag = /<\/?div\b[^>]*>/g;
  tag.lastIndex = start;
  let depth = 1;
  let t;
  while ((t = tag.exec(HTML))) {
    depth += t[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return HTML.slice(start, t.index);
  }
  return null;
}

test("html: the overlay is outside the perspective wrapper", () => {
  const wrap = innerOf("board-wrap");
  assert.ok(wrap !== null, "#board-wrap must exist");
  assert.ok(!wrap.includes('id="overlay"'),
    "#overlay must NOT be inside #board-wrap: perspective makes the tilted canvas composite over it");

  const stack = innerOf("board-stack");
  assert.ok(stack !== null, "#board-stack must exist as the flat positioning parent");
  assert.ok(stack.includes('id="overlay"'),
    "#overlay belongs inside #board-stack");
  assert.ok(stack.includes('id="board-wrap"'),
    "#board-stack also holds the tilted canvas wrapper");
});

test("html: the tilt stays subtle enough to read columns", () => {
  assert.ok(/perspective:\s*1000px/.test(HTML), "the tilt declares a perspective");
  const m = /rotateX\((\d+)deg\)/.exec(HTML);
  assert.ok(m, "the canvas is rotated on X");
  const deg = Number(m[1]);
  assert.ok(deg >= 8 && deg <= 16,
    `the tilt must stay in 8-16deg so columns remain readable, got ${deg}`);
});

test("html: the overlay stacks above the board", () => {
  assert.ok(/z-index:\s*1/.test(HTML),
    "the overlay needs an explicit z-index; without one the composition order depends on paint order");
});
