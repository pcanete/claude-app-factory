# Motor de procesos — contrato

**Construido en la plataforma 1.2.0.** El porqué, las decisiones y lo que falta están en
[`process-engine.md`](process-engine.md). Este documento dice cómo funciona lo que existe.

## Qué resuelve

Cualquier persona, con la IA que tenga, puede trabajar una etapa de un proceso sin saber el
método: la plataforma le da a su IA la guía de esa etapa en el momento en que la toma. Y la
organización ve qué hizo cada uno, con qué y cómo quedó, porque cada paso se registra solo.

La persona atiende dos cosas: los insumos que sólo ella puede dar y su criterio sobre el
resultado. Qué skill usar, cómo cerrar y qué controlar se lo dice la etapa.

## Dónde vive

`src/platform/processes/`, en la zona de plataforma:

| Archivo | Qué hace |
|---|---|
| `definition.ts` | Puro, sin dependencias: valida definiciones, pedidos y cierres, decide el destino y arma la guía. Lo prueba `scripts/test-process-definition.mjs` |
| `engine.ts` | Las operaciones sobre la base, cada una en una transacción con el caso bloqueado |
| `tools.ts` | Las herramientas y prompts MCP |
| `metrics.ts` | Puro, sin dependencias: mide un proceso a partir de su bitácora. Lo prueba `scripts/test-process-metrics.mjs` |
| `dashboard.ts` | Lee la base para el tablero y decide quién lo ve |

## Qué necesita la AppSpec

El motor opera sobre tres entidades de la aplicación, así que los casos se ven en las vistas,
respetan el alcance por registro y dejan auditoría como cualquier registro. Si falta alguna, las
herramientas no se registran y la aplicación sigue igual.

| Entidad | Campos | Relación |
|---|---|---|
| `proceso` | `nombre`, `estado` (con `publicado`), `definicion` (json) | — |
| `instancia` | `titulo`, `etapa` (integer), `estado` (`en_cola`, `tomada`, `esperando`, `en_revision`, `devuelta`, `entregada`), `tomada_por` (person), `responde` (person), `insumos` (json), `resultado` (url) | `proceso` |
| `evento` | `resumen`, `tipo` (`creada`, `tomada`, `liberada`, `esperando`, `cerrada`, `revisada`, `devuelta`, `entregada`), `etapa`, `autor` (person), `salidas` (json), `receta` (json), `enlace` (url) | `instancia` |

**Permisos recomendados:** los roles que operan, sólo `list` y `read` sobre `instancia` y
`evento`. El motor no usa la matriz de la AppSpec para escribir: autoriza con el grupo de cada
etapa. Así la única puerta para mover un caso es el motor, y nadie se saltea un control
editando un campo. El rol que administra puede conservar `update` sobre `instancia` para
corregir a mano un caso trabado. Sobre `evento` nadie debería tener más que lectura.

## La definición

Vive en `proceso.definicion`. Una versión publicada no se edita: mejorarla es publicar la
siguiente, y cada caso sigue con la versión con la que nació.

```json
{
  "proposito": "Para qué existe el proceso",
  "donde_vive_el_resultado": "La carpeta del cliente en el Dropbox de la organización",
  "pedido": {
    "entradas": {
      "periodo": "mes y año",
      "carpeta": "enlace a la carpeta con las facturas",
      "notas": "opcional: algo que haya que saber"
    }
  },
  "etapas": [
    {
      "orden": 1,
      "nombre": "Liquidación",
      "ejecutor": "cualquiera",
      "grupo": ["colaborador"],
      "entradas_visibles": ["insumos"],
      "instrucciones": "Cómo se hace, en markdown",
      "pasos": ["Primero esto", "Después esto"],
      "errores_frecuentes": ["Lo que suele salir mal"],
      "herramientas": [
        { "nombre": "liquidador-iva", "tipo": "skill", "uso": "arma la planilla", "si_no_esta": "esperar y avisar" }
      ],
      "criterios": [
        { "tipo": "mecanico", "texto": "débito y crédito cuadran" },
        { "tipo": "juicio", "texto": "las percepciones están bien imputadas" }
      ],
      "salidas": { "liquidacion": "enlace a la planilla" },
      "revision": "humana",
      "revisores": ["socio"],
      "autorrevision": false
    }
  ]
}
```

| Campo | Regla |
|---|---|
| `pedido.entradas` | El formulario del pedido. Un texto que empieza con «opcional» no se exige; también vale `{ "descripcion": "…", "requerido": false }`. Sin todas las requeridas el caso no se abre |
| `orden` | 1, 2, 3… sin saltos |
| `ejecutor` | `humano`, `agente` o `cualquiera`. En una etapa `humano` la guía le dice a la IA que pida y registre, no que decida |
| `grupo` | Los roles que pueden tomarla. Un agente queda acotado por el rol de su responsable: tienen que poder los dos |
| `entradas_visibles` | Lo que la etapa ve de lo anterior: `insumos` o la clave de una salida. **Lo que no declara no se muestra.** Ver algo que nadie dejó es un error de definición |
| `herramientas` | Lo que la etapa usa. Una skill sigue instalada en la máquina de quien opera: la etapa dice cuál y qué hacer si no está, y por defecto es esperar, no improvisar |
| `criterios` | `mecanico` lo verifica quien cierra, con evidencia. `juicio` lo verifica quien revisa si la etapa tiene revisión humana, y si no, quien cierra |
| `salidas` | Lo que la etapa tiene que dejar. Todas son obligatorias al cerrar |
| `revision` | `ninguna` y `agente` pasan directo a la siguiente; `humana` y `ambas` quedan en revisión |
| `revisores` | Sin declarar, revisan los roles con `manage_users` |
| `autorrevision` | Por defecto nadie aprueba su propio trabajo |

`validar_proceso` revisa una definición contra estas reglas y contra los roles de la aplicación,
sin guardar nada.

## Los estados

```text
crear_caso ─► en_cola ─tomar─► tomada ─cerrar─► (siguiente etapa) en_cola
                 ▲               │  ▲                 │
              liberar        esperar│tomar         revisión humana
                 │               ▼  │                 ▼
                 └──────────── esperando          en_revision ─aprobar─► siguiente / entregada
                                                      │
                                   tomada ◄─tomar── devuelta ◄─devolver─┘
```

Una devolución vuelve a quien cerró, con el motivo, y la guía se lo muestra al retomarla hasta
que la etapa se vuelva a cerrar. Aprobar la última etapa, o cerrarla sin revisión, entrega el caso
con el enlace del último cierre como resultado.

## Las herramientas

| Herramienta | Quién | Hace |
|---|---|---|
| `mis_pendientes` | cualquiera | Lo que tenés para seguir, para revisar y lo que podés tomar |
| `crear_caso` | grupo de la etapa 1, o quien administra | Abre un caso si el pedido está completo. Si no, dice qué pedir |
| `tomar_caso` | grupo de la etapa | Toma o retoma, con el caso bloqueado, y devuelve la guía |
| `guia_de_etapa` | grupo, revisores, quien la tiene | La guía sin tomar |
| `esperar_caso` | quien la tiene | Deja el caso en espera con lo que falta |
| `liberar_caso` | quien la tiene, o quien administra | Devuelve a la cola |
| `cerrar_etapa` | quien la tiene | Exige enlace, salidas, receta y cada criterio con evidencia |
| `revisar_etapa` | revisores, nunca quien cerró | Aprueba, o devuelve con motivo |
| `ver_caso` | roles que leen `evento` | El recorrido completo: quién, cuándo, con qué receta y dónde quedó |
| `validar_proceso` | cualquiera | Revisa una definición |
| `tablero_de_trabajo` | roles con `view_audit` | Cómo rinde cada proceso. Ver [El tablero del trabajo](#el-tablero-del-trabajo) |

Prompts: `pendientes` y `trabajar_caso`. En los clientes que los muestran como comandos, la
persona no necesita saber qué pedirle a su IA.

Toda operación exige que la credencial tenga una persona responsable: una credencial de agente
sin dueño no opera procesos.

## Lo que registra

Cada operación escribe en la misma transacción el cambio de la instancia, el evento de la
bitácora y la auditoría con el agente y su responsable, con `source: "mcp:procesos"`. Las
reglas de la AppSpec sobre `instancia` y `evento` corren igual: son una segunda red, no la
primera.

La receta se guarda dentro del evento `cerrada`, junto con la respuesta a cada criterio. Es lo
que permite a quien define el proceso ver dónde se traba la gente y mejorar la guía con eso, no
de memoria.

## El tablero del trabajo

Lo que se registra se lee. El tablero mide cada proceso a partir de su bitácora, en `/trabajo`
dentro del panel y con la herramienta `tablero_de_trabajo` por MCP. Las dos usan la misma
medición: la pantalla es para quien prefiere mirarla, no una fuente distinta.

| Medida | De dónde sale |
|---|---|
| **En cola** | Desde que la etapa queda disponible (pedido, cierre anterior, aprobación o liberación) hasta que alguien la toma |
| **Trabajando** | Los tramos entre `tomada` y `esperando`, `liberada` o `cerrada`, sumados por caso |
| **Esperando** | Desde `esperando` hasta que se retoma. Incluye lo que tarda en retomarse una devolución |
| **En revisión** | Desde `cerrada` hasta `revisada` o `devuelta` |
| **Ciclo** | Desde `creada` hasta `entregada` |
| **Devolución** | Devoluciones sobre revisiones, por etapa. Por persona, sobre sus cierres: la devolución es de quien cerró, no de quien revisó |
| **Modelo y resultado** | El `modelo` que declaró cada receta, agrupado sin mayúsculas, y qué pasó después: aprobado, devuelto, sin revisión o pendiente |
| **Por qué se frena** | Los últimos motivos de espera, devolución y liberación de cada etapa |
| **Dónde se traba** | La etapa con más esperas, devoluciones y liberaciones por caso que pasó por ella, desde dos frenos |
| **Detenidos** | Casos abiertos sin movimiento hace tres días o más |

Los tiempos se informan como mediana y percentil 90, con la cantidad de casos medidos: con
pocos casos, un número no dice nada todavía. El período abarca los casos abiertos más los
creados en los últimos 90 días (30, 180 o 365 a elección), y cada caso cuenta con toda su
bitácora aunque haya empezado antes.

**Quién lo ve:** los roles con `view_audit`, que ya ven cada cambio en la actividad. El tablero
incluye la devolución por persona, y medir el trabajo no tiene que volverse un ranking a la
vista de quien opera. Por la misma razón la herramienta ni siquiera se registra para los demás
roles. No muestra conversaciones: sólo lo que quedó en la bitácora.

## Verificado

- `scripts/test-process-definition.mjs`: validación, pedido, cierre, destino y guía.
- Una prueba de punta a punta por MCP real contra la aplicación y PostgreSQL. Recorre un IVA
  mensual de tres etapas con:
  - un pedido incompleto rechazado;
  - un colaborador que no puede editar el caso a mano;
  - una toma bloqueada para otra persona;
  - un cierre sin evidencia rechazado;
  - una espera por una skill faltante;
  - una devolución con motivo;
  - una aprobación por otra persona;
  - una etapa humana y la entrega.

  Las 27 escrituras quedaron en la auditoría con agente y responsable. La prueba encontró una
  lectura del pool dentro de una transacción que se trababa con un pool de una conexión, y se
  corrigió.

## Lo que no hace todavía

- **Interfaz.** Las personas sin IA ven los casos en las vistas pero no pueden tomarlos ni
  cerrarlos desde el panel.
- **Plazo de toma y membresía con vencimiento.** Un caso abandonado lo libera quien administra a
  mano.
- **Casos recurrentes**, como el IVA de cada mes.
- **Cara del cliente**: formulario, seguimiento y aprobación del cliente.
- **Revisión por agente real.** `agente` hoy significa que la evidencia de los criterios
  mecánicos es la revisión.
- **Que una versión publicada no se pueda editar** lo sostiene la convención, no el motor.
- **La bitácora completa sigue legible con `query_records`** para quien tenga lectura sobre
  `evento`. `entradas_visibles` acota la guía, no esa lectura.
