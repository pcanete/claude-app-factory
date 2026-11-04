# Motor de procesos

**Estado: propuesta, 2026-11-04. Nada de esto está implementado.** Este documento fija qué se
construye y en qué orden, antes de escribir código. Cuando una parte se construya, su contrato pasa a
un documento propio y acá queda solo la referencia.

## El problema

Las organizaciones ya trabajan con IA, pero cada persona lo hace con la suya, que compró ella y usa
para todo. El resultado tiene dos caras:

- **Lo que hace la IA de una persona es invisible para el resto.** Si Yani encuentra cómo hacer un
  buen carrusel, nadie más puede repetirlo. Para que otro siga los mismos pasos tendría que instalar
  una skill que ella armó, y eso no pasa en la vida real.
- **Los procesos cruzan personas.** Un carrusel o una web pasan por varias manos, y entre una y otra
  se pierde qué entró, qué se hizo y dónde quedó.

Y cuando alguien se va, se lleva lo que sabía y lo que su IA hizo.

## Lo que ya está decidido

| Decisión | Consecuencia |
|---|---|
| **Servicio con software, no SaaS.** Quien define los procesos es quien vende el servicio, no el cliente final | No es un constructor de procesos al estilo Pipefy o Kissflow. El activo son las definiciones |
| **Cada persona trae su IA.** La organización es dueña del trabajo, no de la IA | La frontera es la conexión MCP. Lo que no la cruzó no es de la organización |
| **La memoria no es un agente.** Cualquier IA conectada consulta la misma memoria | No se construye un agente central. Se construye lo que recuerda |
| **La plataforma registra, el borde ejecuta** | El registro no calcula ni llama afuera. Las herramientas con código van a un servicio aparte (el taller) |
| **Los procesos son datos, no esquema** | Definir un proceso nuevo no requiere desplegar |
| **Dos caras, un solo lado.** No es un marketplace | Hay que resolver el portal del cliente y la operación, no liquidez entre dos mercados |
| **La calidad la garantiza la revisión, no la confianza en la IA** | No hace falta saber qué hizo la IA en la máquina de alguien. Hace falta que el resultado pase la revisión |
| **Se cobra por instancia entregada** | Con IA de cada uno no hay licencias que cobrar |
| **El personal es elástico** | Sumar a alguien por un mes es agregarlo a una cola, no reasignar trabajo |

Cada instalación sigue siendo de un solo cliente, con su base, su repositorio y su despliegue, como
el resto de la fábrica. Nada de esto introduce multi-tenencia compartida.

## Tres niveles

| Nivel | Quién | Qué hace |
|---|---|---|
| **Define** | Quien vende el servicio (PRC, o quien lo opere) | Diseña los procesos, los versiona y asciende lo que funcionó |
| **Opera** | Los empleados y colaboradores de la organización, cada uno con su IA | Toman etapas, las ejecutan, revisan |
| **Recibe** | Los clientes de la organización | Cargan el insumo, siguen el estado y reciben el resultado |

Roles de plataforma que se desprenden: `definidor`, `operador`, `revisor`, `gerente` (ve todo el
trabajo, no opera) y `cliente`.

## El modelo

### Proceso y versión

Un **proceso** tiene nombre y una lista de **versiones**. Una versión es borrador o publicada, y una
publicada no se edita: mejorarla es publicar la siguiente. Cada instancia queda fijada a la versión
con la que nació, así que cambiar el proceso no altera el trabajo en curso.

### Etapa

Cada etapa de una versión declara:

| Campo | Qué es |
|---|---|
| `orden`, `nombre` | Posición y nombre |
| `ejecutor` | `humano`, `agente` o `cualquiera`. Una tarea física es una etapa con ejecutor `humano` |
| `grupo` | Quiénes pueden tomarla. Es la cola de la etapa |
| `entradas` | Qué datos necesita, como esquema JSON. Las de la primera etapa son el formulario del cliente |
| `visible` | Qué campos de etapas anteriores puede ver quien la toma. Lo que no está acá no se muestra |
| `instrucciones` | Cómo se hace. Markdown que la plataforma le sirve a la IA del operador |
| `herramientas` | Skills o herramientas del taller que la etapa usa, con versión |
| `criterios` | Qué tiene que cumplirse para cerrar. Cada criterio dice si es `mecanico` (lo verifica un agente) o de `juicio` (lo verifica una persona) |
| `salidas` | Qué deja, como esquema JSON. Un resultado es siempre un enlace al almacenamiento de la organización, nunca a uno personal |
| `revision` | `ninguna`, `agente`, `humana` o `ambas` |
| `plazo_toma` | Cuánto puede retener alguien una instancia sin cerrarla antes de que vuelva a la cola |

### Instancia

Un caso concreto: "Carrusel Día del Padre — Empresa X". Lleva su versión de proceso, el cliente, un
dueño humano que responde por el conjunto, la etapa actual y su estado dentro de la etapa.

Estados dentro de una etapa:

```text
en_cola → tomada → en_revision → cerrada
             ↓          ↓
        esperando    devuelta → tomada
```

- `esperando`: necesita algo de afuera (el cliente, una persona, un insumo).
- `devuelta`: la revisión la rechazó, con motivo. Vuelve a quien la tenía o a la cola.
- Al cerrarse una etapa, la instancia pasa a la siguiente en `en_cola`. Al cerrarse la última, se
  entrega.

Las transiciones las hace el motor, no una edición libre de un campo. No se puede saltar etapas ni
cerrar sin criterios cumplidos.

### Evento

La bitácora de la instancia. Se agrega, nunca se edita ni se borra. Tipos: `creada`, `tomada`,
`liberada`, `insumo`, `esperando`, `cerrada`, `revisada`, `devuelta`, `entregada`, `reasignada`.

Cada evento guarda la etapa, quién lo hizo, quién responde por esa persona o agente, el contenido y
los enlaces. Lo que sale de una etapa es lo que entra a la siguiente.

### Receta

El cierre de una etapa exige una receta. No es la conversación entera: es lo que otra persona
necesita para retomar o repetir.

| Campo | Obligatorio |
|---|---|
| `pasos` | Sí. Qué hizo, en orden |
| `herramientas` | Sí. Qué skills, conectores o herramientas usó, con versión si la sabe |
| `modelo` | Sí. Qué IA usó. Permite comparar después qué rinde mejor en cada etapa |
| `decisiones` | Sí. Qué eligió y por qué, cuando había opciones |
| `fallos` | No. Qué no funcionó |
| `resultado` | Sí. Enlace al resultado |

La receta es un parámetro obligatorio de la herramienta `cerrar_etapa`, así que no depende de la
disciplina de nadie: sin receta, la etapa no cierra, sea cual sea la IA que llama.

### Membresía

Cada persona entra con un alcance: qué procesos, qué etapas, qué rol y **hasta cuándo**. Al vencer,
pierde el acceso sola, y lo que tenía tomado vuelve a la cola. Las credenciales de agente ya tienen
vencimiento y alcance (`app_agent.expires_at`). Esto lleva el mismo concepto a las personas.

## Cómo la plataforma le dice a cada IA qué hacer

Por la conexión MCP, en tres capas:

1. **Instrucciones de servidor según el rol.** Todo cliente MCP las recibe al conectarse. Son el
   manual de inducción: dónde está, qué rol tiene y por dónde empezar.
2. **Herramientas con forma de tarea**, además de las de entidad que ya existen:

   | Herramienta | Hace |
   |---|---|
   | `mis_pendientes` | Lo que tengo tomado y lo que hay en las colas donde puedo tomar |
   | `tomar(instancia)` | Toma una instancia de la cola, con bloqueo |
   | `guia_de_etapa(instancia)` | Instrucciones, criterios, herramientas y las entradas visibles |
   | `registrar_insumo(instancia, datos)` | Deja un insumo sin cerrar |
   | `esperar(instancia, motivo)` | Pasa a `esperando` |
   | `cerrar_etapa(instancia, salidas, receta)` | Cierra si se cumplen los criterios. Si no, dice cuáles faltan |
   | `liberar(instancia, motivo)` | Devuelve a la cola |
   | `revisar(instancia, aprobada, motivo)` | Solo para quien revisa |

3. **Prompts y resources de MCP** con las definiciones de proceso y las instrucciones de cada etapa,
   para clientes que los soporten.

Una skill es, en su mayor parte, un markdown con instrucciones. Servido por la plataforma, viaja sin
instalar nada. Lo que no viaja es el código. Eso va al taller.

## El taller

Un servidor MCP separado del registro, que ejecuta herramientas que hoy necesitan una máquina con
software instalado: renderizar un carrusel, correr un QA visual, mandar un mail de entrega, revisar
con un agente. La IA del operador lo llama como a cualquier herramienta, sin instalar nada.

Está separado porque el registro no calcula ni llama afuera, y esa frontera es la que evita que la
plataforma vaya acumulando capacidad hasta convertirse en un integrador. El taller es también el
primer lugar donde la organización paga tokens propios (el agente revisor).

## La cara del cliente

- **Pedido**: el formulario sale de las `entradas` de la primera etapa.
- **Seguimiento**: el cliente ve en qué etapa está su instancia, como el seguimiento de un envío. No
  ve quién la hace ni cómo.
- **Entrega**: enlace al resultado o mail. Mandar un mail es escribir hacia afuera, así que lo hace
  el taller o el agente que tiene el conector, nunca el registro.

El cliente es un rol con alcance `own` sobre sus instancias, que la fábrica ya soporta
(`record_access`).

## La revisión

En dos pasos, para que la persona que revisa no se vuelva el cuello de botella:

- Lo **mecánico** lo verifica un agente: medidas, cantidades, ortografía, que el enlace exista.
- El **juicio** lo verifica una persona.

**Confianza graduada:** las primeras N instancias que cierra alguien nuevo van siempre a revisión
humana. Después pasan a revisión por muestreo, si la tasa de devolución es baja.

## Privacidad

- **El gerente ve el trabajo, no las conversaciones.** Instancias, etapas, tiempos, recetas,
  resultados. Ver los chats haría que la gente use su IA por fuera, y además choca con el control
  proporcional que exige la ley.
- **Lo que pasó por la IA personal de alguien no se revoca.** Por eso `visible` existe: cada etapa
  muestra solo lo que necesita, y la plataforma sirve la información cuando hace falta, en vez de que
  la gente la copie.
- **Las cuentas de consumo son un riesgo para clientes con datos sensibles.** Un estudio contable o
  jurídico puede tener prohibido que los datos de sus clientes pasen por una cuenta de IA que quizás
  entrena con lo que recibe. La definición del proceso tiene que poder marcar etapas que exijan una
  cuenta de organización o que las haga el taller. Falta definir cómo se verifica eso.

## Qué existe y qué falta

Verificado contra el runtime de la fábrica el 2026-11-04.

| Pieza | Estado |
|---|---|
| OAuth por persona, probado con Claude y ChatGPT | Existe. El Client ID es uno por IA (el mismo para todos sus usuarios), no uno por persona |
| Desactivar a una persona corta las credenciales de sus agentes | Existe (`platform/mcp/store.ts`) |
| Vencimiento y alcance de credenciales de agente | Existe |
| Alcance por registro (`own`/`all`) que falla cerrado | Existe |
| Auditoría unificada con humano responsable | Existe. Para MCP guarda nombres de campos y una huella, no valores, así que **no sirve como bitácora de recetas** |
| Configuración clave/valor JSON | Existe |
| Campo `json` | Existe |
| Vista kanban | Existe |
| Reglas que bloquean | Existen, pero no ven el valor anterior de un campo ni adjuntos. No alcanzan para un motor de transiciones |
| Instrucciones de servidor, prompts y resources en MCP | Falta. Hoy el MCP solo expone herramientas |
| Herramientas con forma de tarea | Falta |
| Procesos, versiones, etapas, instancias, eventos | Falta |
| Membresía de personas con alcance y vencimiento | Falta. Las personas tienen `active`, sin vencimiento ni alcance por proceso |
| Colas, toma con bloqueo, devolución por abandono | Falta |
| Visibilidad de campos por etapa | Falta |
| Reasignar de a muchas | Falta |
| Taller | Falta |
| Actualizar la plataforma de una app ya instalada (issue #5) | Falta. **Bloquea tener una segunda organización** |

## Pruebas de aceptación

El motor está terminado cuando pasa estas tres, en una instalación real, sin ayuda de quien lo
construyó:

1. **Alguien se va.** Se desactiva a Yani con un carrusel a medio hacer. Mauri lo retoma leyendo solo
   la plataforma, sin llamarla, y lo entrega.
2. **Alguien entra.** Pepe recibe una invitación para la etapa 3 por un mes. Conecta su propia IA,
   pregunta "¿qué tengo que hacer y cómo?", y cierra una etapa que pasa la revisión sin que nadie le
   explique nada. Al vencer el mes, pierde el acceso solo.
3. **Otro rubro.** Un proceso de un estudio contable o jurídico se define con el mismo formato, sin
   cambiar el motor.

## Orden de construcción

**Fase 0 — Piloto sobre prc-operacion, con lo que ya existe.** Las entidades `proceso` (con la
definición en un campo `json`), `instancia` y `evento` se agregan con `evolve-app-schema`. El único
cambio de plataforma es que el MCP sirva **instrucciones de servidor leídas de la configuración**. Las
transiciones se respetan por convención y por revisión, no por el motor. Proceso del piloto: el
carrusel de P3, con Yani operando con su IA de siempre. Sirve para probar las pruebas 1 y 2 en su
versión débil, en días y no en meses.

**Fase 1 — El motor en la zona de plataforma.** Procesos como datos, transiciones controladas,
herramientas con forma de tarea, receta obligatoria, colas, membresía con vencimiento, visibilidad
por etapa. Lo que se aprendió en la fase 0 decide los detalles.

**Fase 2 — La cara del cliente.** Formulario desde la primera etapa, seguimiento y entrega.

**Fase 3 — El taller.** Empezando por el agente revisor y el render de carruseles.

**Antes de la segunda organización — el actualizador (issue #5).** Sin él, cada cliente nuevo es una
copia que se desactualiza.

## Lo que sigue abierto

- **Cómo se referencia una herramienta** para que sea resoluble: repositorio y hash, o un registro
  propio.
- **Si conviene que las organizaciones que sí pagan cuentas de IA distribuyan skills** desde la
  administración de su proveedor. No está verificado qué permite cada plan.
- **Cómo se marca y se verifica** una etapa que no puede pasar por una cuenta de consumo.
- **El precio por instancia**, y si el taller se cobra aparte.
- **Si los operadores pueden ser de otra organización.** Hoy, no: eso convertiría la plataforma en un
  marketplace, que es otro negocio.

## Ejemplo: el carrusel

| Etapa | Ejecuta | Entra | Criterio | Revisión | Sale |
|---|---|---|---|---|---|
| 1. Pedido | cliente | fecha, objetivo, tono, referencias | campos completos (mecánico) | ninguna | brief |
| 2. Texto | cualquiera | brief | extensión por lámina (mecánico), tono de la marca (juicio) | ambas | texto de las láminas |
| 3. Diseño | agente + taller | texto aprobado | medidas y cantidad (mecánico), QA visual (mecánico) | agente | JPGs |
| 4. Fotos | humano | lista de tomas | están todas las tomas (juicio) | humana | fotos |
| 5. Entrega | cualquiera | JPGs y fotos | el enlace existe en el Drive de la organización (mecánico) | humana | enlace entregado al cliente |

Quien toma la etapa 3 ve el texto aprobado. No ve el contrato del cliente ni sus datos de facturación.
