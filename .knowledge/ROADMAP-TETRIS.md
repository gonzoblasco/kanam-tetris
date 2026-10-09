# kanam-tetris — ROADMAP de evolución

**Fecha:** 2026-10-09
**Estado:** Vivo.
**Autor:** Kanam (CORE), a pedido de Gonzo.
**Decisión de encuadre (2026-10-09):** `kanam-tetris` es **A + C**, no B.

---

## Qué es este proyecto (para que el roadmap no mienta)

`NORTH.md` (2026-10-06) lo dice explícito: *"`kanam-solitaires` / `kanam-tetris` como vidriera de portfolio. Fueron bancos de prueba del pipeline; su valor ya se cobró"*. Y lo lista bajo **"Qué ya NO es el norte"**.

Eso sigue siendo cierto en cuanto a **producto**. Pero el 2026-10-08 lo revivimos y el proyecto **volvió a tener valor**, en dos ejes que **no** son "ser una obra":

| Eje | Qué es | Por qué vale |
|---|---|---|
| **A — Laboratorio del pipeline** | El banco de pruebas donde se ejercita el flujo CORE -> A/B -> verificación | Es barato, tiene 128 tests, y expone los huecos del pipeline (hoy: A escribe mal, B corrige). Su valor es **cuánto enseña**, no cuánto entretiene |
| **C — Caso de método de identidad visual** | El primer caso trabajado de "diseñar una identidad desde cero" | **Esto atraviesa.** La identidad (materiales, no color; accesibilidad como mecanismo) sirve para OnWheels, el design system y el oficio de diseño UI/UX |

**No es B (obra de producto).** No hay promesa de entregarlo a nadie, ni de que sea "finito". Si algún día se gradúa a obra, **se corrige NORTH.md y este encuadre** - no antes.

> **Regla de honestidad:** este roadmap no promete un juego terminado. Promete **método ejercido** (identidad visual) y **pipeline probado** (A/B).

---

## Eje C — Identidad visual como método (el frente que alimenta al norte)

El frente **"Diseño UI/UX"** de NORTH.md dice que *"el sistema ya existe; falta aplicarlo"*. Este proyecto es el primer caso donde **se aplica de verdad**, no en una obra comercial sino en un caso controlado y chico.

### Lo que ya se decidió e hizo (2026-10-08)

- **ADR-097**: identidad visual de un juego — **monocromo por PATRONES de MATERIAL**, no por color ni brillo. La identificación primaria es **silueta + textura**; el tono es decorativo. Canal de color en **HSL** (Gonzo lee color en tono/saturación/luminosidad, no en hex).
- **U1 commiteada** (`d4da40b`): los 7 materiales en el core (`lumber, cobble, brick, silk, sand, water, metal`) + `PATTERN_NAMES` + 5 tests. 128 tests pasan.
- **Frontera por capa**: el Design System gobierna la UI (chrome); el canvas es "material del producto" con paleta propia (Game Boy).

### Deuda del sistema que este caso reveló

- **El DS no tiene capa de "paleta de contenido"** (colores que no son UI sino *material*: los tetrominós, un mapa, una data-viz). Declarado en ADR-097. Si un tercer producto necesita paleta propia, el DS debería ganarla.

### Fases de C (método)

| Fase | Qué | Estado |
|---|---|---|
| **C1. Identidad declarada** | ADR-097 + materiales en el core | ✅ Hecho (U1) |
| **C2. Identidad renderizada** | `render.js` monocromo GB que **estampa los materiales** (U2). Aquí se ve si el patrón funciona como canal primario | ⏳ Pendiente |
| **C3. Identidad integrada** | Chrome Kanam DS (U3). Prueba la **frontera por capa** (DS en UI, GB en canvas) | ⏳ Pendiente |
| **C4. Identidad evaluada** | ¿Se distinguen las 7 piezas **sin color**? Test visual + a11y (daltonismo, escala de grises). Métrica del método | ⏳ Pendiente |
| **C5. Método extraído** | Escribir el **método reusable**: cómo se diseña una identidad por material y silueta. Candidato a skill (`design-direction`?) o capítulo del estudio de diseño | ⏳ Pendiente |

**Criterio de listo (C):** una identidad que se sostiene **sin un solo píxel de color**, con el método escrito y reusable.

---

## Eje A — Laboratorio del pipeline (el banco de pruebas)

`kanam-tetris` es el mejor banco de pruebas del pipeline A/B porque: es chico, tiene tests, es determinista, y tiene un core puro separado del render.

### Lo que ya enseñó (2026-10-08)

- **El `cwd` destrabado**: el agente A no podía escribir en el proyecto; la causa era el alcance del `cwd`, no un sandbox. Se resolvió con `cwd=workspace/` (recursivo). **ADR-098.**
- **A vs B medido**: A (`gpt-oss:120b`) escribió 7 patrones geométricos (no materiales), 2 invertidos y **cero tests**. B (`deepseek-v4.1-flash`) los corrigió con la vara del ADR-097 y agregó los tests. **El revisor ve más que el ejecutor** — medido, no teoría.
- **El auto-reporte miente**: A reportó "éxito" con salida cruda, pero el diff tenía agujeros. El CORE verificó el repo real.

### Fases de A (pipeline)

| Fase | Qué | Estado |
|---|---|---|
| **A1. Pipeline probado en unidades de render** | U2 y U3 corren con A/B (no solo U1) | ⏳ Pendiente |
| **A2. Medir el pipeline sobre sí mismo** | Registrar por tarea: ¿cuánto corrigió B? ¿cuántos tests faltaron? ¿cuántas iteraciones? Un log de evidencia por unidad | ⏳ Pendiente |
| **A3. Detectar el patrón** | Si A falla siempre en lo mismo (p.ej. olvidar tests), promover a **regla del prompt** o **guard del gate** | ⏳ Pendiente |

**Criterio de listo (A):** el pipeline deja evidencia medible de su propio valor (cuánto corrige B) y al menos una regla promovida desde un patrón observado.

---

## Lo que NO promete este roadmap

- **No** promete un juego "terminado" para entregar a alguien (eso sería B, y B se rechazó).
- **No** promete multiplayer, móvil, high scores online ni monetización. Si el juego crece, es **consecuencia del método**, no objetivo.
- **No** desplaza a los frentes del norte (OnWheels, Kanam OS, CPACC). Tetris es **banco de pruebas y caso de método**, y cede el paso cuando el norte lo pida.

## Roadmap de producto (por si algún día se gradúa a B)

Anotado como **latente, no comprometido** — para no perder las ideas, sin prometerlas:

- U2: render monocromo GB estampando los materiales.
- U3: chrome Kanam DS con frontera por capa.
- Audio: ya existe (`audio.js`, Korobeiniki sintetizado) — evaluar si sobrevive al rework visual.
- **Visión a futuro (Gonzo, 2026-10-08):** versiones donde las piezas estén **graficadas como sus elementos** — la veta real de la madera, el grano de la arena, el remache del metal. De "textura abstracta" a "identidad tangible". El `pattern` del core es el punto de extensión natural.
- Multiplayer, móvil, PWA: sin empezar, sin fecha.

---

## Estado de las unidades (técnico)

| Unidad | Qué | Estado | Commit |
|---|---|---|---|
| U1 | Materiales por pieza + `PATTERN_NAMES` + 5 tests | ✅ Completa y verificada | `d4da40b` |
| U2 | `render.js` monocromo GB con los materiales | ⏳ Pendiente | — |
| U3 | Chrome Kanam DS en `index.html` | ⏳ Pendiente | — |

## Cómo se decide si sigue

Tres preguntas (mismo criterio que NORTH.md):

1. **¿Sigue enseñando el pipeline (A) o el método (C)?** Si ambos ya se cobraron y no hay nada nuevo que probar, se pausa.
2. **¿Le quita tiempo al norte?** Si OnWheels/Kanam OS/CPACC lo necesitan, Tetris cede.
3. **¿Hay una unidad con criterio de listo claro?** Si no, no se abre trabajo nuevo.

---

_Primer roadmap del proyecto tras la decisión A+C (2026-10-09). Se revisa cuando una fase cierre o el norte cambie._
