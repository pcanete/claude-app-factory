# Claude App Factory

**Una base para servicios que se entregan con software.**

Cuando a alguien del equipo algo le sale bien con IA en su máquina, la plataforma guarda cómo lo
hizo —qué necesitaba la máquina, qué pasos, qué prompts, con qué skill y dónde quedó lo
producido— para que otra persona lo repita en otra máquina, con otra IA. La plataforma no hace el
trabajo: guarda el método y cada vez que se hizo, para que el método sea de la organización y no
de la IA de cada persona.

Cada organización recibe su propia aplicación —Next.js y PostgreSQL, con su repositorio, su base y su
despliegue—, generada a partir de una descripción de lo que maneja. No es un servicio compartido: si
esta fábrica desaparece, la aplicación sigue funcionando.

## Para quién es

Para cualquier organización que vende un servicio repetible que pasa por varias manos: una agencia
que produce contenido, un estudio contable que liquida impuestos todos los meses, una consultora que
entrega informes, un equipo que arma sitios web. El rubro no importa; el formato del proceso es el
mismo.

Te sirve si:

- tu equipo ya trabaja con IA, pero cada uno con la suya, y lo que a alguien le salió bien nadie más
  lo puede repetir;
- un trabajo pasa de una persona a otra y en el camino se pierde qué entró, qué se hizo y dónde quedó;
- cuando alguien se va, se lleva lo que sabía;
- querés sumar gente por un proyecto o por un mes sin tener que explicarle todo de nuevo;
- la información vive repartida entre planillas, correos y mensajes, y nadie sabe cuál es la versión
  buena.

## Cómo funciona

Dos piezas:

| Pieza | Qué guarda |
|---|---|
| **Proceso** | Qué hace, con qué skill, qué tiene que tener la máquina —cada requisito con cómo comprobarlo y cómo instalarlo—, qué hay que registrar cada vez y en qué carpeta de Dropbox va lo producido |
| **Iteración** | Una vez que se hizo: la carpeta con lo producido y sus archivos, los datos que el proceso pide, la receta (pasos, prompts, herramientas, modelo, decisiones, descartes), la skill con su commit y la conversación |

Quien lo repite le pide a su IA «hacé X». La IA trae el proceso por MCP, comprueba los requisitos
en esa máquina, instala o avisa lo que falta, sigue la skill, guarda en Dropbox, comprueba que
quedó y registra la iteración. Si estaba repitiendo, dice si salió igual y, si no, qué faltó: es lo
que mejora el proceso.

Una iteración sin carpeta de Dropbox y sin la lista de archivos que quedaron ahí no se registra.
Estado y responsable son opcionales. No hay etapas, colas ni aprobaciones.

## Qué no es

- **No es un SaaS compartido.** Cada organización tiene su aplicación, su base, sus credenciales y
  su ciclo de vida. Los datos son de quien los genera.
- **No es un constructor de procesos para el cliente final**, al estilo de los editores de flujos.
  Las definiciones de proceso son el activo de quien vende el servicio.
- **No es un agente.** Cada persona trae su IA; la plataforma es la memoria común a la que todas se
  conectan.
- **No es un CRM, un ERP ni un gestor de contenidos.** No presupone a qué se dedica quien la usa.
- **No ejecuta el trabajo.** Lo hace la IA de cada persona en su máquina, con sus skills. La
  plataforma guarda cómo se hizo.

## Qué hay adentro

La fábrica convierte una descripción de la organización —un AppSpec: entidades, campos, relaciones,
vistas, roles y reglas— en una aplicación funcionando:

- base PostgreSQL con migraciones versionadas, ABM auditado, importación y exportación, y adjuntos;
- vistas de tabla, kanban, calendario y tablero;
- roles y permisos verificados en el servidor, y alcance por registro opcional: un rol puede ver todo
  o sólo aquello donde figura como responsable;
- reglas de validación y de mutación deterministas;
- autenticación con Clerk, acceso sólo por invitación y administración de usuarios;
- una sola línea de tiempo con lo que hicieron personas y agentes, donde cada entrada lleva a la
  persona que responde;
- un endpoint MCP donde cada agente entra con su propia credencial —hasheada, con vencimiento, con
  alcance y con una persona responsable— o por OAuth con la cuenta de la persona, y recibe
  instrucciones según su rol;
- **procesos e iteraciones**: requisitos comprobables, registro definido por el proceso, carpeta
  de Dropbox obligatoria y receta, con su galería en el panel;
- una configuración clave/valor JSON, acotada y auditada;
- zonas de extensión explícitas para el comportamiento propio de cada organización.

Y mantiene viva la aplicación después de generarla:

- **evolución del esquema**: agregar entidades, campos o vistas escribe la migración siguiente, en
  vez de reescribir una ya aplicada, y los datos existentes sobreviven;
- **actualización de la plataforma**: una aplicación ya generada recibe las mejoras de la fábrica
  sin perder lo que la organización cambió.

La aplicación generada no llama a esta fábrica en producción.

## Para empezar

Hace falta Python 3.11 o superior para la fábrica, y Node.js 20 o superior más PostgreSQL para la
aplicación generada.

```bash
python scripts/test_scaffold.py
python scripts/scaffold_app.py \
  --spec references/example-maintenance.app-spec.json \
  --output ../maintenance-demo
python scripts/verify_scaffold.py ../maintenance-demo
```

Después, dentro del directorio generado:

```bash
cp .env.example .env.local
pnpm install
pnpm db:apply
pnpm db:smoke
pnpm dev
```

`ALLOW_UNSAFE_LOCAL_PREVIEW=true` es sólo para desarrollo local: habilita el selector de roles en
`/dev-access`, y producción siempre lo ignora.

Para que la aplicación opere procesos, el AppSpec declara una línea, `"blocks": ["procesos"]`, y la
fábrica agrega las entidades `proceso` e `iteracion` con sus vistas y permisos. El ejemplo
ya la trae. El contrato está en [procesos e iteraciones](references/procesos.md).

## El ciclo de vida de una aplicación

| Momento | Comando | Referencia |
|---|---|---|
| Generar | `scripts/scaffold_app.py --spec <app-spec.json> --output <dir>` | [AppSpec v0](references/app-spec-v0.md) |
| Cambiar el esquema | `scripts/evolve_app.py --project <app> --spec <nueva-spec>` | [Evolución](references/evolution.md) |
| Recibir la plataforma nueva | `scripts/update_platform.py --project <app>` | [Contrato de extensión](references/extension-contract.md) |
| Desplegar | — | [Despliegue en Vercel](references/deployment-vercel.md) |
| Conectar agentes | `/agents` en la aplicación | [MCP](references/mcp.md) |

Los dos comandos que modifican una aplicación existente planifican primero y sólo escriben con
`--apply`. Lo que podría perder datos o pisar trabajo ajeno queda bloqueado, sin un flag para
forzarlo.

## De la validación local a producción

El camino de producción soportado usa Vercel, PostgreSQL y Clerk, pero el código generado sigue
siendo portable. Un despliegue no está terminado hasta haber verificado las migraciones, el primer
administrador, el acceso sólo por invitación, los permisos, el estado de salud y un recorrido
autenticado por el navegador.

Leé el [manual de despliegue en Vercel](references/deployment-vercel.md) completo antes de desplegar.
La aplicación generada incluye además su propio `RUNTIME.md` y su `.env.example`, así que sigue
siendo operable después de salir de este repositorio.

## La frontera de la arquitectura

Tres zonas de propiedad:

| Zona | Qué abarca | Dueño |
|---|---|---|
| Generada | `src/generated/`, `database/generated/` | Se compila desde `app-spec.json` |
| Plataforma | `src/platform/`, `src/lib/`, `src/app/`, `src/components/`, `scripts/`, `database/platform/` y los archivos de configuración de la raíz | Viaja y se actualiza con la fábrica |
| Organización | `src/features/`, `src/components/custom/`, `src/app/api/custom/`, `database/custom/` | La aplicación; la fábrica nunca escribe acá |

- `app-spec.json` es la fuente de verdad de todo lo generado.
- Regenerar o actualizar nunca pisa el comportamiento propio de la organización. Si un archivo de
  plataforma se editó localmente y la fábrica también lo cambió, la actualización frena y lo
  muestra.
- Para cambiar el comportamiento de la plataforma en una aplicación, se lo envuelve desde una
  feature; no se lo edita.
- Las integraciones, las escrituras a sistemas externos y los cálculos de dominio van en la zona de
  la organización, con adaptadores revisados.

El detalle de cada zona está en el [contrato de extensión](references/extension-contract.md).

## El alcance del panel

La interfaz de la aplicación es deliberadamente simple, y tiene un alcance acotado en vez de un
techo fijo. Existe para tres cosas:

- que opere quien no trabaja con IA;
- que el cliente pida, siga, apruebe y reciba;
- que se vea lo que hicieron las personas y los agentes.

El menú se arma por lo que la persona viene a hacer: Trabajo (sus pendientes y los procesos),
Operación (las vistas del dominio), Datos (las entidades sin vista propia, plegadas) y Sistema.
Todo lo de un proceso —cómo se hace, lo que está en curso, las veces que se hizo y cómo rinde—
está en su página, no repartido en el menú. Cada vista abre con su
`description`: para qué sirve y qué se hace ahí. El inicio dice por dónde empezar según el rol.

Lo que no cae en ninguna de las tres va a la API, al MCP y al esquema. Quedan fuera de alcance un
editor visual de procesos, un constructor libre de páginas o formularios, y pantallas que repitan lo
que ya resuelve una vista generada. Agregar una pantalla a la plataforma necesita una decisión
explícita de quien mantiene el proyecto.

## Seguridad y propiedad de los datos

Nunca subas al repositorio `.env.local`, credenciales de proveedores, URLs de base de datos ni
secretos de Clerk.

Una migración que borra datos no se aplica sola durante un despliegue: la guarda le pregunta a la
base si hay algo que perder y, si lo hay, frena hasta que una persona autorice esa migración por
nombre.

**Cada acción tiene una persona responsable**, incluso cuando la hizo un agente: una credencial no
actúa por sí sola, actúa en nombre de alguien, y un agente nunca excede los permisos de esa persona.
Desactivar a una persona corta las credenciales de sus agentes.

**Permisos por registro.** Los permisos de la AppSpec responden "¿este rol puede modificar
compromisos?". Una entidad puede además declarar `record_access` para responder la otra mitad:
*cuáles*. Se nombra el campo que dice de quién es el registro y el alcance de cada rol.

```json
"record_access": {
  "owner_field": "responsable",
  "roles": { "director": "all", "socio": "own" }
}
```

Tres decisiones separan un control de un adorno:

- **Falla cerrado.** Si una entidad declara política y la consulta llega sin identidad, el sistema
  lanza en vez de asumir "todos": un olvido rompe la pantalla, nunca abre los datos.
- **El silencio no concede.** Un rol que la política no menciona no ve nada.
- **"No existe" y "no es tuyo" dan la misma respuesta.** Distinguirlas confirmaría que el registro
  existe, que es justo lo que el alcance oculta.

El filtro vive en el repositorio, el único lugar donde se arma SQL contra las tablas de entidades, y
alcanza a leer, listar, contar, exportar, crear, modificar, borrar, los desplegables de relación, la
vista previa de importación y los adjuntos. Dos pruebas lo sostienen: una recorre el código y exige
alcance en todo camino que llega a los datos; la otra (`pnpm db:access`) siembra dos personas en
PostgreSQL y comprueba que una no vea, modifique ni borre lo de la otra.

**El equipo ve el trabajo, no las conversaciones.** La plataforma guarda procesos, iteraciones,
recetas y dónde quedó cada cosa, y un enlace a la conversación de origen, nunca el chat en sí.

El respaldo del código no reemplaza al respaldo de la base. El código vive en GitHub, los datos en
PostgreSQL, la configuración del despliegue en el proveedor de hosting y la de identidad en Clerk.
Cada capa necesita su propio plan de recuperación.

Leé [SECURITY.md](SECURITY.md) antes de reportar una vulnerabilidad.

## Estado del proyecto

Claude App Factory es una base temprana, usada en operación real. No es un producto no-code alojado
ni una garantía general de que lo generado esté listo para producción.

**Construido y verificado en CI en cada push:** el compilador es determinista y tiene pruebas; la
aplicación generada chequea tipos y compila; las migraciones se aplican contra un PostgreSQL real y
son idempotentes; cada entidad sobrevive a una prueba de ABM; la guarda de migraciones destructivas
frena cuando hay datos; el alcance por registro se comprueba con dos personas reales en la base; las
instrucciones MCP se componen por rol; las definiciones de proceso y las iteraciones se validan; una
evolución del esquema conserva los datos existentes; y una aplicación generada con la versión
anterior de la fábrica se actualiza a la actual.

**Todavía no construido:**

- que el servidor compruebe por sí mismo la carpeta de Dropbox de una iteración;
- relaciones `many_to_many`.

El motor de etapas de las versiones 1.x, retirado en la 2.0, queda descripto en
[su diseño original](references/process-engine.md).

Las contribuciones más seguras son las que mejoran la neutralidad, el determinismo, la portabilidad,
la seguridad o la verificación sin introducir multi-tenencia compartida. Empezá por
[CONTRIBUTING.md](CONTRIBUTING.md).

## Origen

Este proyecto empezó como [riel-app-factory](https://github.com/pcanete/riel-app-factory), escrito con
OpenAI Codex, y sigue acá como la línea Claude: misma licencia MIT y mismo autor, desarrollado y
mantenido de forma independiente. Los dos son motores de la misma idea, y ninguno lee ni escribe sobre
el otro. La historia anterior al commit de zonas de propiedad pertenece al repositorio original.

## Estructura del repositorio

```text
SKILL.md                     Instrucciones de la skill del agente
references/                  Contratos de AppSpec, procesos, MCP, extensión y despliegue
scripts/                     Compilador, evolución, actualización y verificación
assets/runtime-nextjs/       Runtime portable de la aplicación generada
skills/                      Skills complementarias, como la evolución del esquema
```

## Licencia

[MIT](LICENSE) — usá, modificá y distribuí el proyecto con atribución y sin garantía.
