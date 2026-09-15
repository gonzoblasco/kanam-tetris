"use strict";

/* =========================================================
 *  Sound engine - Web Audio, synthesized, zero assets.
 *
 *  Every sound is an oscillator plus a gain envelope, shaped
 *  by ADSR. There is not a single audio file in the project;
 *  even the background music (Korobeiniki, the Game Boy
 *  Tetris theme) is a note table sequenced through the same
 *  oscillators.
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
 *
 *  Timbral choices (v0.5.1, tuned after Gonzo called the
 *  default square waves "desesperantes"):
 *  - Every note routes through a shared low-pass filter, so
 *    the sharp edges of square/sawtooth waves stop hurting.
 *  - Envelopes use a tiny attack (click-free) and a musical
 *    exponential release, instead of a near-square gate.
 *  - The Game Boy aesthetic is kept: triangle lead for the
 *    melody, a square/pulse underneath for body, but both
 *    filtered and quieter than the raw game used.
 * ========================================================= */

/* Melody: Korobeiniki (the Game Boy Tetris theme). Frequencies in Hz,
 * durations in seconds. 0 = eighth, 0.16 = dotted eighth, 0 = the
 * classic rhythm. Rests use freq 0. The full A theme fits in one table.
 */
const KOROBEINIKI = {
  // [freq, seconds] pairs. Rests are [0, n].
  notes: [
    659.25, 659.25, 0, 659.25, 0,
    523.25, 659.25, 783.99, 0, 440,
    0, 523.25, 0, 0, 659.25, 0, 783.99,
    0, 880, 0, 783.99, 659.25, 0, 523.25, 0, 587.33,
    0, 523.25, 0, 440, 0, 440, 0, 523.25,
    0, 659.25, 0, 783.99, 0, 880, 0, 783.99, 0, 659.25,
    0, 523.25, 0, 587.33, 0, 392, 0, 440, 0,
  ],
  durations: [
    0.16, 0.16, 0.08, 0.16, 0.08,
    0.16, 0.16, 0.16, 0.08, 0.24,
    0.08, 0.16, 0.08, 0.08, 0.16, 0.08, 0.16,
    0.08, 0.24, 0.08, 0.16, 0.16, 0.08, 0.16, 0.08, 0.24,
    0.08, 0.16, 0.08, 0.24, 0.08, 0.16, 0.08, 0.24,
    0.08, 0.16, 0.08, 0.24, 0.08, 0.24, 0.08, 0.16,
    0.08, 0.24, 0.08, 0.16, 0.08, 0.24, 0.08, 0.24, 0.08,
  ],
};

// One loop of the theme, in seconds (used to keep the next loop tight).
const KOROBEINIKI_LOOP_S = KOROBEINIKI.durations.reduce((s, d) => s + d, 0);

/* =========================================================
 *  createAudio({ contextFactory, muted, music })
 *
 *  contextFactory: () => AudioContext-like.
 *  muted: initial mute state.
 *  music: boolean, start background music on first gesture.
 *    (off by default so the game is calm until the player
 *    chooses it; toggled with the M key cycle: off -> sfx ->
 *    sfx+music.)
 * ========================================================= */
export function createAudio({ contextFactory, muted = false, music = false } = {}) {
  const factory = contextFactory ?? defaultContextFactory;

  let context = null;   // created on first user gesture, never before
  let contextFailed = false;
  let musicGain = null;   // per-loop gain of the music channel
  let musicTimer = null;  // handle to cancel the loop

  const audio = {
    muted: muted === true,
    musicOn: music === true,

    // Build the AudioContext on demand.
    ensureContext(gesture = false) {
      if (audio.muted) return null;
      if (context) {
        if (gesture) this._resumeSoftly();
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
      this._resumeSoftly();
      // The shared filter tames the square/sawtooth edges; without it the
      // "desesperante" sharpness returns.
      this._masterFilter = context.createBiquadFilter();
      this._masterFilter.type = "lowpass";
      this._masterFilter.frequency.setValueAtTime(2400, context.currentTime);
      this._masterFilter.connect(context.destination);
      // The music channel feeds the same filter, so the melody and the
      // effects share one warm finish.
      this._musicGainBus = context.createGain();
      this._musicGainBus.gain.setValueAtTime(0, context.currentTime);
      this._musicGainBus.connect(this._masterFilter);
      return context;
    },

    hasContext() {
      return context !== null;
    },

    // The Autoplay policy leaves a fresh context suspended until a trusted
    // gesture. This returns the live state so the UI can tell the player
    // "audio woke" vs "still suspended" instead of failing silently.
    contextState() {
      if (!context) return "none";
      const s = typeof context.state === "function" ? context.state() : context.state;
      return typeof s === "string" && s.length ? s : "unknown";
    },

    // A context born suspended only starts once resume() runs from inside a
    // trusted gesture. This polls: if it is still suspended one event loop
    // later, it has not been woken and the UI should know.
    isRunning() {
      return audio.contextState() === "running";
    },

    _resumeSoftly() {
      if (typeof context.resume !== "function") return;
      try {
        const p = context.resume();
        if (p && typeof p.catch === "function") {
          p.catch(() => {});
        } else if (typeof p === "boolean" && p === false) {
          // A stale spec returned a boolean; leave it and retry later.
        }
      } catch (e) {
        /* ignore */
      }
    },

    // The Autoplay policy leaves a fresh context suspended until a trusted
    // user gesture. `resume()` returns a promise that only becomes pending
    // once a trusted gesture happens; a stale/non-trusted one rejects
    // immediately. So the correct loop is: on every gesture, while the
    // context is still suspended, call resume() again. The first trusted
    // gesture that comes along wins.
    wakeAudio(gesture) {
      const ctx = audio.ensureContext(gesture);
      if (!ctx) return false;
      if (audio.contextState() === "running") return true;
      audio._resumeSoftly();
      return audio.contextState() === "running";
    },

    // ---------- Primitive ----------
    // One scheduled note. `freq` may be a number or a [from, to] sweep.
    // Route: osc -> (own envelope) -> music bus OR master filter. SFX go
    // straight to the filter; the music channel goes through musicGain.
    blip({ freq, dur = 0.12, type = "square", gain = 0.08, when = 0, toMusic = false } = {}) {
      const ctx = audio.ensureContext(false);
      if (!ctx) return false;
      try {
        const now = ctx.currentTime + when;
        const end = now + dur;

        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        osc.type = type;
        const isSweep = Array.isArray(freq);
        osc.frequency.setValueAtTime(isSweep ? freq[0] : freq, now);
        if (isSweep && freq.length > 1) {
          osc.frequency.exponentialRampToValueAtTime(Math.max(1, freq[1]), end);
        }

        // A short, click-free attack, then a musical exponential release.
        const attack = Math.min(0.02, dur * 0.15);
        env.gain.setValueAtTime(0.0001, now);
        env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), now + attack);
        env.gain.exponentialRampToValueAtTime(0.0001, end);

        osc.connect(env);
        // Music notes go to the music bus; SFX go to the shared master filter.
        const dest = toMusic ? (audio._musicGainBus || ctx.destination) : (audio._masterFilter || ctx.destination);
        env.connect(dest);
        osc.start(now);
        osc.stop(end + 0.02);
        return true;
      } catch (e) {
        return false;
      }
    },

    // ---------- Music loop (Korobeiniki) ----------
    // Schedules the whole theme with one `when` offset, then re-schedules
    // on a timeout so the loop breathes at the right tempo. SFX never touch
    // the music timer, so they cannot cut the melody.
    startMusic() {
      if (!audio.musicOn || audio.muted) return;
      const ctx = audio.ensureContext(false);
      if (!ctx) return;
      audio.stopMusic();
      audio._musicBusGainUp();
      const t0 = ctx.currentTime + 0.05;
      KOROBEINIKI.notes.forEach((freq, i) => {
        if (freq === 0) return; // rest
        audio.blip({
          freq,
          dur: KOROBEINIKI.durations[i],
          type: "triangle",
          gain: 0.05,
          when: t0 - ctx.currentTime + i * 0,
          toMusic: true,
        });
      });
      // Re-arm the next loop.
      const loopMs = KOROBEINIKI_LOOP_S * 1000;
      musicTimer = setTimeout(() => audio.startMusic(), loopMs);
    },

    _musicBusGainUp() {
      if (!audio._musicGainBus) return;
      try {
        const now = audio._musicGainBus.context.currentTime;
        audio._musicGainBus.gain.cancelScheduledValues(now);
        audio._musicGainBus.gain.setValueAtTime(0.05, now);
        audio._musicGainBus.gain.linearRampToValueAtTime(0.05, now + 0.4);
      } catch (e) {
        /* ignore */
      }
    },

    stopMusic() {
      if (musicTimer) { clearTimeout(musicTimer); musicTimer = null; }
      if (audio._musicGainBus) {
        try { audio._musicGainBus.gain.setValueAtTime(0, audio._musicGainBus.context.currentTime); }
        catch (e) { /* ignore */ }
      }
    },

    // ---------- Composed sounds ----------
    playLock() {
      return count(audio.blip({ freq: 110, dur: 0.12, type: "square", gain: 0.05 }));
    },

    playClear(lines = 1) {
      const n = Math.max(1, Math.min(3, lines | 0));
      const root = 330;
      let made = 0;
      for (let i = 0; i < n + 1; i++) {
        made += count(audio.blip({
          freq: root * Math.pow(2, i / 12 * 2),
          dur: 0.1,
          type: "triangle",
          gain: 0.06,
          when: i * 0.07,
        }));
      }
      return made;
    },

    playTetris() {
      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
      let made = 0;
      notes.forEach((freq, i) => {
        made += count(audio.blip({
          freq,
          dur: 0.14,
          type: "square",
          gain: 0.07,
          when: i * 0.09,
        }));
      });
      return made;
    },

    playTSpin() {
      const chord = [392, 466.16, 587.33];
      let made = 0;
      for (const freq of chord) {
        made += count(audio.blip({ freq, dur: 0.22, type: "sawtooth", gain: 0.05 }));
      }
      return made;
    },

    playLevelUp() {
      return count(audio.blip({ freq: [220, 880], dur: 0.35, type: "triangle", gain: 0.07 }));
    },

    playHardDrop() {
      return count(audio.blip({ freq: 82, dur: 0.09, type: "sine", gain: 0.08 }));
    },

    playHold() {
      return count(audio.blip({ freq: 587.33, dur: 0.07, type: "sine", gain: 0.04 }));
    },

    playGameOver() {
      const notes = [659.25, 523.25, 392, 261.63];
      let made = 0;
      notes.forEach((freq, i) => {
        made += count(audio.blip({
          freq,
          dur: 0.22,
          type: "triangle",
          gain: 0.06,
          when: i * 0.14,
        }));
      });
      return made;
    },

    // ---------- Mute / music ----------
    setMuted(flag) {
      audio.muted = flag === true;
      if (audio.muted) {
        // Muting silences everything: the music loop dies with the context
        // reference, and the music flag clears so a later unmute does not
        // resurrect the melody behind the player's back.
        audio.stopMusic();
        audio.musicOn = false;
        context = null;
      }
      return audio.muted;
    },

    toggleMuted() {
      return audio.setMuted(!audio.muted);
    },

    setMusic(on) {
      audio.musicOn = on === true;
      if (audio.musicOn) {
        // If the context is up, start the loop; otherwise it kicks in on
        // the next gesture.
        if (context) audio.startMusic();
      } else {
        audio.stopMusic();
      }
      return audio.musicOn;
    },
  };

  return audio;
}

function count(ok) {
  return ok ? 1 : 0;
}

function defaultContextFactory() {
  const Ctor = typeof globalThis !== "undefined"
    && (globalThis.AudioContext || globalThis.webkitAudioContext);
  return Ctor ? new Ctor() : null;
}

/* =========================================================
 *  Event mapping - the core stays ignorant of audio.
 *  (unchanged from v0.5)
 * ========================================================= */
export function soundsForClear(payload = {}) {
  const lines = payload.lines | 0;
  const tspin = payload.tspin === true;
  if (tspin) return ["tspin"];
  if (lines >= 4) return ["tetris"];
  if (lines > 0) return ["clear"];
  return ["lock"];
}

export function oscillatorCountFor(sound) {
  switch (sound) {
    case "lock": return 1;
    case "clear": return 3;
    case "tetris": return 4;
    case "tspin": return 3;
    case "levelup": return 1;
    case "harddrop": return 1;
    case "hold": return 1;
    case "gameover": return 4;
    default: return 0;
  }
}
