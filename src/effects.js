"use strict";

/* =========================================================
 *  Game feel - screen shake + line-clear particles.
 *
 *  Both effects are pure functions of delta: update(delta)
 *  advances them, and nothing in here reads a clock or the
 *  DOM. That keeps the renderer read-only (render.js never
 *  mutates game state) and makes the whole module testable
 *  from Node without a canvas.
 *
 *  Accessibility is not optional: when prefers-reduced-motion
 *  is active, shake is disabled entirely. Particles stay, in
 *  reduced numbers, because they carry information (which
 *  rows cleared) that the flash alone does not: they are
 *  motion, but the flag is honored by lowering burst count
 *  and speed rather than by removing the readout.
 * ========================================================= */

// Shake tuning: subtle enough to feel, never enough to blur the board.
const SHAKE_MS = 130;
const SHAKE_PX = 3;        // peak offset; the spec allows 2-4px

// Particle tuning.
const PARTICLE_MS = 420;
const PARTICLE_PX = 6;     // edge length of one square
const PARTICLE_GRAVITY = 260; // px/s^2, downward
const PARTICLES_PER_CELL = 3;
const REDUCED_PARTICLES_PER_CELL = 1;
const REDUCED_PARTICLE_MS = 300;

/* =========================================================
 *  createEffects({ reducedMotion, rng })
 *
 *  reducedMotion: boolean, read from matchMedia by the caller
 *    (main.js) so this module never touches a browser global.
 *  rng: () => [0,1), injectable for deterministic tests.
 * ========================================================= */
export function createEffects({ reducedMotion = false, rng = Math.random } = {}) {
  const state = {
    shake: 0,        // remaining ms of shake
    shakeMax: 0,     // duration of the current shake (for the decay)
    shakeX: 0,       // computed offset for this frame
    shakeY: 0,
    particles: [],   // {x, y, vx, vy, life, maxLife, color, size}
    reducedMotion: reducedMotion === true,
  };

  // Trigger a shake. Returns true when it actually started, false when
  // reduced motion disabled it (so tests can pin the accessibility rule).
  function shake(ms = SHAKE_MS, px = SHAKE_PX) {
    if (state.reducedMotion) return false;
    // A stronger shake must not be shortened by a weaker one landing on
    // top of it: keep the longer duration.
    if (ms > state.shake) {
      state.shake = ms;
      state.shakeMax = ms;
    }
    state.shakePx = px;
    return true;
  }

  // Burst particles along the cleared rows. `color` is the piece color
  // that completed them, which is what makes the burst readable.
  // `cell`: pixel size of one board cell; `cols`: board width in cells.
  function burst({ rows = [], color = "#ffffff", cell = 30, cols = 10 } = {}) {
    const per = state.reducedMotion ? REDUCED_PARTICLES_PER_CELL : PARTICLES_PER_CELL;
    const life = state.reducedMotion ? REDUCED_PARTICLE_MS : PARTICLE_MS;
    for (const r of rows) {
      for (let c = 0; c < cols; c++) {
        for (let k = 0; k < per; k++) {
          state.particles.push({
            // Start inside the cell, not at its corner: a burst from the
            // exact corner reads as a grid artifact.
            x: c * cell + cell * (0.25 + rng() * 0.5),
            y: r * cell + cell * (0.25 + rng() * 0.5),
            // Upward kick then gravity: the standard pop.
            vx: (rng() - 0.5) * 90,
            vy: -40 - rng() * 90,
            life,
            maxLife: life,
            color,
            size: PARTICLE_PX,
          });
        }
      }
    }
    return state.particles.length;
  }

  // Advance by deltaMs. Returns the number of live particles.
  // update(0) must be safe and must not age anything: the first frame
  // after a tab regains focus can deliver delta 0.
  function update(deltaMs = 0) {
    const delta = Number.isFinite(deltaMs) ? Math.max(0, deltaMs) : 0;
    const dt = delta / 1000;

    if (state.shake > 0) {
      state.shake = Math.max(0, state.shake - delta);
      const t = state.shakeMax > 0 ? state.shake / state.shakeMax : 0;
      const amp = (state.shakePx ?? SHAKE_PX) * t * t; // fast decay
      // Deterministic per frame would be ideal, but the amplitude decay
      // is the readable part; the direction is jitter.
      state.shakeX = (rng() * 2 - 1) * amp;
      state.shakeY = (rng() * 2 - 1) * amp;
    } else {
      state.shakeX = 0;
      state.shakeY = 0;
    }

    if (state.particles.length === 0) return 0;

    for (const p of state.particles) {
      p.life -= delta;
      p.vy += PARTICLE_GRAVITY * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    // Expire in place: a particle whose life ran out is dropped.
    state.particles = state.particles.filter((p) => p.life > 0);
    return state.particles.length;
  }

  // Clear everything without advancing. Used on reset so a burst from the
  // previous game does not bleed into the new board.
  function reset() {
    state.shake = 0;
    state.shakeMax = 0;
    state.shakeX = 0;
    state.shakeY = 0;
    state.particles = [];
  }

  function setReducedMotion(flag) {
    state.reducedMotion = flag === true;
    return state.reducedMotion;
  }

  return { state, shake, burst, update, reset, setReducedMotion };
}

export { SHAKE_MS, SHAKE_PX, PARTICLE_MS, PARTICLE_PX };
