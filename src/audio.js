"use strict";

/* =========================================================
 *  Sound engine - Web Audio, synthesized, zero assets.
 *
 *  Every sound is an oscillator plus a gain envelope. There
 *  is not a single audio file in the project: the "tick" is
 *  a square wave, the fanfare is four scheduled blips.
 *
 *  Two rules govern this module:
 *
 *  1. Lazy context. Browsers block audio until a user
 *     gesture, so the AudioContext is created on the first
 *     input, never at import time. The context factory is
 *     injected (same seam as `rng` in the core and
 *     `blurTarget` in input.js): Node tests pass a mock and
 *     exercise the scheduler without a browser.
 *
 *  2. Never break the game. If AudioContext is missing or
 *     throws, every entry point returns quietly and the game
 *     stays playable in silence. All calls are wrapped.
 * ========================================================= */

/* =========================================================
 *  createAudio({ contextFactory, muted })
 *
 *  contextFactory: () => AudioContext-like. Defaults to the
 *  real browser constructor, resolved lazily so importing this
 *  module in Node never touches a browser global.
 *
 *  muted: initial mute state (the caller reads it from
 *  storage). Mute is a plain property, not a private flag, so
 *  the UI can toggle it without a second source of truth.
 * ========================================================= */
export function createAudio({ contextFactory, muted = false } = {}) {
  const factory = contextFactory ?? defaultContextFactory;

  let context = null;   // created on first user gesture, never before
  let contextFailed = false; // a failed build is not retried on every blip

  const audio = {
    muted: muted === true,

    // ---------- Lazy context ----------
    // Build the AudioContext on demand. Returns null when the engine is
    // silent (muted, no factory, or the constructor threw), which every
    // caller treats as "nothing to schedule".
    //
    // `gesture` is the caller's signal that a real input happened. Only
    // resume() is called with it: a context created mid-flight without a
    // gesture would stay suspended anyway.
    ensureContext(gesture = false) {
      if (audio.muted) return null;
      if (context) {
        if (gesture && typeof context.resume === "function") {
          try {
            const p = context.resume();
            if (p && typeof p.catch === "function") p.catch(() => {});
          } catch (e) {
            /* a suspended context is not an error worth surfacing */
          }
        }
        return context;
      }
      if (contextFailed) return null;
      try {
        context = factory();
      } catch (e) {
        contextFailed = true;
        return null;
      }
      if (!context) {
        contextFailed = true;
        return null;
      }
      // A context born from a gesture is usually running already; asking
      // for resume is harmless and covers the "created earlier, still
      // suspended" case.
      if (typeof context.resume === "function") {
        try {
          const p = context.resume();
          if (p && typeof p.catch === "function") p.catch(() => {});
        } catch (e) {
          /* ignore */
        }
      }
      return context;
    },

    hasContext() {
      return context !== null;
    },

    // ---------- Primitive ----------
    // One scheduled note: oscillator + gain envelope.
    //   freq: Hz (number, or a [from, to] pair for a sweep)
    //   dur:  seconds
    //   type: OscillatorNode type
    //   gain: peak gain of the envelope
    //   when: offset in seconds from now (chords and arpeggios use it)
    //
    // Envelope: near-instant attack so the note has a click-free edge,
    // then a smooth exponential release. A linear release would end on
    // a step and pop.
    blip({ freq, dur = 0.12, type = "square", gain = 0.08, when = 0 } = {}) {
      const ctx = audio.ensureContext(false);
      if (!ctx) return false;
      try {
        const now = ctx.currentTime + when;
        const end = now + dur;

        const osc = ctx.createOscillator();
        const env = ctx.createGain();

        osc.type = type;
        // A pair of frequencies means a sweep: ramp to the second one.
        const isSweep = Array.isArray(freq);
        osc.frequency.setValueAtTime(isSweep ? freq[0] : freq, now);
        if (isSweep && freq.length > 1) {
          osc.frequency.exponentialRampToValueAtTime(Math.max(1, freq[1]), end);
        }

        const attack = Math.min(0.01, dur * 0.2);
        env.gain.setValueAtTime(0.0001, now);
        env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), now + attack);
        env.gain.exponentialRampToValueAtTime(0.0001, end);

        osc.connect(env);
        env.connect(ctx.destination);
        osc.start(now);
        osc.stop(end + 0.02);
        return true;
      } catch (e) {
        return false;
      }
    },

    // ---------- Composed sounds ----------
    // Each returns the number of oscillators scheduled, so tests can
    // assert the shape of a sound without listening to it.

    // Lock: one short, low square tick. It fires on every piece, so it
    // must stay quiet and dry.
    playLock() {
      return count(audio.blip({ freq: 110, dur: 0.12, type: "square", gain: 0.07 }));
    },

    // Clear: an arpeggio that climbs with the line count. 1 line = 2
    // notes, 2 lines = 3, 3 lines = 4. A tetris is its own fanfare, so
    // this never sees lines === 4 through the event path.
    playClear(lines = 1) {
      const n = Math.max(1, Math.min(3, lines | 0));
      const root = 330; // E4
      let made = 0;
      for (let i = 0; i < n + 1; i++) {
        made += count(audio.blip({
          freq: root * Math.pow(2, i / 12 * 2), // whole-tone climb
          dur: 0.1,
          type: "triangle",
          gain: 0.09,
          when: i * 0.07,
        }));
      }
      return made;
    },

    // Tetris: a four-note fanfare, the loudest thing in the game because
    // it is the rarest.
    playTetris() {
      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
      let made = 0;
      notes.forEach((freq, i) => {
        made += count(audio.blip({
          freq,
          dur: 0.14,
          type: "square",
          gain: 0.1,
          when: i * 0.09,
        }));
      });
      return made;
    },

    // T-spin: a stacked chord, deliberately different from the clear
    // arpeggio: same start instant, three notes at once.
    playTSpin() {
      const chord = [392, 466.16, 587.33]; // G4 A#4 D5
      let made = 0;
      for (const freq of chord) {
        made += count(audio.blip({ freq, dur: 0.22, type: "sawtooth", gain: 0.06 }));
      }
      return made;
    },

    // Level up: an ascending sweep, no rhythm to it.
    playLevelUp() {
      return count(audio.blip({
        freq: [220, 880],
        dur: 0.35,
        type: "triangle",
        gain: 0.09,
      }));
    },

    // Hard drop: a short low thud. A sine keeps it from clicking.
    playHardDrop() {
      return count(audio.blip({ freq: 82, dur: 0.09, type: "sine", gain: 0.1 }));
    },

    // Hold: a soft blip, the quietest of the set (it is a utility action).
    playHold() {
      return count(audio.blip({ freq: 587.33, dur: 0.07, type: "sine", gain: 0.05 }));
    },

    // Game over: four descending notes, the inverse of the tetris fanfare.
    playGameOver() {
      const notes = [659.25, 523.25, 392, 261.63]; // E5 C5 G4 C4
      let made = 0;
      notes.forEach((freq, i) => {
        made += count(audio.blip({
          freq,
          dur: 0.22,
          type: "sawtooth",
          gain: 0.08,
          when: i * 0.14,
        }));
      });
      return made;
    },

    // ---------- Mute ----------
    // Muting also drops the context reference: with mute on, nothing
    // should be scheduled and no new context should be built. An
    // already-open context is left to the GC rather than closed, because
    // closing and reopening on a toggle is worse than letting it idle.
    setMuted(flag) {
      audio.muted = flag === true;
      if (audio.muted) context = null;
      return audio.muted;
    },

    toggleMuted() {
      return audio.setMuted(!audio.muted);
    },
  };

  return audio;
}

// blip() returns a boolean; the composed sounds sum booleans into a count,
// which is the only shape a Node test can assert on.
function count(ok) {
  return ok ? 1 : 0;
}

// The real browser constructor, resolved only when a context is actually
// requested. In Node both globals are absent and this returns null, which
// createAudio treats as "audio unavailable".
function defaultContextFactory() {
  const Ctor = typeof globalThis !== "undefined"
    && (globalThis.AudioContext || globalThis.webkitAudioContext);
  return Ctor ? new Ctor() : null;
}

/* =========================================================
 *  Event mapping - the core stays ignorant of audio.
 *
 *  Which core event drives which sound, and why:
 *
 *  - `clear` with payload.type "tspin_full"/"tspin_mini" and
 *    payload.lines > 0 -> playTSpin (the chord), NOT the
 *    arpeggio: a T-spin is announced by its own sound.
 *  - `clear` with lines === 4 and no tspin -> playTetris.
 *  - `clear` with 1..3 lines and no tspin -> playClear(lines).
 *  - `clear` with lines === 0 -> no sound: the event also fires on
 *    every lock that clears nothing, which is exactly the `lock`
 *    tick. Firing the arpeggio there would ring on every drop.
 *
 *  The core has no `lock` and no `hardDrop` event: `clear` with
 *  lines === 0 IS the lock (the core emits it from lockPiece, both
 *  from the delayed lock and from the hard drop's immediate lock).
 *  Hard drop is distinguished from a soft lock in main.js, which
 *  knows the input that got there.
 * ========================================================= */
export function soundsForClear(payload = {}) {
  const lines = payload.lines | 0;
  const tspin = payload.tspin === true;

  // A T-spin that clears nothing is NOT a plain lock: the game announces
  // T-SPIN on screen and pays 400/100 for it, so it gets its own sound.
  // Letting it fall through to the lock tick made picture and sound disagree.
  if (tspin) return ["tspin"];
  if (lines >= 4) return ["tetris"];
  if (lines > 0) return ["clear"];
  return ["lock"];
}

// How many oscillators a sound name needs, using the same rules as the
// audio object. Exported so tests can assert the mapping without a mock.
export function oscillatorCountFor(sound) {
  switch (sound) {
    case "lock": return 1;
    case "clear": return 3;   // one line: the smallest arpeggio
    case "tetris": return 4;
    case "tspin": return 3;   // the chord
    case "levelup": return 1;
    case "harddrop": return 1;
    case "hold": return 1;
    case "gameover": return 4;
    default: return 0;
  }
}
