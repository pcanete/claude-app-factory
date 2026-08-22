# Manual de despliegue en Vercel

Usá este manual para el camino soportado: Vercel + PostgreSQL gestionado + Clerk. La aplicación generada es portable; estos servicios son adaptadores de despliegue, no dependencias de la fábrica en tiempo de ejecución.

## 1. Congelá una revisión verificada del código

Antes de crear recursos en la nube:

- validá el AppSpec y corré `python scripts/test_scaffold.py`;
- generá en un directorio nuevo o vacío y corré `python scripts/verify_scaffold.py <directorio>`;
- instalá las dependencias con el lockfile y corré `pnpm typecheck` o `pnpm build`;
- aplicá las migraciones contra una base PostgreSQL descartable con `pnpm db:apply`;
- corré `pnpm db:smoke` y verificá un camino de ABM completo en un navegador real;
- hacé commit del código, el lockfile, las migraciones generadas y la documentación, pero nunca de archivos de entorno ni secretos.

No despliegues directo desde un árbol de trabajo sin commitear.

## 2. Aprovisioná una aplicación independiente

Creá un proyecto de Vercel, una base de datos, una aplicación de Clerk y un juego de credenciales para la aplicación generada. No compartas estos recursos entre clientes que no tienen relación.

Conectá el repositorio de GitHub a Vercel y poné Next.js como framework. Conservá el comando `vercel-build` generado: en producción aplica migraciones idempotentes, da de alta al administrador pendiente cuando está configurado y después ejecuta `next build`. Los builds de vista previa no modifican la base de producción.

## 3. Configurá las variables de entorno

Mantené cada valor en el menor alcance de entornos de Vercel que haga falta.

| Variable | Alcance | Para qué |
|---|---|---|
| `DATABASE_URL` | Producción, runtime | Conexión con pooler que usa la aplicación. Una integración de PostgreSQL del marketplace de Vercel inyecta `POSTGRES_URL` en su lugar, que el runtime también acepta |
| `DATABASE_URL_DIRECT` | Producción, build | Conexión directa, sin pooler, preferida para las migraciones (también se acepta `POSTGRES_URL_NON_POOLING`) |
| `DATABASE_CA_CERT` o `DATABASE_SSL` | Producción | TLS contra un PostgreSQL gestionado. Sin alguna de las dos, los proveedores que firman con su propia autoridad fallan con `SELF_SIGNED_CERT_IN_CHAIN`. Usá acá el certificado en línea, nunca `DATABASE_CA_CERT_FILE`: una ruta relativa no resuelve en el runtime serverless y el despliegue queda arriba pero sin poder llegar a su base |
| `NEXT_PUBLIC_APP_URL` | Producción | Origen canónico de la aplicación, usado en los enlaces |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Producción | Identificador público de la aplicación de Clerk |
| `CLERK_SECRET_KEY` | Producción, sensible | Operaciones de Clerk del lado del servidor |
| `BOOTSTRAP_ADMIN_EMAIL` | Producción | Correo del primer administrador pendiente |
| `BOOTSTRAP_ADMIN_NAME` | Producción | Nombre visible opcional de ese administrador |

Nunca configures `ALLOW_UNSAFE_LOCAL_PREVIEW=true` en Vercel. Producción lo ignora, pero su presencia genera un estado operativo engañoso.

`ALLOW_DESTRUCTIVE_MIGRATIONS` tampoco se deja configurada. Es una autorización puntual, para un despliegue puntual, y se quita después: si queda fija, la guarda que impide que un `git push` borre datos deja de existir.

## 4. Cerrá la identidad antes de abrir el acceso

- Configurá Clerk para acceso sólo por invitación.
- Poné el mismo correo verificado en `BOOTSTRAP_ADMIN_EMAIL` y en la primera invitación o identidad de Clerk.
- Desplegá mientras la aplicación siga privada o inaccesible para quien no fue invitado.
- Iniciá sesión como primer administrador y confirmá que la identidad pendiente en PostgreSQL se vincula con el sujeto estable de Clerk.
- Creá los usuarios siguientes desde `/users`; PostgreSQL sigue siendo la autoridad sobre el estado activo y el rol.

Clerk prueba la identidad. No reemplaza la verificación de permisos en el servidor ni el registro en `app_user`.

## 5. Desplegá y verificá la historia completa

Un build en verde es necesario pero no alcanza. Verificá todo esto contra la URL de producción:

1. Vercel reporta el despliegue como listo y los logs del build muestran las migraciones esperadas.
2. `GET /api/health` devuelve `200` y confirma el acceso a la base sin exponer secretos.
3. Una visita sin autenticar es redirigida al inicio de sesión y no puede leer datos de la aplicación.
4. El administrador invitado puede entrar y llega a la aplicación con el rol esperado.
5. Un camino representativo de alta, lectura, modificación y baja respeta los permisos y escribe eventos de auditoría.
6. `/users` permite invitar o dejar preparado a un usuario sin habilitar la autodesactivación ni cambios de rol no autorizados.
7. `/settings` guarda una opción y la muestra en el listado con su autor.
8. Si hay agentes, una credencial MCP opera dentro de su alcance y su actividad aparece en `/agents`.
9. Los logs del runtime no tienen ningún error sin manejar en el recorrido verificado.

Registrá el commit de origen, la URL del despliegue de producción, el resultado de las migraciones y la fecha de verificación en la entrega.

## 6. Recuperación y portabilidad

- Una reversión en Vercel revierte el código, no PostgreSQL. Preferí migraciones aditivas y compatibles hacia atrás; los cambios destructivos requieren una migración de datos explícita, respaldo y plan de reversión.
- Configurá los respaldos o la recuperación a un punto en el tiempo que correspondan a los datos del cliente, y probá una restauración antes de afirmar que se puede recuperar.
- Exportá o documentá la configuración de Clerk y quién es responsable de recuperarla.
- Mantené inventariadas las variables de entorno del despliegue sin copiar sus valores secretos a GitHub.

Si Vercel desaparece, la aplicación Next.js commiteada puede correr en cualquier otro host compatible con Node. Si la fábrica desaparece, cada aplicación generada sigue conteniendo su código corriente, sus migraciones, su AppSpec y su documentación de runtime.

## Condiciones de freno

No declares el despliegue listo para producción mientras alguna de estas siga sin resolver:

- la rama por defecto no contiene el código desplegado;
- hay un secreto o un registro de cliente en el historial de Git;
- la autenticación permite registro público sin que se haya querido;
- no se probaron los permisos del servidor ni el vínculo del primer administrador;
- las migraciones son destructivas o no tienen plan de recuperación;
- no se sabe quién es responsable de recuperar la base de datos;
- no se revisaron la salud, los logs y un recorrido autenticado por el navegador.
