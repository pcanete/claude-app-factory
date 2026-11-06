# Contrato de extensión

La fábrica es dueña de la estructura; el código del cliente es dueño del comportamiento que no se puede expresar con seguridad como metadato neutral.

## Zonas de propiedad

Son tres zonas, no dos. Meter el código de plataforma dentro de la zona del cliente es exactamente lo que vuelve imposible actualizar una aplicación más adelante.

**Generada** — se compila desde `app-spec.json` y se reemplaza en cada build:

- `src/generated/`
- `database/generated/`
- `BUILD_REPORT.md`

**Plataforma** — viaja con la fábrica, la actualiza la fábrica, nunca se edita por cliente:

- `src/platform/` (adaptador de identidad, configuración de la aplicación, administración de usuarios, servidor MCP para agentes)
- `database/platform/` (migraciones `100`–`499` que sostienen esas funciones, incluidas las identidades de agente y su registro de actividad)
- `src/lib/`, `src/app/` y `src/components/`, salvo `src/components/custom/`
- `scripts/`

Los tres últimos merecen una aclaración, porque durante un tiempo no estuvieron declarados y eso hizo
difícil la primera actualización real: **son de la fábrica**. Contienen el runtime, las páginas y los
componentes que se copian en cada generación. Que no lleven `platform` en el nombre no los vuelve del
cliente; el comportamiento propio va en `src/features/` y `src/components/custom/`, que sí lo son.

**Cliente** — es de las personas y los agentes que trabajan para ese cliente, y la fábrica nunca escribe acá:

- `src/features/`
- `src/components/custom/`
- `database/custom/` (migraciones desde la `500` en adelante)
- la configuración de despliegue que contiene decisiones del cliente

Nunca edites archivos generados o de plataforma para agregar comportamiento del cliente. Agregá un módulo de feature y registralo por un punto de extensión explícito. Un compilador posterior puede reemplazar todo lo generado y lo de plataforma sin leer ni reescribir las features.

Para cambiar el comportamiento de la plataforma, importalo desde una feature y envolvelo. Para cambiar la estructura generada, cambiá el AppSpec y recompilá.

## Qué va en el AppSpec

- entidades, campos, relaciones;
- validaciones y permisos estándar;
- vistas y navegación estándar;
- la intención de negocio estable y declarativa;
- condiciones deterministas previas a una mutación, con las acciones revisadas `set` y `block`;
- políticas acotadas de adjuntos por registro, con el adaptador de PostgreSQL incorporado;
- definiciones deterministas de vistas de tabla, kanban, calendario y tablero;
- qué roles tienen capacidades administrativas (`manage_users`, `view_audit`, `view_rules`);
- ediciones masivas en tablas y movimientos en kanban y calendario: acotados, opcionales, y reutilizando permisos, reglas, transacciones y auditoría.

## Qué va en una feature

- cálculos de dominio y puntajes;
- integraciones con terceros;
- flujos de varios pasos y aprobaciones;
- reportes especializados;
- herramientas y prompts de IA;
- interfaces a medida;
- adaptadores de almacenamiento para archivos grandes, subida directa, antivirus, OCR o proveedores específicos;
- efectos hacia afuera, como correo, pagos o escrituras en sistemas externos;
- la política de invitaciones propia del cliente, envolviendo el adaptador de identidad de la plataforma.

## Evolución de la base de datos

- Las migraciones generadas y de plataforma son inmutables una vez desplegadas. **Esto incluye a las
  migraciones de plataforma de la propia fábrica**: cuando una versión sale, editar
  `database/platform/1xx_*.sql` rompe toda aplicación que ya la aplicó, porque su suma de control deja
  de coincidir con el registro. Un cambio en el comportamiento de la plataforma va en la migración de
  plataforma numerada siguiente, nunca en una que ya existe.
- Los cambios en el AppSpec crean una migración nueva; no reescriben una migración aplicada.
- Las migraciones propias empiezan en `500`, así siempre se aplican después de las generadas y las de plataforma, y tienen que declarar sus dependencias.
- **Una migración que destruye datos no se aplica sola durante un despliegue.** El runner de migraciones
  corre dentro del build, lo cual es seguro mientras las migraciones sólo agreguen.
  `scripts/destructive-guard.mjs` revisa cada migración pendiente en busca de `DROP TABLE`, `TRUNCATE`,
  `DROP COLUMN`, `DELETE` sin `WHERE` y `DROP SCHEMA`/`DROP DATABASE`, y después le pregunta a la base si
  hay algo que perder. Soltar una tabla que no existe, o una que existe y está vacía, despliega normal;
  soltar una tabla que tiene filas detiene el despliegue. Todo lo que no pueda resolver —un nombre que no
  se puede interpretar, una consulta que falla— cuenta como riesgo, no como permiso.
- Para autorizar la destrucción, nombrá la migración explícitamente:
  `ALLOW_DESTRUCTIVE_MIGRATIONS="custom/501_x.sql"`. La autorización es por migración, nunca un
  interruptor general, así que no puede quedar prendida por descuido. Retirar una función son dos
  despliegues, no uno: primero desacoplar el código y desplegar, después borrar los datos como paso
  separado y con respaldo.
- **Una migración de plataforma no puede dejar el pasado en un estado que su propia función declara
  inválido.** Si agrega una columna que el runtime va a exigir, tiene que completarla para los
  registros que ya existen, derivándola de lo que la base ya sabe. Una actualización que deja
  huérfano lo anterior no corrige el problema: lo divide en dos.
- **Y no declara `NOT NULL` cuando una instalación legítima todavía no puede completar el valor.** Una
  migración que falla deja la aplicación sin desplegar, que es peor que un dato incompleto. La
  exigencia va en el runtime, y un índice parcial deja ver lo que quedó pendiente.
- Los archivos de migración no deben abrir su propia transacción. `scripts/apply-migrations.mjs` envuelve cada archivo junto con su entrada en el registro dentro de una sola transacción, así la migración y la constancia de que corrió se confirman o se descartan juntas.
- Las migraciones aplicadas tienen suma de control: editar una después de que corrió se rechaza, no se reaplica en silencio.
- Los cambios de esquema destructivos requieren revisión explícita y un plan de reversión o de migración de datos.

## Actualizar la plataforma de una aplicación ya generada

La evolución resuelve «cambió lo que el cliente necesita». Esto resuelve «mejoró la fábrica»:
sin un actualizador, cada aplicación desplegada se queda con la plataforma con la que nació, y
cada organización nueva es una copia que se desactualiza.

```bash
python scripts/update_platform.py --project <ruta-de-la-aplicacion>            # el plan
python scripts/update_platform.py --project <ruta-de-la-aplicacion> --apply    # aplicarlo
```

### El manifiesto

Cada aplicación lleva un `platform-manifest.json` con la versión de plataforma instalada, la
suma de control de cada archivo de fábrica **tal como salió de fábrica** y lo que la fábrica
declaró en `package.json`. Sin eso, un archivo que difiere puede ser dos cosas opuestas --la
fábrica avanzó, o el cliente lo editó-- y quien actualiza tiene que elegir entre pisar trabajo
ajeno o revisar el árbol entero a mano.

Son de plataforma los árboles `src/lib`, `src/app`, `src/components`, `src/platform`, `scripts`,
`database/platform`, `.github/workflows` y `public` (salvo `src/components/custom` y
`src/app/api/custom`), y los archivos `src/proxy.ts`, `next.config.ts`, `tsconfig.json`,
`Dockerfile`, `compose.yaml`, `pnpm-workspace.yaml`, `.env.example`, `.gitattributes` y
`.gitignore`. Un archivo que el cliente agrega dentro de esos árboles es suyo: la fábrica nunca
lo tuvo y la actualización no lo toca.

### Qué decide para cada archivo

| Estado | Qué significa | Qué hace |
|---|---|---|
| al día | coincide con la fábrica | nada |
| se puede reemplazar | intacto desde la generación, y la fábrica avanzó | lo reemplaza |
| nuevo de la fábrica | no existe en la aplicación | lo agrega |
| retirado | la fábrica lo quitó y la aplicación lo tiene intacto | lo borra |
| modificado localmente | el cliente lo editó, la fábrica no | lo conserva |
| **modificado de los dos lados** | el cliente lo editó y la fábrica también | se detiene sin escribir nada |
| sin registro | difiere y el manifiesto no lo conoce | lo conserva: no hay forma de saber de quién es |
| **bloqueado** | la fábrica cambió o quitó una migración de plataforma publicada | se detiene: es un error de la fábrica |

Un archivo conservado guarda en el manifiesto la suma anterior, así sigue figurando como
modificado hasta que alguien lo resuelva. Con `--conservar-locales` la actualización sigue
aunque haya conflictos y los deja como están.

### Lo que no es un archivo

- **`package.json` se combina.** Lo que declara la fábrica se actualiza; lo que la fábrica dejó
  de declarar se quita si el cliente no lo cambió; lo que agregó el cliente queda. `name` y
  `version` son de la aplicación.
- **El lockfile** se copia sólo si la aplicación no tiene dependencias propias. Si las tiene,
  el lockfile de fábrica no las conoce y hay que regenerarlo con `pnpm install`.
- **`src/generated/`** se vuelve a compilar desde la `app-spec.json` de la aplicación, porque la
  plataforma nueva puede esperar otra forma de lo generado. `database/generated/` no se toca
  nunca: esas migraciones ya corrieron.
- **Las migraciones de plataforma nuevas** se listan, no se aplican.
- **Las variables de entorno** que la versión nueva lee y la instalada no, se avisan.

### Lo que exige

- Un árbol git limpio, para que la actualización quede como un cambio aparte y se pueda deshacer.
- Que la `app-spec.json` valide con la fábrica nueva.
- Que la versión instalada no sea más nueva que la de la fábrica.

Después: `pnpm install` si cambió `package.json`, `pnpm db:apply` primero contra una base de
prueba, `pnpm typecheck`, y desplegar comprobando contra la aplicación corriendo.

`check_platform.py` muestra la misma comparación sin el resto del plan, y termina con código 1
si hay conflictos o bloqueos, así que sirve como control previo en cualquier automatización.
Una aplicación generada antes de que existiera el manifiesto puede adoptarlo con
`check_platform.py --adopt`, que sólo procede si todo coincide con la fábrica.

## Independencia

Cada proyecto generado tiene que poder correr desde su propio repositorio y con sus variables de entorno documentadas. Puede usar paquetes de código abierto corrientes o la infraestructura que elija, pero no puede llamar a Claude App Factory en tiempo de ejecución.
