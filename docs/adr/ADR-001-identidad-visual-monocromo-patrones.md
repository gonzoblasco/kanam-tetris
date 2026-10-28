# ADR-097: Identidad visual de un juego - monocromo por patrones, monocanal de identificacion

**Fecha:** 2026-10-08
**Estado:** Aceptado
**Decisores:** Gonzo / Kanam (CORE orquesta; DEV ejecuta)
**Origen:** sesion 2026-10-08 - al planificar `kanam-tetris` (clon fiel del Tetris Game Boy, 1989), Gonzo: *"me gustaba como era la estetica de las piezas que usaban patrones distintos al no tener mas colores que niveles de luminosidad... hagamos eso pero chrome Kanam... patrones, no colores"*.
**Relacionado:** ADR-047 (design system), ADR-095 (el contraste se verifica), ADR-096 (kanam-os adopta el DS + tema oscuro), ADR-083 (frontera de roles), ADR-088 (pipeline A/B)

---

## Contexto

El Tetris original del Game Boy (DMG-01, 1989) tenia una limitacion que era, a la vez, su identidad: una pantalla **monocroma** de 4 tonos de verde. Todo el juego se comunicaba con esos 4 valores de luminosidad.

La observacion de Gonzo (fotografo de retratos y bodas) describe el mecanismo real del original con precision tecnica: las piezas **no se distinguian por color**. Se distinguian por **patron de material** (una trama distinta por tetromino, simulando materiales) y por **silueta**. La luminosidad era el medio, no el mensaje: tanto que el GB *oscurecia* lo que queria destacar (las piezas activas iban en el tono mas oscuro sobre el fondo mas claro) - contraintuitivo si se piensa "mas brillo = mas visible".

Al planificar el proyecto habia que decidir que hacer con la identidad visual, con dos extremos tentadores y un problema de gobernanza de fondo:

- **Game Boy puro:** fidelidad total, pero el proyecto quedaba visualmente aislado del ecosistema Kanam.
- **Kanam Design System a todo:** consistencia, pero forzar la paleta semantica del DS (`surface.card`, `text.primary`, `brand.primary`) a los bloques de un juego seria "aplicar el sistema de nombre" - el anti-patron que ADR-095 rechazo explicitamente.

El problema de fondo: **el DS no tiene una capa de "paleta de contenido"** - colores que no son UI (superficies, texto, estados) sino *material del producto* (los tetrominos, un mapa, una data-viz). Hoy esa categoria no existe en el sistema, y este proyecto la necesita.

## Decisión

### 1. Modelo: monocromo por patrones, no por color

El juego se renderiza en **4 tonos de una misma linea de tono y saturacion, variando solo la luminosidad**. No hay hue diferente ni saturacion diferente entre los 4 tonos: es una escala de luz (coherente con la paleta DMG-01).

- El **canal primario de identificacion de piezas es el patron de material** (textura distinta por tetromino), con la **silueta** como canal secundario.
- **El tono es decorativo, nunca el unico canal.** Invariante: si dos piezas cayeran en el mismo tono (o en la misma luminosidad), siguen siendo distinguibles. **No se depende del brillo.**

### 2. Chrome: Kanam Design System, dark-first

Fuera del canvas (panel de puntuacion, tipografia, overlays de PAUSA / GAME OVER, la pagina contenedora) el juego consume el **DS Kanam** (`kanam.css` + modo oscuro de ADR-096). El modo oscuro es el default: el verde GB brilla sobre fondo oscuro.

### 3. Frontera por capa (coherente con ADR-095)

**El DS gobierna la UI; el canvas es material del producto y usa su propia paleta.** El chrome habla Kanam; la pantalla del juego habla Game Boy. No se fuerza la identidad de una capa sobre la otra. Es el mismo principio de la regla de idioma por capa: una identidad por superficie, no una paleta forzada a todo.

### 4. Lenguaje de color: HSL en la conversacion

El owner lee el color en **tono / saturacion / luminosidad (HSL)**, no en hex. Los pedidos de ajuste se formulan y responden en esos terminos ("quitale luminosidad" = no "agregale blanco"; "subile saturacion" = no "agregale gris"); el hex/token es la traduccion de implementacion. El canal de dialogo es HSL; el codigo, hex.

## Consecuencias

- **Positivas:** el juego queda fiel al original *y* parte del ecosistema. La identificacion por patron es ademas **accesible** (funciona para daltonismo, para pantalla mala, para impresion en blanco y negro): la accesibilidad no se agrega encima, es el mecanismo de diseno.
- **Positivas (metodo):** la pregunta "¿identidad de proyecto o del ecosistema?" no se resolvio eligiendo un bando, sino **trazando la frontera de capas**. Aplica a cualquier producto con contenido grafico.
- **Deuda del sistema (declarada):** el DS **no tiene capa de paleta de contenido**. Este ADR lo registra como hueco real; no se resuelve aca. Si un tercer producto necesita paleta propia (un mapa, una viz), el DS deberia ganarla.
- **Riesgo de mal uso:** "consistencia de marca" mal entendida como "pintar todo con los tokens semanticos", incluso lo que no es UI. La frontera de capas es la que manda.

## Criterios de descarte (para no re-elegir por olvido)

- **Paleta Kanam viva en los bloques (7 colores):** rompe la fidelidad al original y mezcla paleta semantica de UI con material de juego. Descartado.
- **Todo con tokens del DS, incluido el canvas:** seria aplicar el sistema de nombre; no hay token para "tetromino". Descartado (mismo razonamiento que ADR-095).
- **Game Boy puro sin chrome Kanam:** proyecto visualmente aislado del ecosistema. Descartado.
- **Identificacion por luminosidad unicamente:** es *el* error del original que Gonzo señalo - si el brillo es el canal, la pieza se pierde. El canal es el patron.

## Alternativas consideradas

1. **Hibrido por capas (elegida).** Cada superficie con su identidad.
2. **Monocromo con patrones + chrome Kanam pero claro por defecto.** Rechazada: el DS es dark-first (ADR-096) y el verde GB destaca mejor sobre oscuro.
3. **Dejar la identidad para despues del MVP funcional.** Rechazada: la decision visual condiciona el render (el patron tiene que estar en el modelo de datos de la pieza, no pintarse encima); decidirla tarde obliga a re-tocar el render.

## Artefactos

- Proyecto: `~/.openclaw/workspace/projects/kanam-tetris/` (**vanilla JS, modulos ES, cero dependencias, cero build**, Canvas 2D). *(Correccion 2026-10-09: una version previa de este ADR decia "Vite + React + TypeScript" - era falso, nunca tuvo build.)*
- Paleta: 4 tonos DMG-01, misma linea de tono/saturacion, luminosidad variable (`render.js` -> `PALETTE`).
- Patrones: en el modelo de la pieza (`core.js` -> `pattern` + `PATTERN_NAMES`), no en el render. Los 7 materiales: `lumber, cobble, brick, silk, sand, water, metal`.
- Chrome: `design/tokens/dist/kanam.css` + `dark.css`, copiados a `styles/` del proyecto y mapeados en `styles/theme.css` (dark-first, `data-theme=dark`).

## Estado de implementacion (2026-10-09)

Las tres piezas de la decision estan **construidas y verificadas** (pipeline A/B, verificacion del CORE contra el repo real):

| Unidad | Que | Commit | Tests |
|---|---|---|---|
| U1 | Materiales por pieza en el core + `PATTERN_NAMES` | `d4da40b` | 5 nuevos |
| U2 | `render.js` monocromo GB, texturas de material, estampado determinista | `3555ac4` | 7 nuevos |
| U3 | Chrome con tokens del DS, frontera por capa | `2b3c561` | contrato actualizado |

**Total: 138 tests, 138 pass / 0 fail** (medido por el CORE, no por el auto-reporte de los agentes).

**Hallazgos de la implementacion (valen como metodo):**
- El **tono es decorativo de verdad**: hay 4 tonos para 7 piezas (repartidos ciclicamente). I/Z, O/J y T/L comparten tono y **solo se distinguen por su textura** - el invariante del ADR, probado.
- El **estampado es determinista**: `drawSand` uso `Math.random` y hubo que reemplazarlo por un hash entero puro. Un material no parpadea; si el patron es el canal de identidad, tiene que ser estable frame a frame.
- **El feedback especial no usa color**: el T-spin se distingue por ancho (4px vs 2.5) e intensidad (fill 0.10 vs 0.05, glow 20 vs 14), no por un hue propio.
- **El auto-reporte de los agentes miente**: en las tres unidades el subagente reporto "listo/verde" y la verificacion del CORE encontro huecos (U1 sin tests, U2 con morado residual y arena parpadeante, U3 con 3 tests rojos y la `perspective` perdida). Sin verificar el repo real se habrian aceptado los tres.

**Pendiente (fases C4/C5 del roadmap del proyecto):**
- **C4 - Evaluar:** verificar que las 7 piezas se distinguen **sin color** (daltonismo, escala de grises).
- **C5 - Extraer el metodo:** escribir como se diseña una identidad por material + silueta, reusable para otras obras.
- **Deuda del sistema (sin cambio):** el DS sigue sin capa de "paleta de contenido".
