# kanam-tetris

Tetris clásico en JavaScript vanilla, sin dependencias y sin build. Proyecto-experimento del pipeline de agentes: escritos, revisados y corregidos por agentes A/B (Claude Code via gateway Ollama), con revisión final y validación en browser de Kanam/Gonzo.

Desde v0.3 el juego es un conjunto de módulos ES (`src/`) con el core de simulación puro y separado del browser. Esa separación es lo que permite testear sin abrir nada.

## Jugarlo

Los módulos ES no cargan sobre `file://` (el browser bloquea los imports por CORS). Hay que servirlo por HTTP:

```sh
python3 -m http.server 8000
```

Después abrir <http://localhost:8000>.

| Tecla | Acción |
|---|---|
| ← → | mover pieza |
| ↓ | caída suave |
| ↑ | rotar |
| Espacio | hard drop |
| C | hold (reserva) |
| P / Esc | pausa |

## Correr los tests

Runner nativo de Node, cero dependencias:

```sh
node --test test/     # o: npm test
```

Los tests cubren el core puro: bloqueo de input durante el flash de limpieza, wall kicks CW/CCW en ambas series (normal e I), lock delay con cap de 15 resets, hold, high score y DAS/ARR. Y el cableado del browser que el core no puede ver: que `blur` se registre en `window` y no en `document`, con la regresión del DAS al perder foco.

## Estructura

```
index.html        markup + CSS + <script type="module" src="src/main.js">
src/core.js       estado + simulación. Puro: sin DOM, sin canvas, sin reloj
src/render.js     canvas: dibuja el estado que le pasa el core
src/input.js      teclado -> intenciones (move/rotate/drop/hold/pause)
src/storage.js    localStorage con try/catch (high score)
src/main.js       loop: delta -> core.step() -> render
test/harness.js   helpers: tablero desde string, pieza forzada, bolsa forzada
test/core.test.js reglas del core con node:test nativo
test/input.test.js cableado del browser (blur en window, DAS al perder foco)
```

### Contrato del core

`src/core.js` no sabe que existe un browser: nada de DOM, canvas, `requestAnimationFrame`, `performance.now()` ni `localStorage`. El llamador es dueño del reloj y le pasa `step(deltaMs)`; el core es dueño de las reglas. `createGame(options)` acepta `rng` inyectable para forzar la bolsa de 7 piezas en los tests. `step()` es determinista: mismo estado + mismo delta, mismo resultado.

El core no persiste nada: expone el high score como valor y `storage.js` lo escribe, una sola vez, cuando la partida termina.

## Estado

- **v0.1** (minimal jugable): tablero 10x20, 7 tetrominós, rotación SRS con wall kicks, ghost piece, hard drop, líneas + puntaje + niveles, next piece, game over/reinicio.
- **v0.2** (2026-09-11): hold piece, lock delay con cap de 15 resets, DAS 170ms / ARR 50ms, flash de 180ms al limpiar líneas, pausa, high score persistente en localStorage.
- **v0.3** (2026-09-11): refactor estructural sin features nuevas. El single-file de 901 líneas se parte en módulos ES, el core queda puro y testeable, y aparece la red de tests con `node --test` (33 en total, con prueba de mutación). Comportamiento observable idéntico a v0.2.

### Nota sobre `blur` y el DAS

El handler de pérdida de foco se registra en `window`, no en `document`: `blur` no burbujea y el foco de ventana se dispara en `window`. Si se registra en `document` (como pasó en una iteración del refactor), el handler nunca corre y una flecha apretada deja el DAS vivo al salir de la ventana con Cmd+Tab, así que la pieza sigue deslizándose al volver. `attachInput` acepta `blurTarget` inyectable justamente para que esa costura sea testeable en Node sin browser (ver `test/input.test.js`).

Roadmap vivo y hallazgos de cada ciclo en `.knowledge/BRIEF.md` (T-spins, combos, sonido, multiplayer y móvil quedan para próximas iteraciones).

## Motor de los agentes

- v0.1: GLM 5.3 Flash (gateway Ollama `127.0.0.1:11435`).
- v0.2 y v0.3: `deepseek-v4.1-flash:cloud` (gateway Ollama `127.0.0.1:11434`).
