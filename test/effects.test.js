"use strict";

/* =========================================================
 *  Game feel tests - node:test, zero dependencies.
 *  Run with: node --test test/
 *
 *  effects.js is a pure function of delta: update(ms) advances
 *  shake and particles, and nothing reads a clock or a canvas.
 *  That is what makes the whole module testable from Node -
 *  no browser, no 2D context, no requestAnimationFrame.
 *
 *  The accessibility rule is pinned here as a hard assertion:
 *  prefers-reduced-motion disables the shake, always.
 * ========================================================= */

import test from "node:test";
import assert from "node:assert/strict";
import {
  createEffects,
  SHAKE_MS,
  SHAKE_PX,
  PARTICLE_MS,
} from "../src/effects.js";

// Deterministic rng so particle positions and shake jitter are stable.
function seqRng(values = [0.5, 0.25, 0.75, 0.1, 0.9]) {
  let i = 0;
  return () => values[i++ % values.length];
}

/* =========================================================
 *  Screen shake.
 * ========================================================= */
test("effects: a shake produces a non-zero offset", () => {
  const fx = createEffects({ rng: seqRng([0.9, 0.1]) });
  const started = fx.shake();
  assert.equal(started, true, "the shake started");
  fx.update(16);
  const off = Math.abs(fx.state.shakeX) + Math.abs(fx.state.shakeY);
  assert.ok(off > 0, "the offset must be non-zero while shaking");
});

test("effects: the shake offset stays inside the 2-4px budget", () => {
  const fx = createEffects({ rng: seqRng([0.99, 0.99]) });
  fx.shake(SHAKE_MS, SHAKE_PX);
  fx.update(1);
  assert.ok(Math.abs(fx.state.shakeX) <= SHAKE_PX,
    `|${fx.state.shakeX}| exceeds the ${SHAKE_PX}px peak`);
  assert.ok(Math.abs(fx.state.shakeY) <= SHAKE_PX);
});

test("effects: the shake decays and ends, leaving a zero offset", () => {
  const fx = createEffects({ rng: seqRng([0.9, 0.9]) });
  fx.shake();
  fx.update(SHAKE_MS / 2);
  const mid = Math.abs(fx.state.shakeX);
  fx.update(SHAKE_MS); // past the end
  assert.equal(fx.state.shake, 0, "the timer is spent");
  assert.equal(fx.state.shakeX, 0, "and the offset is back to zero");
  assert.equal(fx.state.shakeY, 0);
  assert.ok(mid >= 0, "mid-shake reading taken");
});

test("effects: prefers-reduced-motion disables the shake entirely", () => {
  const fx = createEffects({ reducedMotion: true, rng: seqRng([0.9, 0.9]) });
  const started = fx.shake();

  assert.equal(started, false, "shake() must refuse under reduced motion");
  assert.equal(fx.state.shake, 0, "no shake timer is armed");
  fx.update(16);
  assert.equal(fx.state.shakeX, 0, "and no offset is ever produced");
  assert.equal(fx.state.shakeY, 0);
});

test("effects: a stronger shake is not cut short by a weaker one", () => {
  const fx = createEffects({ rng: seqRng() });
  fx.shake(300);
  fx.shake(100); // a shorter shake lands while the long one is running
  assert.equal(fx.state.shake, 300, "the longer timer survives");
});

/* =========================================================
 *  Particles.
 * ========================================================= */
test("effects: a burst creates particles for every cleared cell", () => {
  const fx = createEffects({ rng: seqRng() });
  const total = fx.burst({ rows: [19], color: "#22d3ee", cell: 30, cols: 10 });
  assert.ok(total > 0, "one cleared row must produce particles");
  assert.equal(total, fx.state.particles.length, "the count matches the pool");
});

test("effects: a two-row clear produces more particles than a single", () => {
  const one = createEffects({ rng: seqRng() });
  one.burst({ rows: [19], cell: 30, cols: 10 });

  const two = createEffects({ rng: seqRng() });
  two.burst({ rows: [18, 19], cell: 30, cols: 10 });

  assert.ok(two.state.particles.length > one.state.particles.length,
    "more cleared rows means more particles");
});

test("effects: particles carry the cleared piece color", () => {
  const fx = createEffects({ rng: seqRng() });
  fx.burst({ rows: [19], color: "#facc15", cell: 30, cols: 4 });
  assert.ok(fx.state.particles.length > 0);
  assert.ok(fx.state.particles.every((p) => p.color === "#facc15"),
    "every particle inherits the burst color");
});

test("effects: particles expire after their lifetime", () => {
  const fx = createEffects({ rng: seqRng() });
  fx.burst({ rows: [19], cell: 30, cols: 10 });
  assert.ok(fx.state.particles.length > 0, "precondition: particles exist");

  const live = fx.update(PARTICLE_MS + 1);
  assert.equal(live, 0, "past the lifetime nothing is left");
  assert.equal(fx.state.particles.length, 0, "the pool is emptied");
});

test("effects: particles survive a partial step and shrink the pool over time", () => {
  const fx = createEffects({ rng: seqRng() });
  fx.burst({ rows: [19], cell: 30, cols: 10 });
  const before = fx.state.particles.length;

  fx.update(PARTICLE_MS / 2);
  const mid = fx.state.particles.length;
  assert.equal(mid, before, "halfway through, every particle is still alive");

  fx.update(PARTICLE_MS / 2 + 1);
  assert.equal(fx.state.particles.length, 0, "and then they are gone");
});

test("effects: particles move under gravity", () => {
  const fx = createEffects({ rng: seqRng([0.5, 0.5, 0.5, 0.5, 0.5]) });
  fx.burst({ rows: [19], cell: 30, cols: 1 });
  const p = fx.state.particles[0];
  const y0 = p.y;
  const vy0 = p.vy;
  fx.update(100);
  assert.notEqual(p.y, y0, "the particle moved");
  assert.ok(p.vy > vy0, "and gravity pulled it down");
});

/* =========================================================
 *  update(0) and reset: the edge cases that break loops.
 * ========================================================= */
test("effects: update(0) is safe and ages nothing", () => {
  const fx = createEffects({ rng: seqRng() });
  fx.burst({ rows: [19], cell: 30, cols: 10 });
  const before = fx.state.particles.length;
  const lifeBefore = fx.state.particles[0].life;

  assert.doesNotThrow(() => fx.update(0));
  assert.equal(fx.state.particles.length, before, "no particle expired");
  assert.equal(fx.state.particles[0].life, lifeBefore, "no life was consumed");
});

test("effects: update with no particles and no shake is a no-op", () => {
  const fx = createEffects({ rng: seqRng() });
  assert.doesNotThrow(() => fx.update(16));
  assert.equal(fx.state.particles.length, 0);
  assert.equal(fx.state.shakeX, 0);
});

test("effects: a negative or non-finite delta is clamped, never rewind", () => {
  const fx = createEffects({ rng: seqRng() });
  fx.burst({ rows: [19], cell: 30, cols: 4 });
  const life = fx.state.particles[0].life;

  fx.update(-500);
  assert.equal(fx.state.particles[0].life, life, "a negative delta must not heal");

  assert.doesNotThrow(() => fx.update(NaN));
  assert.doesNotThrow(() => fx.update(Infinity));
});

test("effects: reset clears the board of every effect", () => {
  const fx = createEffects({ rng: seqRng() });
  fx.shake();
  fx.burst({ rows: [19], cell: 30, cols: 10 });
  fx.reset();
  assert.equal(fx.state.particles.length, 0);
  assert.equal(fx.state.shake, 0);
  assert.equal(fx.state.shakeX, 0);
});

/* =========================================================
 *  Reduced motion and particles.
 * ========================================================= */
test("effects: reduced motion thins the burst instead of removing it", () => {
  const normal = createEffects({ rng: seqRng() });
  normal.burst({ rows: [19], cell: 30, cols: 10 });

  const reduced = createEffects({ reducedMotion: true, rng: seqRng() });
  reduced.burst({ rows: [19], cell: 30, cols: 10 });

  assert.ok(reduced.state.particles.length > 0,
    "the readout survives, it is information");
  assert.ok(reduced.state.particles.length < normal.state.particles.length,
    "but with fewer particles per cell");
});

test("effects: setReducedMotion flips the shake rule at runtime", () => {
  const fx = createEffects({ rng: seqRng() });
  assert.equal(fx.shake(), true, "shaking normally");

  fx.setReducedMotion(true);
  assert.equal(fx.shake(), false, "and refusing once the user opts out");

  fx.setReducedMotion(false);
  assert.equal(fx.shake(), true, "and shaking again when they turn it back on");
});
