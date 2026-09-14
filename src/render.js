"use strict";

/* =========================================================
 *  Tetris renderer - canvas only. Wireframe language (v0.4).
 *
 *  Visual language "wireframe boxes": every cell is drawn as
 *  a colored outline with a barely-there fill, so shapes
 *  carry the information and color is the accent. The board
 *  floor is a faint dot grid (no lines). The ghost is dashed.
 *  The active piece glows while grounded, so the imminent
 *  lock is visible - a read-only signal from the state.
 *
 *  Draws whatever state it is handed. It never mutates the
 *  game state and never decides anything about the rules.
 * ========================================================= */

import { COLS, ROWS, CLEAR_FLASH_MS, LOCK_DELAY_MS, PIECES, cellsOf } from "./core.js";

export const CELL = 30;       // board cell size in px
export const PREVIEW_CELL = 16; // cell size used by hold/next previews

const DOT_ALPHA = 0.06;    // board floor dot intensity
const GHOST_DASH = [3, 4]; // dash pattern for the ghost outline
const STROKE_LOCKED = 1;   // settled cell outline width
const STROKE_ACTIVE = 2;   // active piece outline width
const FILL_ALPHA = 0.10;   // wireframe cell fill (barely there)

// ---------- Color helpers ----------
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgba(color, alpha) {
  const [r, g, b] = hexToRgb(color);
  return `rgba(${r},${g},${b},${alpha})`;
}

// A "cajita": outline of the piece color plus a faint fill. The
// stroke is inset by half its width so it stays inside the cell.
function drawCellWire(context, x, y, color, size, lineWidth = STROKE_LOCKED) {
  const px = x * size;
  const py = y * size;
  const inset = lineWidth / 2;
  context.fillStyle = rgba(color, FILL_ALPHA);
  context.fillRect(px, py, size, size);
  context.strokeStyle = rgba(color, 0.8);
  context.lineWidth = lineWidth;
  context.strokeRect(px + inset, py + inset, size - lineWidth, size - lineWidth);
}

// Draw a piece type centered inside a small preview canvas.
function drawPreview(context, target, type, size) {
  context.clearRect(0, 0, target.width, target.height);
  if (!type) return;
  const cells = cellsOf(PIECES[type].matrix);
  const minX = Math.min(...cells.map(([, c]) => c));
  const maxX = Math.max(...cells.map(([, c]) => c));
  const minY = Math.min(...cells.map(([r]) => r));
  const maxY = Math.max(...cells.map(([r]) => r));
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const offX = (target.width - w * size) / 2 - minX * size;
  const offY = (target.height - h * size) / 2 - minY * size;

  context.save();
  context.translate(offX, offY);
  for (const [r, c] of cells) drawCellWire(context, c, r, PIECES[type].color, size);
  context.restore();
}

/* =========================================================
 *  createRenderer({ canvas, nextCanvas, holdCanvas })
 * ========================================================= */
export function createRenderer({ canvas, nextCanvas, holdCanvas }) {
  const ctx = canvas.getContext("2d");
  const nextCtx = nextCanvas.getContext("2d");
  const holdCtx = holdCanvas.getContext("2d");

  function drawBoard(state) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Board floor: a faint dot grid at cell centers. Quieter than
    // the former grid lines, it reads as a piso under the pieces.
    ctx.fillStyle = `rgba(255,255,255,${DOT_ALPHA})`;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        ctx.beginPath();
        ctx.arc(c * CELL + CELL / 2, r * CELL + CELL / 2, 1, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Settled blocks.
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        if (state.board[r][c]) drawCellWire(ctx, c, r, state.board[r][c], CELL);

    // Line-clear flash: the completed rows pulse as a bright outline
    // that swells and fades (same ramp, same freezing clearing state).
    // The fill is only a glow support, never the old solid white.
    if (state.clearing) {
      const t = Math.min(1, state.clearing.timer / CLEAR_FLASH_MS);
      const pulse = Math.sin(Math.PI * t); // 0 -> 1 -> 0
      ctx.fillStyle = `rgba(255,255,255,${(0.05 * pulse).toFixed(3)})`;
      ctx.strokeStyle = `rgba(255,255,255,${(0.35 + 0.6 * pulse).toFixed(3)})`;
      ctx.lineWidth = 2.5;
      ctx.shadowColor = "rgba(255,255,255,0.9)";
      ctx.shadowBlur = 14 * pulse;
      for (const r of state.clearing.rows) {
        ctx.fillRect(0, r * CELL, COLS * CELL, CELL);
        ctx.strokeRect(1.25, r * CELL + 1.25, COLS * CELL - 2.5, CELL - 2.5);
      }
      ctx.shadowBlur = 0;
    }

    // No active piece while clearing or after game over.
    const cur = state.current;
    if (!state.gameOver && !state.clearing && cur) drawActivePiece(state, cur);
  }

  function drawActivePiece(state, cur) {
    // Ghost first, under the piece: dashed outline of a tenue color,
    // fill almost null. Same `gy !== cur.y` condition as before.
    const gy = ghostYFor(state, cur);
    if (gy !== cur.y) {
      ctx.save();
      ctx.fillStyle = rgba(cur.color, 0.04);
      ctx.strokeStyle = rgba(cur.color, 0.30);
      ctx.lineWidth = 1;
      ctx.setLineDash(GHOST_DASH);
      for (const [r, c] of cellsOf(cur.matrix)) {
        const px = (cur.x + c) * CELL;
        const py = (gy + r) * CELL;
        ctx.fillRect(px, py, CELL, CELL);
        ctx.strokeRect(px + 0.5, py + 0.5, CELL - 1, CELL - 1);
      }
      ctx.restore();
    }

    // Lock-imminent glow: while the piece is grounded, the lock timer
    // ticks toward LOCK_DELAY_MS; glow scales with that progress. It is
    // useful information (the piece is about to lock), not decoration.
    const groundedHere = collidesAt(state.board, cur.matrix, cur.x, cur.y + 1);
    const lockRatio = groundedHere ? Math.min(1, state.lockTimer / LOCK_DELAY_MS) : 0;

    if (lockRatio > 0) {
      ctx.save();
      ctx.shadowColor = cur.color;
      ctx.shadowBlur = 6 + 22 * lockRatio;
    }
    for (const [r, c] of cellsOf(cur.matrix)) {
      const by = cur.y + r;
      if (by >= 0) drawCellWire(ctx, cur.x + c, by, cur.color, CELL, STROKE_ACTIVE);
    }
    if (lockRatio > 0) ctx.restore();
  }

  function drawNext(state) {
    drawPreview(nextCtx, nextCanvas, state.nextType, PREVIEW_CELL);
  }

  // The reserved piece is dimmed while the hold slot is spent.
  function drawHold(state) {
    holdCtx.clearRect(0, 0, holdCanvas.width, holdCanvas.height);
    if (!state.holdType) return;
    holdCtx.globalAlpha = state.holdUsed ? 0.28 : 1;
    drawPreview(holdCtx, holdCanvas, state.holdType, PREVIEW_CELL);
    holdCtx.globalAlpha = 1;
  }

  function draw(state) {
    drawBoard(state);
    drawNext(state);
    drawHold(state);
  }

  return { draw, drawBoard, drawNext, drawHold };
}

// Local ghost calculation so the renderer stays free of core internals.
function ghostYFor(state, cur) {
  let y = cur.y;
  while (!collidesAt(state.board, cur.matrix, cur.x, y + 1)) y++;
  return y;
}

function collidesAt(board, matrix, x, y) {
  for (const [r, c] of cellsOf(matrix)) {
    const bx = x + c;
    const by = y + r;
    if (bx < 0 || bx >= COLS || by >= ROWS) return true;
    if (by >= 0 && board[by][bx]) return true;
  }
  return false;
}
