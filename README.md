# kanam-tetris

Tetris clásico en un solo archivo HTML (sin build, sin dependencias). Proyecto-experimento del pipeline de agentes: escritos, revisados y corregidos por agentes A/B (Claude Code via gateway Ollama), con revisión final y validación en browser de Kanam/Gonzo.

## Jugarlo

Abrir `index.html` en el browser. Listo.

| Tecla | Acción |
|---|---|
| ← → | mover pieza |
| ↓ | caída suave |
| ↑ | rotar |
| Espacio | hard drop |
| C | hold (reserva) |
| P / Esc | pausa |

## Estado

- **v0.1** (minimal jugable): tablero 10x20, 7 tetrominós, rotación SRS con wall kicks, ghost piece, hard drop, líneas + puntaje + niveles, next piece, game over/reinicio.
- **v0.2** (2026-09-11): hold piece, lock delay con cap de 15 resets, DAS 170ms / ARR 50ms, flash de 180ms al limpiar líneas, pausa, high score persistente en localStorage.

Roadmap vivo y hallazgos de cada ciclo en `.knowledge/BRIEF.md` (T-spins, combos, sonido, multiplayer y móvil quedan para próximas iteraciones).

## Motor de los agentes

- v0.1: GLM 5.3 Flash (gateway Ollama `127.0.0.1:11435`).
- v0.2: `deepseek-v4.1-flash:cloud` (gateway Ollama `127.0.0.1:11434`).
