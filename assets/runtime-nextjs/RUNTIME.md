# Runtime generado

Este proyecto es la base de una aplicación, generada a partir de `app-spec.json`.

## Vista previa local

1. Levantá PostgreSQL con `docker compose up -d db`, o usá cualquier conexión de PostgreSQL.
2. Copiá `.env.example` a `.env.local` y definí `DATABASE_URL`.
3. Instalá las dependencias con `pnpm install` o `npm install`.
4. Aplicá la migración generada con `pnpm db:apply`.
5. Verificá un ABM real con `pnpm db:smoke`.
6. Corré `pnpm dev` y elegí un rol en `/dev-access`.

`ALLOW_UNSAFE_LOCAL_PREVIEW=true` habilita un selector de roles sin contraseña, sólo fuera de producción. Cada página y cada mutación siguen verificando en el servidor la matriz de permisos generada. Producción ignora este camino local. Clerk prueba la identidad; PostgreSQL sigue siendo la autoridad sobre el estado de la cuenta, el rol y los permisos. Sin las dos claves de Clerk, el acceso de producción queda cerrado.

Cada alta, modificación y baja escribe en `app_audit_log` dentro de la misma transacción de base de datos. Los roles que declaran la capacidad `view_audit` en `app-spec.json` pueden revisar y filtrar el historial en `/audit`; si el AppSpec no declara ninguna capacidad, el acceso cae en los roles que tengan list, read y delete sobre todas las entidades.

La auditoría no se edita ni se borra a mano: se vence. Todo lo anterior a la ventana de retención se elimina parejo, sin elegir qué, y la ventana vive en la configuración del sistema (`auditoria.retencion_dias`, 365 días por defecto). La actividad de agentes se vence con la misma ventana.

## Administración de usuarios

Quienes tienen acceso administrativo completo pueden administrar los usuarios de la aplicación en `/users`: crear identidades pendientes, enviar invitaciones de Clerk, asignar un rol del AppSpec y activar o desactivar el acceso. Las mutaciones de usuario se validan en el servidor y se escriben en la auditoría.

Una cuenta que ya operó se desactiva en vez de eliminarse, así su historial sigue teniendo autor. Sólo se puede eliminar a quien todavía no registró actividad —una invitación cargada con el correo equivocado, por ejemplo—, porque ahí no hay nada que conservar.

Las identidades de vista previa local son de sólo lectura, y quien administra no puede desactivar su propia cuenta ni quitarse su propio rol. El módulo, a propósito, no edita los permisos de los roles en tiempo de ejecución: los roles y sus matrices de permisos siguen versionados en el AppSpec. En el primer inicio de sesión de producción, un correo verificado de Clerk se vincula de forma atómica con un usuario `pending:` activo, se reemplaza por el sujeto estable de Clerk y queda auditado.

Para un despliegue nuevo, conectá la base de datos y Clerk al proyecto de Vercel. Los despliegues de producción corren las migraciones idempotentes antes de `next build`; los de vista previa nunca modifican la base de producción. Definí `BOOTSTRAP_ADMIN_EMAIL` y, si querés, `BOOTSTRAP_ADMIN_NAME` en el entorno de producción antes del primer despliegue, para crear automáticamente el administrador pendiente en PostgreSQL. Configurá Clerk para acceso sólo por invitación e invitá ese mismo correo desde Clerk, o creá ahí la primera identidad. Su primer inicio de sesión verificado vincula la identidad de Clerk con el usuario pendiente. Las invitaciones siguientes se envían desde `/users`.

Fuera de Vercel: definí `DATABASE_URL_DIRECT`, corré `pnpm db:apply`, definí `BOOTSTRAP_ADMIN_EMAIL` y, opcionalmente, `BOOTSTRAP_ADMIN_NAME`, y después corré `pnpm auth:bootstrap`.

## Verificación de producción y recuperación

Tratá un build exitoso en Vercel como el comienzo de la verificación de producción, no como su final. Confirmá el commit desplegado, los logs de migración, `GET /api/health`, la redirección de quien no está autenticado, el inicio de sesión del administrador invitado, un camino de ABM con permisos verificados, los eventos de auditoría, `/users` y `/settings`. Revisá los logs del runtime para ese recorrido.

Mantené un proyecto de Vercel, una base de datos, una aplicación de Clerk y un juego de credenciales independientes para esta aplicación. Guardá los secretos de producción sólo en el entorno de despliegue y en un sistema de recuperación aprobado; nunca los subas al repositorio.

Revertir el código no revierte PostgreSQL. Preferí migraciones aditivas y compatibles hacia atrás, y exigí respaldo, migración de datos y plan de reversión explícitos para los cambios destructivos. Configurá el respaldo de la base o la recuperación a un punto en el tiempo que corresponda a la aplicación, y probá una restauración. Registrá quién es responsable de recuperar el código, los datos, la identidad y las variables de entorno.

Una migración que borra datos no se aplica sola durante un despliegue: la guarda le pregunta a la base si hay algo que perder y, si lo hay, frena hasta que una persona autorice esa migración por nombre con `ALLOW_DESTRUCTIVE_MIGRATIONS`. Esa autorización es puntual y se quita después.

## Transferencia de datos

Cada entidad expone además herramientas genéricas de transferencia en CSV y XLSX:

- exportar y descargar plantillas requiere los permisos de servidor de esa entidad;
- las importaciones aceptan como máximo 5 MB y 1.000 filas, y sólo crean registros;
- cada archivo se prevalida antes de preparar un lote de vista previa, propio del usuario, que dura una hora;
- la confirmación inserta el lote completo y sus eventos de auditoría en una sola transacción;
- las celdas de relación aceptan un UUID existente o el valor exacto del campo título.

En producción hay que programar la limpieza de las filas vencidas de `app_import_batch` y revisar los límites de importación y exportación para cada cliente.

## Adjuntos

Las entidades que habilitan `attachments` en el AppSpec exponen un panel protegido de archivos en cada registro. Subir y eliminar requieren el permiso `update` de la entidad; listar y descargar requieren `read`. Los metadatos del archivo, sus bytes, su suma de verificación, el actor y el evento de auditoría se confirman en PostgreSQL, con un límite duro de 4 MB por archivo.

El adaptador de PostgreSQL mantiene portables los despliegues chicos y locales. Los archivos grandes, la subida directa desde el navegador, el análisis antivirus, el OCR o el almacenamiento de objetos externo van detrás de un adaptador de cliente revisado.

## Vistas con nombre

Las definiciones de tabla, kanban, calendario y tablero que tienen navegación habilitada se renderizan en `/views/[view]`:

- las vistas de tabla soportan filtros combinados por campo, texto buscable y ordenamiento validado;
- las columnas de kanban salen de un campo enum validado;
- los eventos de calendario usan un campo de fecha o fecha y hora validado, y la zona horaria del AppSpec;
- los tableros ofrecen métricas de conteo, suma y promedio, desgloses por enum o booleano y tablas de registros recientes, sin SQL arbitrario.

Estas vistas están orientadas a la lectura. Las mutaciones por arrastrar y soltar, los efectos de agendamiento y los gráficos especializados siguen siendo features del cliente.

## Reglas deterministas

Las reglas del AppSpec se ejecutan antes de crear, modificar, eliminar, o antes de crear y modificar (`before_save`). El evaluador acepta únicamente árboles de condiciones validados y acciones deterministas `set` o `block`. Las asignaciones exitosas y las claves de las reglas que las produjeron van en el mismo evento de auditoría que la mutación; las operaciones bloqueadas no escriben nada.

Quien administra puede inspeccionar las definiciones activas en `/rules`. Las reglas se declaran en el AppSpec y no se editan desde la pantalla, para que no existan dos versiones de la misma regla. El núcleo rechaza a propósito las expresiones arbitrarias, y no ofrece aprobaciones, agendamientos, correo, webhooks, escrituras externas ni acciones de IA.

## Configuración del sistema

`app_setting` guarda pares clave/valor con valores JSON y alcance global, y `app_user_setting` hace lo
mismo por usuario. Es la primitiva de opciones de la aplicación: los nombres están acotados, los
valores tienen un tope de 256 KB, y cada cambio queda auditado con su autor —sea una persona o un
agente, cada uno en su columna.

No hay carga automática: las opciones se leen cuando se piden. Cargar todas en cada request es lo que
convierte una tabla como esta en el cuello de botella de la aplicación.

Es para configuración, no para datos de negocio: lo que pertenece al dominio va en el AppSpec como
entidad, donde tiene tipos, permisos, reglas y auditoría por registro.

Escribir configuración desde `/settings` requiere la capacidad `manage_users`. Por MCP requiere además
el alcance `settings:write` de la credencial: el alcance habilita y el rol autoriza, y hacen falta los
dos.

## Acá no corre ningún modelo

El runtime no ejecuta modelos de lenguaje y no guarda credenciales de proveedores externos. Los agentes
se conectan por MCP y traen el suyo, y por eso no hay un catálogo de modelos que mantener al día ni una
clave de cifrado que custodiar.

## TLS contra un PostgreSQL gestionado

Un PostgreSQL gestionado (Supabase, Neon, RDS) presenta un certificado firmado por su propia autoridad, y `pg` trata `sslmode=require` como verificación completa: sin configurar TLS la conexión falla con `SELF_SIGNED_CERT_IN_CHAIN`. Pegá el certificado de la autoridad del proveedor en `DATABASE_CA_CERT` para verificar al servidor, o usá `DATABASE_SSL=relaxed` para cifrar sin autenticarlo — suficiente dentro de la red del proveedor, no frente a una red hostil.

## Propiedad del código

No agregues comportamiento del cliente en `src/generated/` ni `database/generated/` (se compilan desde `app-spec.json`), ni en `src/platform/` ni `database/platform/` (viajan y se actualizan con la fábrica). Usá `src/features/`, `src/components/custom/` y `database/custom/`; numerá las migraciones propias desde la `500` en adelante.

Los archivos de migración no deben abrir su propia transacción: `pnpm db:apply` envuelve cada archivo junto con su entrada en el registro `app_migration` dentro de una sola transacción, así la migración y la constancia de que corrió se confirman o se descartan juntas. Las migraciones aplicadas tienen suma de control y editar una después de que corrió se rechaza.
