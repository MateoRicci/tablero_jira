# Tablero FutBot

Tablero de sprint para el proyecto **ING — FutBot** de Jira, servido local.
Sin dependencias: sólo Node (≥20.6) con `fetch` y `--env-file` nativos.

## Arrancar

```bash
npm start            # → http://localhost:4321
npm run dev          # igual, pero recarga el server al editar
```

El botón **Actualizar** fuerza una lectura nueva de Jira. La caché en
`data/cache.json` dura 45 segundos.

## Configuración

`.env` (no se commitea):

```
JIRA_SITE=https://axb-ing.atlassian.net
JIRA_EMAIL=mateo.ricci.v@gmail.com
JIRA_TOKEN=...            # token de https://id.atlassian.com/manage-profile/security/api-tokens
JIRA_PROJECT=ING          # opcional, default ING
PORT=4321                 # opcional
```

El `JIRA_EMAIL` tiene que ser el de la cuenta de Atlassian dueña del token,
no cualquier otro: la API responde 401 sin decir cuál de los dos está mal.

## Qué muestra

| Banda | Qué responde |
|---|---|
| Hero | Cuál es el cuello de botella del sprint, en una frase |
| 01 · Mapa | **Árbol de dependencias**: qué se puede agarrar ahora, filtrable por persona |
| 02 · Tablero | **Kanban**: una columna por estado, con filtro por persona |
| 03 · Reloj | **Qué lleva demasiado tiempo parado**, contra un presupuesto por complejidad |
| 04 · Ritmo | Burndown real contra ideal, y flujo acumulado |
| 05 · Equipo | Carga, quién está bloqueado, tamaño medio de ticket, quién revisa a quién |
| 06 · Dependencias | Qué destraba cada ticket, cadena crítica, cascada por niveles |
| 07 · Alcance | Avance por épica |
| 08 · Detalle | Tabla completa, ordenada por urgencia |

### El kanban

Una columna por estado del flujo, en orden. Es **de lectura**: mover un ticket
se hace en Jira y acá se ve en el siguiente refresco.

- El **círculo verde** junto a la clave marca los tickets de To Do sin
  bloqueantes pendientes — los que se pueden agarrar ya.
- La **píldora** dice cuánto lleva parado el ticket y qué porcentaje del
  presupuesto consumió.
- Los vencidos llevan un **filo rojo** a la izquierda.
- Un ticket bloqueado muestra por quién.

El filtro por persona es **el mismo que el del árbol**: elegir a alguien en
cualquiera de los dos filtra el otro.

### El reloj (`lib/sla.js`)

El flujo del proyecto es **To Do → In Progress → In Review → Done**. Cada
ticket tiene un presupuesto de horas hábiles según sus story points:

| Puntos | Presupuesto base |
|---|---|
| 1 | 2 h |
| 2 | medio día (4 h) |
| 3 | un día (8 h) |
| 5 | un par de días (16 h) |
| 8 | una semana (40 h) |

**El reloj se reinicia en cada transición**: mide cuánto lleva el ticket en el
estado donde está ahora, no desde que se creó. Un ticket que pasa de
In Progress a In Review empieza de cero con el presupuesto completo otra vez.

Ese presupuesto se ajusta por estado con `STATE_FACTOR`:

- **In Progress ×1** y **In Review ×1** — mismo presupuesto, reseteado en cada
  transición.
- **To Do ×6** — esperar tolera mucho más: un ticket de 1 punto avisa recién
  tras un día hábil sin que nadie lo tome. Con un factor más bajo, todo el
  backlog chico se pone amarillo al cerrar el primer día del sprint.
  **Este es el número a tocar si el semáforo avisa de más o de menos.**

Dos reglas que evitan las falsas alarmas:

1. **A un ticket bloqueado no le corre el reloj.** Su reloj de To Do arranca
   cuando se cierra su último bloqueante, no cuando se creó — si espera una
   dependencia, la demora no es del equipo.
2. **Se avisa al 80 %** del presupuesto (*por vencer*) y **se marca vencido al
   pasar el 100 %**.

Las horas son hábiles, con jornada de 9:00 a 21:00 todos los días (`WORKDAY`).
Todo eso —presupuestos, factores, umbrales y jornada— se cambia en un solo
lugar: el encabezado de `lib/sla.js`.

## Refresco

El tablero se actualiza **solo cada 60 segundos**. El indicador de la cabecera
dice hace cuánto fueron leídos los datos; clic para pausar o reanudar. Cuando
la pestaña queda oculta el polling se detiene, y se pone al día al volver.

Un refresco no te borra lo que tengas seleccionado: persona elegida, nodo
fijado y posición de scroll sobreviven al redibujado.

### El árbol

Cada nodo es un ticket; sus padres son los tickets que lo bloquean. Se arma
leyendo los links **"Blocks"** de Jira (132 en el sprint actual) y ordenando el
grafo por niveles topológicos.

- **Borde verde** → no espera a nadie, se puede empezar ya.
- **Gris** → bloqueado.
- **Relleno azul** → hecho.
- Clic en una persona → se atenúa el resto (el color nunca se repinta: sigue
  codificando estado, así ves cuál de *tus* tickets está libre).
- Mouse encima de un nodo → se ilumina toda su cascada. Clic para fijarla.

## Subirlo a Vercel

Vercel no usa Docker ni `compose`: cada archivo de `api/` se publica como
función serverless y `public/` se sirve como estático. La configuración está
en `vercel.json` y no hace falta paso de build.

`vercel.json` usa `builds` en vez de la autodetección a propósito. Con
autodetección, Vercel puede llegar a tratar los `.js` de `public/` como
funciones y ejecutarlos en Node, donde `document` no existe:

```
ReferenceError: document is not defined
    at /var/task/public/app.mjs:6:13
```

Declarar `builds` apaga toda la inferencia y fija qué es función
(`api/*.js` con `@vercel/node`) y qué es estático (`public/**` con
`@vercel/static`), sin depender de lo que digan los ajustes del proyecto en
el dashboard. El `excludeFiles` además deja el bundle de la función en ~56 KB:
sin él se cuela `data/cache.json` con 2,4 MB de datos viejos.

Para verificar el deploy sin publicarlo:

```bash
vercel build        # genera .vercel/output
find .vercel/output/functions -name '*.func'   # deberían ser SÓLO las de api/
```

```bash
npm i -g vercel
vercel          # primer deploy (preview)
vercel --prod   # a producción
```

### Variables de entorno

En **Project → Settings → Environment Variables** (no en `.env`, que no se
sube):

| Variable | Obligatoria | Para qué |
|---|---|---|
| `JIRA_SITE` | sí | `https://axb-ing.atlassian.net` |
| `JIRA_EMAIL` | sí | el mail de la cuenta de Atlassian dueña del token |
| `JIRA_TOKEN` | sí | el API token |
| `JIRA_PROJECT` | no | default `ING` |
| `DASHBOARD_PASSWORD` | **sí** | contraseña para entrar al tablero |
| `ALLOW_PUBLIC` | no | `1` deja el tablero abierto a cualquiera |

### Esto publica datos del equipo

El tablero muestra tickets, nombres, estimaciones, quién está bloqueado y
quién va atrasado. Subido a Vercel, eso queda accesible para cualquiera que
tenga el link.

Por eso **en serverless falla cerrado**: sin `DASHBOARD_PASSWORD` la API no
devuelve datos y explica qué falta. Si de verdad querés que sea público,
poné `ALLOW_PUBLIC=1` — pero que sea una decisión, no un descuido.

La contraseña se valida contra una cookie `HttpOnly` firmada con HMAC-SHA256,
que dura 30 días y va con `Secure` en producción. El token de Jira nunca sale
del servidor: el navegador sólo ve métricas ya calculadas.

Las respuestas de `/api/*` van con `Cache-Control: private, no-store` y todo
el sitio con `X-Robots-Tag: noindex` para que no lo indexe un buscador.

### Diferencias con el entorno local

| | Local | Vercel |
|---|---|---|
| Proceso | `server.js`, siempre vivo | una función por request |
| Caché | `data/cache.json` | memoria del proceso, mientras esté tibio |
| Credenciales | `.env` vía `--env-file` | variables del proyecto |
| Contraseña | opcional | obligatoria salvo `ALLOW_PUBLIC=1` |

Los dos comparten `lib/handlers.js`, así que la lógica es la misma.

**Ojo con el arranque en frío.** Sin proceso persistente, la primera visita
después de un rato pide los 97 issues con changelog a Jira: unos 2 s. El
refresco automático de 60 s mantiene la función tibia mientras haya alguien
mirando.

`api.json` (2,4 MB del spec de Jira) está en `.vercelignore` y no se sube.

## Estructura

```
server.js        servidor local (HTTP + rutas, sin framework)
api/board.js     función serverless de Vercel: los datos
api/auth.js      función serverless de Vercel: la contraseña
vercel.json      config del deploy
lib/handlers.js  lógica compartida entre local y Vercel
lib/jira.js      cliente REST, paginado, caché
lib/cache.js     almacén del snapshot: archivo en local, memoria en serverless
lib/auth.js      portón por contraseña con cookie firmada
lib/metrics.js   grafo de dependencias, burndown, agregados por persona
lib/sla.js       presupuestos de tiempo por complejidad y horas hábiles
public/
  app.js         composición del tablero
  tree.js        árbol de dependencias interactivo
  board.js       tablero kanban por estado
  charts.js      primitivas SVG (escalas, ticks, tooltips, leyendas)
  styles.css     tokens de color y tipografía, claro y oscuro
```

## Si cambiás de sitio de Jira

Los IDs de campos custom son por sitio. Mirá `/rest/api/3/field` y actualizá
el mapa `CUSTOM` en `lib/jira.js` (hoy: story points `10016`, sprint `10020`,
Developer `10108`, Reviewer `10109`).
