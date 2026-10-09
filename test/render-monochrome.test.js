"use strict";

/* =========================================================
 *  U2 - Monochrome render invariants (node:test, zero deps).
 *  Run with: node --test test/
 *
 *  Golden rule (owner, non-negotiable): a piece is identified by
 *  its MATERIAL PATTERN, never by colour, never by brightness.
 *  Tone is purely decorative. These tests defend that rule on the
 *  render path: no piece colour may reach a fillStyle/strokeStyle.
 *
 *  Strategy: a recording 2D context that captures every colour
 *  string handed to the painter. We drive the real renderer and
 *  assert (a) none of the 7 live piece hues is ever used as a
 *  paint colour, (b) every painted colour is one of the 4 GB
 *  tones (strict monochrome, ADR-097: zero white, zero purple),
 *  and (c) the render.js source contains no hex literal outside
 *  the GB palette at all.
 * ========================================================= */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { PIECES, PIECE_TYPES, PATTERN_NAMES, MICRO_PATTERNS, COLS, ROWS } from "../src/core.js";
import { createRenderer, CELL } from "../src/render.js";
import { emptyBoardString, boardFromString } from "./harness.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const RENDER_SRC = readFileSync(join(HERE, "..", "src", "render.js"), "utf8");

// The 4 Game Boy DMG tones, in hex and rgb triples.
const PALETTE_HEX = ["#0f380f", "#306230", "#8bac0f", "#9bbc0f"];
const PALETTE_RGB = PALETTE_HEX.map((h) => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
});

// Strict monochrome (ADR-097): the ONLY colours permitted on the render path
// are the 4 GB tones. White floor dots, the line-clear flash and the T-spin
// announcement chrome are all GB tones now - no white, no purple. Feedback for
// the special events is carried by intensity/width/blink, never by hue.
const UI_CHROME = []; // no non-GB chrome colours remain

// A 2D context that records every colour ever assigned to a paint style.
function makeRecordingCtx() {
  const paints = []; // every string handed to fillStyle/strokeStyle/shadowColor
  const calls = [];
  function record(v) {
    if (typeof v === "string" && v.length > 0) paints.push(v);
    return v;
  }
  let fillStyle = "";
  let strokeStyle = "";
  let shadowColor = "";
  const ctx = {
    paints,
    calls,
    get fillStyle() { return fillStyle; },
    set fillStyle(v) { fillStyle = record(v); },
    get strokeStyle() { return strokeStyle; },
    set strokeStyle(v) { strokeStyle = record(v); },
    get shadowColor() { return shadowColor; },
    set shadowColor(v) { shadowColor = record(v); },
    lineWidth: 1,
    globalAlpha: 1,
    shadowBlur: 0,
    font: "",
    textAlign: "",
    textBaseline: "",
    setLineDash() {},
    clearRect() {},
    createLinearGradient() { return { addColorStop() {} }; },
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
  return ctx;
}

function fakeCanvas(w, h, ctx) {
  return { width: w, height: h, getContext: () => ctx };
}

// Turn any recorded colour string into an rgb triple, or null if it does
// not carry colour (e.g. it is not a hex/rgb string we model).
function rgbOf(str) {
  const s = String(str).trim().toLowerCase();
  let m = /^#([0-9a-f]{6})$/.exec(s);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) {
    const c = m[1];
    return [parseInt(c[0] + c[0], 16), parseInt(c[1] + c[1], 16), parseInt(c[2] + c[2], 16)];
  }
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(s);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return null;
}

function sameRgb(a, b) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

// Build a renderer whose canvases all share one recording context per panel.
function makeRenderer() {
  const ctxs = {
    board: makeRecordingCtx(),
    next: makeRecordingCtx(),
    hold: makeRecordingCtx(),
    queue: makeRecordingCtx(),
  };
  const renderer = createRenderer({
    canvas: fakeCanvas(COLS * CELL, ROWS * CELL, ctxs.board),
    nextCanvas: fakeCanvas(80, 60, ctxs.next),
    holdCanvas: fakeCanvas(80, 60, ctxs.hold),
    queueCanvas: fakeCanvas(60, 104, ctxs.queue),
  });
  return { renderer, ctxs };
}

// A state that exercises every drawing path: settled cells of every type,
// the active piece, its ghost, and the previews.
function richState() {
  const board = boardFromString(emptyBoardString());
  // One settled cell of each piece colour on the bottom rows.
  PIECE_TYPES.forEach((type, i) => {
    board[ROWS - 1][i] = PIECES[type].color;
  });
  return {
    board,
    current: {
      type: "T",
      matrix: PIECES.T.matrix.map((r) => r.slice()),
      color: PIECES.T.color,
      x: 3,
      y: 2,
      rot: 0,
    },
    nextType: "S",
    holdType: "Z",
    holdUsed: false,
    queue: ["I", "O", "T", "S", "Z"],
    clearing: null,
    gameOver: false,
    lockTimer: 0,
    announce: null,
  };
}

test("render: no live piece hue is ever used as a paint colour (incl. unknown faces)", () => {
  const { renderer, ctxs } = makeRenderer();
  const state = richState();
  // An UNKNOWN face on the board: a cell colour that is not a piece colour.
  // This is exactly the path the old colour fallback used to paint raw.
  state.board[ROWS - 2][0] = "#ff00ff";
  renderer.draw(state);
  // Force the lock glow path (grounded piece) so shadowColor is exercised too.
  state.lockTimer = 200;
  state.current.y = ROWS - 3;
  renderer.draw(state);

  const all = [...ctxs.board.paints, ...ctxs.next.paints, ...ctxs.hold.paints, ...ctxs.queue.paints];
  assert.ok(all.length > 0, "the renderer must paint something; empty output hides the check");

  const pieceRgbs = PIECE_TYPES.map((t) => rgbOf(PIECES[t].color));
  for (const paint of all) {
    const rgb = rgbOf(paint);
    if (!rgb) continue;
    for (let i = 0; i < PIECE_TYPES.length; i++) {
      assert.ok(
        !sameRgb(rgb, pieceRgbs[i]),
        `render painted with piece colour ${PIECES[PIECE_TYPES[i]].color} ` +
          `(${PIECE_TYPES[i]}) via "${paint}" - colour is never an identity channel`,
      );
    }
    // An unknown face must not be painted with its own raw colour either.
    assert.ok(
      !sameRgb(rgb, rgbOf("#ff00ff")),
      `an unknown board face leaked its raw colour via "${paint}" - no colour path may exist`,
    );
  }
});

test("render: every painted colour is a GB tone or a non-identity UI chrome colour", () => {
  const { renderer, ctxs } = makeRenderer();
  const state = richState();
  renderer.draw(state);
  // Exercise the clear flash and the T-spin announcement chrome too.
  state.clearing = { rows: [ROWS - 1], timer: 100 };
  state.pendingTSpin = { tspin: "full" };
  state.announce = { text: "T-SPIN", at: Date.now() };
  renderer.draw(state);

  const all = [...ctxs.board.paints, ...ctxs.next.paints, ...ctxs.hold.paints, ...ctxs.queue.paints];
  for (const paint of all) {
    const rgb = rgbOf(paint);
    if (!rgb) continue;
    const isTone = PALETTE_RGB.some((p) => sameRgb(p, rgb));
    assert.ok(
      isTone,
      `unexpected paint colour "${paint}" (rgb ${rgb.join(",")}) - ` +
        `strict monochrome: only the 4 GB tones ${PALETTE_HEX.join(", ")} are allowed`,
    );
  }
});

test("render.js: no source line paints with a raw piece-colour variable", () => {
  // Static guard: the old fallback did `ctx.fillStyle = colour`. Neither the
  // raw `colour`/`p.color`/`cur.color` nor a 7-hue literal may be assigned to
  // a paint style. This catches a regression a runtime path might miss.
  const offenders = RENDER_SRC.split("\n")
    .map((line, i) => [line.trim(), i + 1])
    .filter(([line]) => /\.(fillStyle|strokeStyle|shadowColor)\s*=/.test(line))
    .filter(([line]) =>
      /=\s*(colour|color|cur\.color|p\.color|piece\.color)\b/.test(line),
    );
  assert.deepEqual(
    offenders,
    [],
    `paint assignments that use a raw colour variable: ${JSON.stringify(offenders)}`,
  );

  // And no hex literal outside the GB palette. Strict monochrome (ADR-097):
  // the source file must reference ONLY the 4 GB tones, nothing else.
  const hueLiterals = RENDER_SRC.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  const allowed = new Set(PALETTE_HEX);
  const stray = hueLiterals.filter((h) => !allowed.has(h.toLowerCase()));
  assert.deepEqual(
    stray,
    [],
    `stray hex colour literals outside the GB palette: ${JSON.stringify(stray)}`,
  );
});

test("render.js: the ONLY colours in the file are the 4 GB tones (strict monochrome)", () => {
  // ADR-097, non-negotiable: a full-file scan. Every hex literal must be one
  // of the 4 GB tones, and no raw rgb()/rgba() triple may name a non-GB colour
  // (the rgba() helper takes a hex tone, so the only allowed numeric triple is
  // one that came from a palette tone). This is the guard the owner asked for.
  const hexes = (RENDER_SRC.match(/#[0-9a-fA-F]{3,8}\b/g) || []).map((h) => h.toLowerCase());
  const allowed = new Set(PALETTE_HEX);
  const strayHex = [...new Set(hexes.filter((h) => !allowed.has(h)))];
  assert.deepEqual(
    strayHex,
    [],
    `render.js contains hex colours outside the GB palette: ${JSON.stringify(strayHex)}`,
  );

  // No inlined rgba(r,g,b,...) numeric literals that bypass the rgba(hex,...)
  // helper - those would be an untraceable colour. r/g/b must never be
  // hard-coded digits; the renderer builds colour strings from tones only.
  const rawTriples = RENDER_SRC.match(/rgba?\(\s*\d/g) || [];
  assert.deepEqual(
    rawTriples,
    [],
    `render.js inlines raw rgb() numbers instead of using the GB-tone helper: ${JSON.stringify(rawTriples)}`,
  );

  // And every palette tone must actually be present (a guard against the file
  // silently losing a tone, e.g. an over-eager find/replace).
  for (const tone of PALETTE_HEX) {
    assert.ok(RENDER_SRC.includes(tone), `render.js no longer references GB tone ${tone}`);
  }
});

test("render: MICRO_PATTERNS defines 7 distinct 8x8 material patterns", () => {
  // The new design (v0.5) draws each material from a DATA TABLE, not from a
  // per-material function plus a switch case. This test verifies that the table
  // now contains 8×8 grids (64 sub‑pixels) and that the 7 textures remain
  // pairwise distinct.
  const materials = Object.values(PATTERN_NAMES);
  assert.equal(materials.length, 7, "the piece model must name 7 materials");
  assert.equal(new Set(materials).size, 7, "the 7 material names must be distinct");

  const keys = Object.keys(MICRO_PATTERNS);
  assert.equal(keys.length, 7, "MICRO_PATTERNS must define exactly 7 materials");
  assert.deepEqual(
    [...keys].sort(),
    [...new Set(materials)].sort(),
    "MICRO_PATTERNS must define a pattern for each material the pieces name",
  );

  for (const name of keys) {
    const grid = MICRO_PATTERNS[name];
    assert.ok(Array.isArray(grid), `${name}: pattern must be an array of rows`);
    assert.equal(grid.length, 8, `${name}: pattern must be 8 rows tall`);
    let ink = 0;
    for (const row of grid) {
      assert.ok(Array.isArray(row), `${name}: each row must be an array`);
      assert.equal(row.length, 8, `${name}: each row must be 8 sub-pixels wide`);
      for (const sub of row) {
        assert.ok(sub === 0 || sub === 1, `${name}: sub-pixels are 0 (bg) or 1 (ink)`);
        if (sub) ink++;
      }
    }
    assert.equal(grid.length * grid[0].length, 64, `${name}: must be a 64 sub-pixel grid`);
    assert.ok(ink > 0, `${name}: a texture with zero ink would leave the cell blank`);
  }

  // Pairwise distinct: serialise each grid and prove no two materials collide.
  const serialised = keys.map((n) => MICRO_PATTERNS[n].map((r) => r.join("")).join("/"));
  assert.equal(
    new Set(serialised).size,
    keys.length,
    `the 7 material textures must be pairwise distinct, got ${new Set(serialised).size} unique`,
  );
});

test("accessibility: the 7 pieces map to 7 distinct materials (identity is never tone)", () => {
  // ADR-097: a piece is identified by its MATERIAL PATTERN, never by colour or
  // brightness. The old design assigned each piece a decorative TONE and
  // relied on same-tone pieces still having different materials; the new design
  // dropped per-piece tones entirely (the renderer paints one fixed light
  // background + one fixed dark outline). What must hold - and what this test
  // now pins - is that every piece names a distinct, defined material, so two
  // pieces can never share a texture (and thus a visual identity).
  const patterns = PIECE_TYPES.map((t) => PIECES[t].pattern);
  assert.equal(patterns.length, 7, "there are 7 piece types");
  assert.equal(new Set(patterns).size, 7, "the 7 piece materials must be pairwise distinct");

  for (const t of PIECE_TYPES) {
    const name = PIECES[t].pattern;
    assert.ok(
      MICRO_PATTERNS[name],
      `piece ${t} names material "${name}" but MICRO_PATTERNS has no such texture`,
    );
  }

  // The renderer must NOT carry a per-piece tone map: tone never encodes
  // identity (this is the dead-concept guard for the removed TONE_BY_TYPE).
  assert.ok(
    !/TONE_BY_TYPE/.test(RENDER_SRC),
    "render.js must not reintroduce a per-piece tone map: tone is not an identity channel",
  );
});

test("render.js: no Math.random - material stamping is deterministic", () => {
  // A MATERIAL must be STABLE: the same cell always stamps the SAME texture.
  // Math.random() made the sand (piece Z) texture change every frame - TV
  // static. The stamping must be a pure function of the cell, never of a
  // global RNG. This is a static guard on the source file.
  assert.ok(
    !RENDER_SRC.includes("Math.random"),
    "render.js must not use Math.random: material textures must be stable frame to frame",
  );
});

test("render.js: the draw path does not read the wall clock (Date.now is not called inline)", () => {
  // The render must be PURE: it receives the time, it never reads the clock.
  // The injected `now` clock default may still reference Date.now (backward
  // compat), but no call site inside the drawing code may call Date.now()
  // directly. We assert no `Date.now(` CALL remains in the source; a bare
  // reference as a default parameter value is fine.
  const callSites = RENDER_SRC.match(/Date\.now\s*\(/g) || [];
  assert.deepEqual(
    callSites,
    [],
    "render.js calls Date.now() in the render path; the clock must be injected via `now`",
  );
});

test("drawSand: the sand stamping is deterministic across frames", () => {
  // Drive the real renderer twice with the same sand cell and prove the
  // recorded fillRect coordinates are byte-identical: a settled grain, not
  // flicker. Uses the recording context from the monochrome suite.
  const { renderer, ctxs } = makeRenderer();
  const state = richState();
  state.board[ROWS - 1][0] = PIECES.Z.color; // Z is the sand material
  state.current = null;

  // Capture the ordered fillRect argument tuples for the sand cell only.
  const rects = [];
  const rawCtx = makeRecordingCtx();
  const spyFillRect = (x, y, w, h) => rects.push([x, y, w, h]);
  rawCtx.fillRect = spyFillRect;

  const pass = createRenderer({
    canvas: fakeCanvas(COLS * CELL, ROWS * CELL, rawCtx),
    nextCanvas: fakeCanvas(80, 60, makeRecordingCtx()),
    holdCanvas: fakeCanvas(80, 60, makeRecordingCtx()),
    queueCanvas: fakeCanvas(60, 104, makeRecordingCtx()),
  });

  pass.draw(state);
  const first = rects.slice();
  rects.length = 0;
  pass.draw(state);
  const second = rects.slice();

  assert.ok(first.length > 0, "the sand cell must stamp something; empty output hides the check");
  assert.deepEqual(
    first,
    second,
    "drawSand produced different dots on consecutive frames - the texture is not stable",
  );
  void renderer;
  void ctxs;
});

test("ghost and particles do not depend on the piece colour", () => {
  const { renderer, ctxs } = makeRenderer();
  const state = richState();
  // A piece grounded in open space draws its ghost; particles come from effects.
  state.current.y = 4;
  state.effects = null;

  const effects = {
    state: {
      shakeX: 0,
      shakeY: 0,
      // A particle carries a bright non-GB colour; the renderer must ignore it.
      particles: [
        { x: 15, y: 15, vx: 0, vy: 0, life: 10, maxLife: 20, color: "#f87171", size: 6 },
      ],
    },
  };
  const { renderer: r2, ctxs: c2 } = makeRenderer();
  // Rebuild with effects wired in.
  const withFx = createRenderer({
    canvas: fakeCanvas(COLS * CELL, ROWS * CELL, c2.board),
    nextCanvas: fakeCanvas(80, 60, c2.next),
    holdCanvas: fakeCanvas(80, 60, c2.hold),
    queueCanvas: fakeCanvas(60, 104, c2.queue),
    effects,
  });
  withFx.draw(state);

  const painted = [...c2.board.paints];
  assert.ok(painted.length > 0, "the board must paint; empty output hides the check");
  const particleHue = rgbOf("#f87171");
  for (const paint of painted) {
    const rgb = rgbOf(paint);
    if (!rgb) continue;
    assert.ok(
      !sameRgb(rgb, particleHue),
      `the particle's own colour leaked to the renderer via "${paint}"`,
    );
  }

  // The ghost uses a GB tone: at least one painted colour is a palette tone.
  const usesTone = painted.some((p) => {
    const rgb = rgbOf(p);
    return rgb && PALETTE_RGB.some((t) => sameRgb(t, rgb));
  });
  assert.ok(usesTone, "the ghost/board path must paint with a GB tone");
  void renderer;
  void ctxs;
});
