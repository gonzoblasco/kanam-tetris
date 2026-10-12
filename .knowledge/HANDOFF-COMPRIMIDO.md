# kanam-tetris — HANDOFF COMPRIMIDO (2026-10-09)

> Contexto denso para continuar en un modelo local de ~100K. Léelo entero y arrancás sin re-descubrir nada.

## Dónde vive (rutas reales)
- **Proyecto:** `~/.openclaw/workspace/projects/kanam-tetris/` (el symlink `~/projects` apunta ahí).
- **Repo:** https://github.com/gonzoblasco/kanam-tetris (público). HEAD: `e8d3cc7`. **142 tests pasan.**
- **Correr:** `cd ~/projects/kanam-tetris && python3 serve.py 8123` → http://localhost:8123
  - **OJO:** usar `serve.py` (manda `no-store`). `python3 -m http.server` **no** y sirve builds cacheados viejos.
- **Tests:** `npm test` (node --test, cero deps).

## Stack
Vanilla JS, módulos ES, **cero dependencias, cero build**. Canvas 2D.
- `src/core.js` — simulación pura (sin DOM/reloj/storage). Piezas, patrones, gravedad.
- `src/render.js` — dibuja el estado en canvas.
- `src/input.js` — teclado → intenciones.
- `src/main.js` — loop. `src/audio.js`, `effects.js`, `storage.js`.
- `index.html` + `styles/` (tokens Kanam DS).

## Estado actual (lo que YA funciona)
1. **Teclado:** flechas **+ WASD** (owner zurdo). ← → mover, ↑ rotar, ↓ soft drop, Espacio hard drop, C hold, M audio, P/Esc pausa. DAS 170ms/ARR 50ms.
2. **Identidad visual (ADR-097 del workspace):** monocromo Game Boy. Fondo claro `#9bbc0f`, celdas = cajas huecas con contorno oscuro `#0f380f`, y una **trama de material** dentro. Paleta estricta de 4 tonos DMG: `#0f380f #306230 #8bac0f #9bbc0f`. **La pieza se identifica por trama + silueta, NUNCA por color ni brillo.**
3. **Materiales (7, en `MICRO_PATTERNS`, core.js):** grillas **16×16** de 0/1 (0=fondo claro, 1=tinta oscura). `I=lumber, O=cobble, T=brick, S=silk, Z=sand, J=water, L=metal`.
4. **Curva de velocidad NES:** `dropIntervalFor(level)` pura: 600ms en nivel 1, decayendo ~1.3×/nivel (`Math.pow(0.77, level-1)`), techo 50ms. Nivel 10 ≈ 57ms. Nivel cada 10 líneas. El owner confirmó: "fácil al principio, perdí en nivel 6" → **funciona**.
5. Chrome con tokens del Kanam Design System (dark-first). Canvas y chrome son capas separadas (ADR-097).

## ⚠️ Deudas ABIERTAS (para la próxima pasada)
1. **3 tramas que no leen al ojo** (a 16×16): `lumber` (lee como 2 barras, no veta de madera), `water` (forma confusa, no lee "onda/agua"), `sand` (es diagonal, no grano). Refinar.
2. **Código muerto en `render.js`:** 7 funciones `drawLumber/drawCobble/drawBrick/drawSilk/drawSand/drawWater/drawMetal` (~120 líneas) **sin uso** (el render dibuja vía `MICRO_PATTERNS`). Borrar.
3. **`TYPE_BY_COLOR`** en `render.js`: el render infiere el tipo de pieza mapeando un hex de color → contradice ADR-097. Debe leer el tipo desde el estado, no del color.

## Lecciones duras (NO repetir)
- **Los auto-reportes de subagentes MIENTEN.** 4 veces dijeron "listo/verde" siendo falso (U1 sin tests; U3 con "142/0" y 3 rojos + perspective perdida; U5 con TONE_BY_TYPE "eliminado" y seguía; U7 curva "completa" a medias). **SIEMPRE verificar el repo real** (`git status`, `npm test`, grep), no el reporte.
- **"Test verde ≠ funciona".** El juego NO respondía a NINGUNA tecla con 138 tests en verde: era un **`</div>` huérfano** en index.html que rompía el DOM. Ya hay guard (`test/html-balance.test.js`, verifica balance de tags).
- **Un test que no puede fallar no es test.** Si tocás lógica, probá con mutación (rompé algo y mirá que el test se ponga rojo).
- **Verificá contra la realidad, no contra el documento que la describe.** Un `AGENTS.md`/README desactualizado ya causó una decisión equivocada.
- **Grilla útil = tamaño de celda / 2px.** A 30px de celda, 16×16 es el techo nítido. 32×32 necesitaría celda ~60px (tablero 600×1200, no entra).

## Pipeline (si seguís con subagentes)
- CORE orquesta; **A escribe** (`gpt-oss:120b-cloud`), **B revisa** (`deepseek-v4.1-flash:cloud`). Cross-review obligatorio (ADR-077/088).
- Notas del harness: `sessions_spawn` cross-agent necesita `context:"isolated"` (no `fork`). El tool `openclaw` procesa **un `config.set` por llamada**. Los subagentes a veces **mueren o se bloquean la entrega** (el gateway se actualizó solo): igual **verificá el repo**, el trabajo suele estar hecho.
- Server local: los procesos de exec **mueren cuando se corta la sesión**. Pedir que lo levanten de nuevo.

## Gobernanza del workspace (relacionado)
- ADRs relevantes: **ADR-097** (identidad visual del juego), **ADR-098** (proyectos en `<workspace>/projects/`, `~/projects` es symlink; `cwd` de dev/ops = `workspace/`).
- `kanam-tetris` es **A+C** (banco de pruebas del pipeline + caso de método de identidad), **no producto**. Ver `projects/kanam-tetris/.knowledge/ROADMAP-TETRIS.md`.
- Handoff completo (no comprimido): `projects/kanam-tetris/.knowledge/HANDOFF.md`.
- Informe de sesión: `memory/2026-10-09.md` y `memory/2026-10-08.md` (workspace).

## Próximo paso sugerido
Atacar las **3 deudas** en una pasada: refinar `lumber`/`water`/`sand` + borrar las 7 funciones muertas + sacar `TYPE_BY_COLOR`. Verificar `npm test` (142) y generar imagen de las tramas (`render-preview.mjs`, gitignored) para juzgar con el ojo. Después commit + push.
