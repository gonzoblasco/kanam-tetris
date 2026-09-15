"use strict";

/* =========================================================
 *  Audio engine tests - node:test, zero dependencies.
 *  Run with: node --test test/
 *
 *  There is no browser here, and none is needed: audio.js takes
 *  its AudioContext factory by injection (the same seam as
 *  `rng` in the core and `blurTarget` in input.js). The mock
 *  below records every oscillator and every scheduled value, so
 *  the shape of each sound is asserted as data.
 *
 *  What these tests CANNOT check: that it sounds good. Timbre is
 *  not measurable from Node. They pin the contract - how many
 *  oscillators, which frequencies, when, and that silence means
 *  silence.
 * ========================================================= */

import test from "node:test";
import assert from "node:assert/strict";
import { createAudio, soundsForClear, oscillatorCountFor } from "../src/audio.js";

// A recording AudioContext. Every node it hands out is kept so tests
// can inspect what was scheduled.
function makeMockContext() {
  const oscillators = [];
  const gains = [];
  const started = [];
  let resumed = 0;

  const ctx = {
    currentTime: 0,
    destination: { name: "destination" },
    state: "running",
    oscillators,
    gains,
    started,
    get resumeCount() { return resumed; },
    resume() { resumed++; return Promise.resolve(); },
    close() { ctx.state = "closed"; return Promise.resolve(); },
    createGain() {
      const gain = {
        gain: {
          values: [],
          setValueAtTime(v, t) { this.values.push({ kind: "set", v, t }); },
          exponentialRampToValueAtTime(v, t) {
            if (v === 0) throw new Error("exponential ramp to 0 is illegal");
            this.values.push({ kind: "exp", v, t });
          },
          linearRampToValueAtTime(v, t) { this.values.push({ kind: "lin", v, t }); },
          cancelScheduledValues() {},
        },
        connect() {},
        disconnect() {},
      };
      gains.push(gain);
      return gain;
    },
    createOscillator() {
      const osc = {
        type: "",
        frequency: {
          values: [],
          setValueAtTime(v, t) { this.values.push({ kind: "set", v, t }); },
          linearRampToValueAtTime(v, t) { this.values.push({ kind: "lin", v, t }); },
          exponentialRampToValueAtTime(v, t) {
            this.values.push({ kind: "exp", v, t });
          },
        },
        started: false,
        stopped: false,
        connect() {},
        disconnect() {},
        start(t) { this.started = true; started.push({ osc: this, t }); },
        stop(t) { this.stopped = true; this.stopTime = t; },
      };
      oscillators.push(osc);
      return osc;
    },
    createBiquadFilter() {
      return {
        type: "",
        frequency: { setValueAtTime() {} },
        connect() {},
        disconnect() {},
      };
    },
  };
  return ctx;
}

// Audio engine over a fresh mock. Returns both.
function makeAudio(opts = {}) {
  const ctx = makeMockContext();
  const audio = createAudio({ contextFactory: () => ctx, ...opts });
  return { ctx, audio };
}

/* =========================================================
 *  Lazy context: nothing is created until a gesture.
 * ========================================================= */
test("audio: the context is not created at construction time", () => {
  let built = 0;
  const audio = createAudio({ contextFactory: () => { built++; return makeMockContext(); } });
  assert.equal(built, 0, "building the engine must not touch AudioContext");
  assert.equal(audio.hasContext(), false, "and no context is held");
});

test("audio: the context is created on the first gesture, not before", () => {
  let built = 0;
  const audio = createAudio({ contextFactory: () => { built++; return makeMockContext(); } });

  assert.equal(built, 0, "precondition: nothing built yet");
  const ctx = audio.ensureContext(true); // first user input

  assert.equal(built, 1, "the first gesture builds exactly one context");
  assert.ok(ctx, "and hands it back");
  assert.equal(audio.hasContext(), true);
});

test("audio: the context is created once, then reused", () => {
  let built = 0;
  const audio = createAudio({ contextFactory: () => { built++; return makeMockContext(); } });
  audio.ensureContext(true);
  audio.ensureContext(true);
  audio.ensureContext(true);
  assert.equal(built, 1, "a second gesture must not build a second context");
});

test("audio: resume is asked for on a gesture", () => {
  const { ctx, audio } = makeAudio();
  audio.ensureContext(true);
  assert.equal(ctx.resumeCount, 1, "a suspended context is resumed on the gesture");
});

/* =========================================================
 *  blip: the primitive.
 * ========================================================= */
test("audio: blip schedules one oscillator with an envelope", () => {
  const { ctx, audio } = makeAudio();
  audio.ensureContext(true);
  const ok = audio.blip({ freq: 440, dur: 0.1, type: "square", gain: 0.08 });

  assert.equal(ok, true, "the blip reported success");
  assert.equal(ctx.oscillators.length, 1, "one oscillator");
  // The engine also builds its shared music bus when the master filter is
  // created, so a blip may see 2 gain nodes total: the note's own envelope
  // plus the bus. The note itself always contributes exactly one oscillator.
  assert.ok(ctx.gains.length >= 1, "at least the note's own envelope gain");
  assert.equal(ctx.started.length, 1, "and it was started");
  assert.equal(ctx.oscillators[0].type, "square");
  assert.equal(ctx.oscillators[0].frequency.values[0].v, 440);
  assert.equal(ctx.oscillators[0].stopped, true, "it is stopped again (no leak)");
});

test("audio: blip schedules the note `when` seconds into the future", () => {
  const { ctx, audio } = makeAudio();
  ctx.currentTime = 10;
  audio.ensureContext(true);
  audio.blip({ freq: 440, dur: 0.1, when: 0.25 });
  assert.equal(ctx.oscillators[0].frequency.values[0].t, 10.25,
    "the frequency is set at currentTime + when");
});

test("audio: a [from, to] frequency is a sweep", () => {
  const { ctx, audio } = makeAudio();
  audio.ensureContext(true);
  audio.blip({ freq: [200, 800], dur: 0.3 });
  const values = ctx.oscillators[0].frequency.values;
  assert.equal(values[0].v, 200, "it starts at the first frequency");
  assert.ok(values.some((v) => v.kind === "exp" && v.v === 800),
    "and ramps to the second one");
});

test("audio: blip never reaches a zero gain (exponential ramps reject 0)", () => {
  const { ctx, audio } = makeAudio();
  audio.ensureContext(true);
  // The mock throws if an exponential ramp targets 0; the call must survive.
  assert.doesNotThrow(() => audio.blip({ freq: 440, dur: 0.1, gain: 0 }));
  assert.equal(ctx.oscillators.length, 1, "the note still scheduled");
});

/* =========================================================
 *  Each event sound has the expected shape.
 *  The counts come from oscillatorCountFor, so the test pins the
 *  mapping AND the implementation together.
 * ========================================================= */
test("audio: lock is a single short tick", () => {
  const { ctx, audio } = makeAudio();
  audio.ensureContext(true);
  const made = audio.playLock();
  assert.equal(made, oscillatorCountFor("lock"));
  assert.equal(ctx.oscillators.length, 1, "one oscillator for a lock");
});

test("audio: the clear arpeggio climbs with the line count", () => {
  const { ctx, audio } = makeAudio();
  audio.ensureContext(true);

  audio.playClear(1);
  const single = ctx.oscillators.length;
  audio.playClear(3);
  const triple = ctx.oscillators.length - single;

  assert.ok(triple > single, `3 lines must schedule more notes than 1 (${triple} vs ${single})`);
});

test("audio: tetris is a four-note fanfare", () => {
  const { ctx, audio } = makeAudio();
  audio.ensureContext(true);
  const made = audio.playTetris();
  assert.equal(made, 4, "four notes");
  assert.equal(ctx.oscillators.length, 4);
  // The notes must be distinct: a repeated frequency is not a fanfare.
  const freqs = ctx.oscillators.map((o) => o.frequency.values[0].v);
  assert.equal(new Set(freqs).size, 4, "four different notes");
});

test("audio: the T-spin chord is a simultaneous stack, not an arpeggio", () => {
  const { ctx, audio } = makeAudio();
  audio.ensureContext(true);
  const made = audio.playTSpin();

  assert.equal(made, 3, "a three-note chord");
  const times = ctx.oscillators.map((o) => o.frequency.values[0].t);
  assert.equal(new Set(times).size, 1, "every note starts at the same instant");
});

test("audio: the T-spin chord differs from the clear arpeggio", () => {
  const a = makeAudio();
  a.audio.ensureContext(true);
  a.audio.playTSpin();
  const chord = a.ctx.oscillators.map((o) => o.type);

  const b = makeAudio();
  b.audio.ensureContext(true);
  b.audio.playClear(3);
  const arpeggio = b.ctx.oscillators.map((o) => o.type);

  assert.notDeepEqual(chord, arpeggio, "the two events must not sound alike");
});

test("audio: level up is a sweep and hard drop is a thud", () => {
  const { ctx, audio } = makeAudio();
  audio.ensureContext(true);

  audio.playLevelUp();
  const sweep = ctx.oscillators[ctx.oscillators.length - 1].frequency.values;
  assert.ok(sweep.some((v) => v.kind === "exp"), "level up sweeps");

  audio.playHardDrop();
  const thud = ctx.oscillators[ctx.oscillators.length - 1];
  assert.ok(thud.frequency.values[0].v < 120, "the hard drop is a low note");
});

test("audio: game over descends", () => {
  const { ctx, audio } = makeAudio();
  audio.ensureContext(true);
  const made = audio.playGameOver();

  assert.equal(made, 4, "four notes");
  const freqs = ctx.oscillators.map((o) => o.frequency.values[0].v);
  assert.ok(freqs[0] > freqs[freqs.length - 1],
    "the sequence must end lower than it started");
});

/* =========================================================
 *  Mute.
 * ========================================================= */
test("audio: with mute on, nothing is scheduled and no context is built", () => {
  let built = 0;
  const audio = createAudio({
    contextFactory: () => { built++; return makeMockContext(); },
    muted: true,
  });

  assert.equal(audio.playLock(), 0, "the lock is silent");
  assert.equal(audio.playTetris(), 0, "the tetris is silent");
  assert.equal(audio.playGameOver(), 0, "game over is silent");
  assert.equal(audio.playTSpin(), 0);
  assert.equal(audio.playClear(3), 0);
  assert.equal(built, 0, "and the AudioContext is never even created");
  assert.equal(audio.hasContext(), false);
});

test("audio: toggling mute silences and unsilences", () => {
  const { ctx, audio } = makeAudio();
  audio.ensureContext(true);
  assert.equal(audio.playLock(), 1, "audible to start with");

  audio.toggleMuted();
  assert.equal(audio.muted, true);
  assert.equal(audio.playLock(), 0, "silent while muted");

  audio.toggleMuted();
  assert.equal(audio.muted, false);
  assert.equal(audio.playLock(), 1, "audible again after unmute");
  assert.ok(ctx.oscillators.length >= 2);
});

test("audio: muting drops the held context, and unmuting builds a fresh one", () => {
  let built = 0;
  const audio = createAudio({ contextFactory: () => { built++; return makeMockContext(); } });
  audio.ensureContext(true);
  assert.equal(built, 1);

  audio.setMuted(true);
  assert.equal(audio.hasContext(), false, "the reference is dropped while muted");

  audio.setMuted(false);
  audio.ensureContext(true);
  assert.equal(built, 2, "unmuting rebuilds a context on the next gesture");
});

/* =========================================================
 *  Robustness: audio must never break the game.
 * ========================================================= */
test("audio: no AudioContext available means silence, not a crash", () => {
  // The default factory in Node finds no constructor.
  const audio = createAudio();
  assert.doesNotThrow(() => audio.ensureContext(true));
  assert.equal(audio.hasContext(), false, "there is no context to hold");
  assert.equal(audio.playLock(), 0, "and the sounds are no-ops");
  assert.equal(audio.playTetris(), 0);
});

test("audio: a factory that throws is survivable", () => {
  const audio = createAudio({
    contextFactory: () => { throw new Error("blocked by policy"); },
  });
  assert.doesNotThrow(() => audio.ensureContext(true));
  assert.equal(audio.playLock(), 0, "the game keeps running in silence");
  assert.equal(audio.hasContext(), false);
});

test("audio: a node that throws mid-blip does not propagate", () => {
  const ctx = makeMockContext();
  ctx.createOscillator = () => { throw new Error("too many nodes"); };
  const audio = createAudio({ contextFactory: () => ctx });
  audio.ensureContext(true);
  assert.doesNotThrow(() => audio.blip({ freq: 440 }));
  assert.doesNotThrow(() => audio.playTetris());
});

/* =========================================================
 *  Event mapping: core events -> sounds.
 * ========================================================= */
test("audio: a lock is the clear event with zero lines", () => {
  assert.deepEqual(soundsForClear({ lines: 0, tspin: false }), ["lock"]);
});

test("audio: 1 to 3 lines pick the arpeggio, 4 pick the fanfare", () => {
  assert.deepEqual(soundsForClear({ lines: 1 }), ["clear"]);
  assert.deepEqual(soundsForClear({ lines: 3 }), ["clear"]);
  assert.deepEqual(soundsForClear({ lines: 4 }), ["tetris"]);
});

test("audio: a T-spin with lines gets its own sound, never the arpeggio", () => {
  assert.deepEqual(soundsForClear({ lines: 1, tspin: true }), ["tspin"]);
  assert.deepEqual(soundsForClear({ lines: 2, tspin: true, type: "tspin_full" }), ["tspin"]);
  assert.deepEqual(soundsForClear({ lines: 1, tspin: true, type: "tspin_mini" }), ["tspin"]);
});

test("audio: a T-spin that clears nothing still gets the chord, not the lock tick", () => {
  // The core pays for it (400 full / 100 mini) and the UI announces T-SPIN,
  // so a plain lock tick would make picture and sound disagree.
  assert.deepEqual(soundsForClear({ lines: 0, tspin: true }), ["tspin"]);
  assert.deepEqual(soundsForClear({ lines: 0, tspin: true, type: "tspin_mini" }), ["tspin"]);
});

test("audio: a tetris T-spin is impossible, so the chord wins if it happens", () => {
  // Defensive: if the core ever reported both, the rarer event must win.
  assert.deepEqual(soundsForClear({ lines: 4, tspin: true }), ["tspin"]);
});
