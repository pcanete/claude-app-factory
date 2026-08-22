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
- Los archivos de migración no deben abrir su propia transacción. `scripts/apply-migrations.mjs` envuelve cada archivo junto con su entrada en el registro dentro de una sola transacción, así la migración y la constancia de que corrió se confirman o se descartan juntas.
- Las migraciones aplicadas tienen suma de control: editar una después de que corrió se rechaza, no se reaplica en silencio.
- Los cambios de esquema destructivos requieren revisión explícita y un plan de reversión o de migración de datos.

## Independencia

Cada proyecto generado tiene que poder correr desde su propio repositorio y con sus variables de entorno documentadas. Puede usar paquetes de código abierto corrientes o la infraestructura que elija, pero no puede llamar a Claude App Factory en tiempo de ejecución.
