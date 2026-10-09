# kanam-tetris

Tetris clásico en JavaScript vanilla, **sin dependencias y sin build**. Proyecto-experimento del pipeline de agentes: escrito, revisado y corregido por agentes A/B, con revisión final y validación en browser de Kanam/Gonzo.

Desde v0.3 el juego es un conjunto de módulos ES (`src/`) con el core de simulación **puro** y separado del browser. Esa separación es lo que permite testear sin abrir nada: 123 tests, cero dependencias, `node --test` nativo.

> **Estado verificado el 2026-10-08.** Este README se reescribió midiendo el repositorio (tests corridos, código inspeccionado), no leyendo el README anterior. La versión anterior declaraba v0.3 y 33 tests; el proyecto estaba en v0.5.1 con 123 tests. Un documento que se declara "vivo" y nadie verifica miente solo.

## Jugarlo

Los módulos ES no cargan sobre `file://` (el browser bloquea los imports por CORS). Hay que servirlo por HTTP:

```sh
python3 -m http.server 8000   # o: python3 serve.py
```

Después abrir <http://localhost:8000>.

| Tecla | Acción |
|---|---|
| ← → | mover pieza (DAS 170ms / ARR 50ms) |
| ↓ | caída suave |
| ↑ | rotar |
| Espacio | hard drop |
| C | hold (reserva) |
| P / Esc | pausa |
| M | ciclo de audio: SFX → SFX+music → mute |
| Enter | reiniciar (solo en game over) |

## Correr los tests

Runner nativo de Node, cero dependencias:

```sh
node --test test/     # o: npm test
```

**123 tests, 123 pasando, 0 fallando** (medido 2026-10-08). Distribución por suite:

| Suite | Tests | Cubre |
|---|---|---|
| `test/core.test.js` | 29 | reglas del core puro |
| `test/scoring.test.js` | 29 | T-spins, combos, B2B, cola de 5 piezas |
| `test/audio.test.js` | 26 | motor de audio con mock de `AudioContext` |
| `test/dom.test.js` | 18 | cableado del browser (HUD, overlays, mute, loop) |
| `test/effects.test.js` | 17 | screen shake y partículas |
| `test/input.test.js` | 4 | teclado → intenciones, `blur` en `window`, DAS al perder foco |

## Estructura

```
index.html        markup + CSS + <script type="module" src="src/main.js">
serve.py          server HTTP sin caché (dev, v0.5.1)
src/core.js       estado + simulación. Puro: sin DOM, sin canvas, sin reloj
src/render.js     canvas: dibuja el estado que le pasa el core
src/input.js      teclado -> intenciones (move/rotate/drop/hold/pause/mute)
src/storage.js    localStorage con try/catch (high score, preferencia de mute)
src/audio.js      motor de audio (Web Audio, sintetizado, cero assets)
src/effects.js    screen shake + partículas (game feel)
src/main.js       loop: delta -> core.step() -> render; cablea todo
test/harness.js   helpers: tablero desde string, pieza forzada, bolsa forzada
```

### Contrato del core

`src/core.js` **no sabe que existe un browser**: nada de DOM, canvas, `requestAnimationFrame`, `performance.now()` ni `localStorage` (verificado por inspección, 2026-10-08). El llamador es dueño del reloj y le pasa `step(deltaMs)`; el core es dueño de las reglas. `createGame(options)` acepta `rng` inyectable para forzar la bolsa de 7 piezas en los tests. `step()` es determinista: mismo estado + mismo delta, mismo resultado.

El core no persiste nada: expone el high score como valor y `storage.js` lo escribe, una sola vez, cuando la partida termina.

El mismo patrón de inyección de costura se repite donde el browser no está: `attachInput` acepta `blurTarget` (para testear el foco sin DOM) y `createAudio` acepta un factory de `AudioContext` (para testear el scheduler sin audio).

## Estado

- **v0.1** (minimal jugable): tablero 10x20, 7 tetrominós, rotación SRS con wall kicks, ghost piece, hard drop, líneas + puntaje + niveles, next piece, game over/reinicio.
- **v0.2** (2026-09-11): hold piece, lock delay con cap de 15 resets, DAS 170ms / ARR 50ms, flash de 180ms al limpiar líneas, pausa, high score persistente en localStorage.
- **v0.3** (2026-09-11): refactor estructural sin features nuevas. El single-file de 901 líneas se parte en módulos ES, el core queda puro y testeable, y aparece la red de tests con `node --test`. Comportamiento observable idéntico a v0.2.
- **v0.4-scoring** (2026-09-11): T-spins (regla de 3 esquinas, `tspin_full` / `tspin_mini`), combos, B2B y cola de 5 piezas visible.
- **v0.4 visual language**: lenguaje "wireframe boxes" — cada celda es un contorno con relleno tenue; la forma lleva la información y el color es el acento. La pieza activa brilla al apoyarse (lock inminente). Solo render, sin cambio de reglas.
- **v0.5** (2026-09-11): audio sintetizado (Web Audio, cero assets, incluida *Korobeiniki* secuenciada), screen shake, partículas de limpieza. Game feel.
- **v0.5.1**: audio más cálido (filtro low-pass compartido + envolventes musicales, tras feedback de Gonzo sobre los square waves "desesperantes") y música de fondo.

**No hay release tagueado.** La versión de `package.json` (0.3.0) quedó atrás del historial de commits (v0.5.1). Se unificará al versionar la versión propia del proyecto.

### Nota sobre `blur` y el DAS

El handler de pérdida de foco se registra en `window`, no en `document`: `blur` no burbujea y el foco de ventana se dispara en `window`. Si se registra en `document` (como pasó en una iteración del refactor), el handler nunca corre y una flecha apretada deja el DAS vivo al salir de la ventana con Cmd+Tab, así que la pieza sigue deslizándose al volver. `attachInput` acepta `blurTarget` inyectable justamente para que esa costura sea testeable en Node sin browser (ver `test/input.test.js`).

## Lo que ya se hizo (identidad visual, ADR-097)

1. **Materiales por pieza en el core** (U1, commit `d4da40b`): cada tetrominó lleva su `pattern` de material (`I=lumber, O=cobble, T=brick, S=silk, Z=sand, J=water, L=metal`) + `PATTERN_NAMES`. La identidad es dato testeable, no decoración de render.
2. **Render monocromo Game Boy** (U2, `3555ac4`): `render.js` dibuja cada bloque con su **textura de material** (veta, piedritas, ladrillos, trama, punteado, ondas, remaches), en los 4 tonos DMG-01. Cero color ajeno: las piezas se identifican por **patrón y silueta**, nunca por color ni brillo. El estampado es determinista (sin `Math.random`): un material no parpadea.
3. **Chrome Kanam Design System** (U3, `2b3c561`): la UI (paneles, overlays, tipografía, botones) consume los tokens del DS (`styles/kanam.css` + `dark.css`, dark-first). **Frontera por capa**: el DS gobierna el chrome; el canvas sigue Game Boy.

## Lo que queda

1. **Multijugador y móvil** — sin empezar.
2. **Evaluación de la identidad** (fase C4 del roadmap): verificar que las 7 piezas se distinguen **sin color** (daltonismo, escala de grises). Métrica del método.
3. **Método extraído** (fase C5): escribir cómo se diseña una identidad por material y silueta, reusable para otras obras.

## Motor de los agentes

- v0.1: GLM 5.3 Flash (gateway Ollama `127.0.0.1:11435`).
- v0.2 en adelante: `deepseek-v4.1-flash:cloud` (gateway Ollama `127.0.0.1:11434`).
