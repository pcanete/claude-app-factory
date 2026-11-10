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

La forma de tenerlas es declarar el bloque `"blocks": ["procesos"]` en la AppSpec: la fábrica las
agrega con sus vistas y permisos. Ver [Bloques](app-spec-v0.md#bloques). La tabla dice lo mínimo
que el motor comprueba, para quien las declare o las extienda a mano.

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
| `requiere` | Lo que tiene que tener la máquina que la trabaja, por ejemplo `["hyperframes"]` o `["higgsfield"]`. Sólo la ve en `mis_pendientes`, y sólo la puede tomar, quien lo declara en `herramientas`. Una IA de navegador no declara nada, así que no toma una etapa que necesita renderizar en local |
| `eleccion` | `{ "opciones": "<salida>", "guarda": "<clave>" }`: la etapa deja una lista de opciones y una persona elige una. La elegida queda como `guarda` para las etapas siguientes. Exige revisión `humana` o `ambas` y al menos dos opciones al cerrar |

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
| `mis_pendientes` | cualquiera | Lo que tenés para seguir, para revisar y lo que podés tomar. Con `herramientas`, suma las etapas que las requieren |
| `crear_caso` | grupo de la etapa 1, o quien administra | Abre un caso si el pedido está completo. Si no, dice qué pedir |
| `tomar_caso` | grupo de la etapa, con las `herramientas` que pida | Toma o retoma, con el caso bloqueado, y devuelve la guía |
| `guia_de_etapa` | grupo, revisores, quien la tiene | La guía sin tomar |
| `esperar_caso` | quien la tiene | Deja el caso en espera con lo que falta |
| `liberar_caso` | quien la tiene, o quien administra | Devuelve a la cola |
| `cerrar_etapa` | quien la tiene | Exige enlace, salidas, receta y cada criterio con evidencia |
| `revisar_etapa` | revisores, nunca quien cerró | Aprueba, elige una opción (`eleccion`) o devuelve con motivo |
| `ver_caso` | roles que leen `evento` | El recorrido completo: quién, cuándo, con qué receta y dónde quedó |
| `validar_proceso` | cualquiera | Revisa una definición |
| `registrar_iteracion` | cualquiera | Guarda algo que salió bien —resultado, receta y conversación— como iteración de un proceso; si el proceso no existe, lo crea como v1 |
| `como_se_hace` | cualquiera | La versión vigente de un proceso y la receta de las últimas veces que salió bien, sin abrir un caso |
| `iteraciones_de_proceso` | cualquiera | Las veces que se hizo un proceso, en todas sus versiones, con su receta, su conversación y sus imágenes |
| `adjuntar_a_caso` | quien lo hizo, quien responde o quien administra | Adjunta archivos livianos (las láminas de un carrusel) a un caso o a una iteración |
| `tablero_de_trabajo` | roles con `view_audit` | Cómo rinde cada proceso. Ver [El tablero del trabajo](#el-tablero-del-trabajo) |

Prompts: `pendientes`, `trabajar_caso`, `registrar`, `reproducir` y `mejorar_proceso`. En los clientes que los muestran como comandos, la
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

## La memoria del método

El problema que resuelve: alguien del equipo hace algo con IA, queda bien, y no queda registro
de cómo. Las conversaciones quedan sueltas, en Claude o en ChatGPT, y la próxima vez se empieza
de cero. El orden de trabajo real es el inverso al de un proceso definido de antemano: primero
se hace, después se decide que está bien, y recién ahí se quiere guardar cómo.

- **Registrar.** Al terminar algo que quedó bien, la persona le dice a su IA «registrá esto». La
  IA arma la receta de la conversación —pasos, prompts textuales, herramientas, modelo,
  decisiones y lo que se descartó—, pide el enlace al resultado y el de la conversación, se la
  muestra a la persona y llama `registrar_iteracion`. Si el proceso no existe, ese registro lo
  crea como v1, con la receta como instrucciones de una sola etapa.
- **Reproducir.** Otra persona, en otra máquina o con otra IA, pide «hacé X». Su IA trae la
  receta con `como_se_hace`, la sigue y al terminar registra una **reproducción**: si salió
  igual, y si no, qué faltó. Una reproducción fallida es la señal más clara de qué le falta a la
  receta.
- **Mejorar.** «Mirá las iteraciones y proponé la versión siguiente»: la IA lee
  `iteraciones_de_proceso`, propone qué cambia y por qué, y quien administra publica.

Quién aprueba: lo que registra quien administra queda entregado; lo que registra otra persona
queda para que lo apruebe quien administra, con la receta a la vista, y si creó un proceso, el
proceso nace en borrador y se publica con esa aprobación. Una reproducción no se aprueba: es una
prueba de la receta.

La conversación de origen la tiene que pasar la persona: una IA no conoce la dirección de su
propia conversación. El enlace compartido lo abre cualquiera del equipo; el de la barra del
navegador, sólo su dueño. Y la receta es lo que la IA reporta de la conversación, no la
conversación misma: por eso se le muestra a la persona antes de guardarla.

En el panel, **Procesos** lista cada proceso con su versión vigente, sus iteraciones y los
casos en curso. La página de cada uno junta todo lo suyo: cómo se hace, lo que está en curso, las
iteraciones —con el resultado, la conversación, la receta y, en las reproducciones, si salió
igual— y, para quien administra, cómo rinde y el enlace a la definición. Las vistas técnicas del
motor (casos en curso de todos los procesos, bitácora, definiciones, tablero) salieron del menú y
siguen abriéndose por su dirección.

La familia de un proceso —todas sus versiones— la da la clave `proceso` de la definición; si no
la declara, sale del nombre sin el « vN» del final.

**El resultado se ve, no sólo se enlaza.** Lo liviano que hace falta mirar —las láminas de un
carrusel, la portada de un video— se adjunta a la iteración: desde el panel, eligiendo todas las
imágenes juntas (viajan de a una, porque Vercel corta los pedidos de más de 4,5 MB), o por MCP con
`adjuntar_a_caso`. La página del proceso las muestra como galería, y `como_se_hace` las lista en
`referencias` para que la IA que va a repetir el trabajo las mire con `read_attachment` antes de
empezar. Lo pesado —video, originales, paquetes— sigue en la carpeta compartida, con un enlace.

Los casos admiten hasta 20 archivos de 3 MB: JPG, PNG, WebP o PDF. Adjunta quien hizo el caso,
quien responde por él o quien administra, sin necesitar permiso para editar casos a mano.

## Decidir desde el panel

El trabajo de las etapas lo hace una IA; decidir es de una persona, y esa persona no tiene por
qué saber de IA. En **Mis pendientes**, «Para decidir» va primero: cada caso en revisión muestra
lo que dejó la etapa —el resumen, las imágenes como imágenes, los enlaces, lo que hay que juzgar—
y se resuelve con un botón: **Elegir esta** en cada opción si la etapa pide elegir, **Aprobar** si
no, y **Devolver** con el motivo. Es la misma operación que `revisar_etapa`, con la persona como
identidad: el motor comprueba que le toque y que no sea su propio trabajo.

Una salida que trae una dirección de imagen —o una clave como `vista_previa`, `fotos` o
`imagen`— se ve como imagen. Un enlace compartido de Dropbox se muestra con `raw=1`, que devuelve
el archivo en vez de la página de vista previa.

## Dónde corre el trabajo

La plataforma no ejecuta nada: guarda el proceso, la cola, las decisiones y la bitácora. El
trabajo pesado —renderizar un video, generar fotos con una cuenta paga— corre en una máquina que
tiene las skills y las credenciales, con una IA que pide sus pendientes declarando qué tiene
(`mis_pendientes` con `herramientas`), toma la etapa, escribe el resultado en la carpeta
compartida que esa máquina sincroniza y cierra con el enlace y una vista previa liviana. Las
credenciales no salen de esa máquina y los archivos pesados no pasan por la plataforma.

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

- **Trabajar una etapa desde el panel.** Decidir sí; tomar y cerrar una etapa de trabajo sigue
  siendo de una IA conectada.
- **Plazo de toma y membresía con vencimiento.** Un caso abandonado lo libera quien administra a
  mano.
- **Casos recurrentes**, como el IVA de cada mes.
- **Cara del cliente**: formulario, seguimiento y aprobación del cliente.
- **Revisión por agente real.** `agente` hoy significa que la evidencia de los criterios
  mecánicos es la revisión.
- **Que una versión publicada no se pueda editar** lo sostiene la convención, no el motor.
- **La bitácora completa sigue legible con `query_records`** para quien tenga lectura sobre
  `evento`. `entradas_visibles` acota la guía, no esa lectura.
