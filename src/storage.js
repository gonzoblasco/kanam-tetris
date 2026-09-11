"use strict";

/* =========================================================
 *  High-score persistence.
 *
 *  localStorage can throw (private mode, sandboxed frames),
 *  so every access is guarded and the game never goes down
 *  because of it.
 * ========================================================= */

export const HIGH_SCORE_KEY = "tetris.highscore";

export function loadHighScore() {
  try {
    const stored = parseInt(localStorage.getItem(HIGH_SCORE_KEY), 10);
    return Number.isFinite(stored) && stored > 0 ? stored : 0;
  } catch (e) {
    return 0;
  }
}

export function saveHighScore(value) {
  try {
    localStorage.setItem(HIGH_SCORE_KEY, String(value));
  } catch (e) {
    /* storage unavailable - keep the in-memory record only */
  }
}
