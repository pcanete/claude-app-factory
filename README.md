# Claude App Factory

Claude App Factory convierte un pedido de negocio en la base de una aplicación independiente, de un solo cliente. Modela el pedido como un **AppSpec** y genera código Next.js y PostgreSQL corriente, que se puede extender, desplegar y mantener sin depender de la fábrica en tiempo de ejecución.

No presupone que la aplicación sea un CRM, un ERP ni ningún otro vertical.

## Origen

Este proyecto empezó como [riel-app-factory](https://github.com/pcanete/riel-app-factory), escrito con
OpenAI Codex, y sigue acá como la línea Claude: misma licencia MIT y mismo autor, desarrollado y
mantenido de forma independiente. Los dos son motores de la misma idea, y ninguno lee ni escribe sobre
el otro. La historia anterior al commit de zonas de propiedad pertenece al repositorio original.

## Qué genera

- entidades, campos, relaciones, roles y permisos verificados en el servidor;
- migraciones de PostgreSQL, ABM auditado, importación y exportación, y archivos adjuntos;
- vistas de tabla, kanban, calendario y tablero;
- reglas de validación y de mutación deterministas;
- autenticación con Clerk y administración de usuarios en la aplicación;
- una primitiva de configuración clave/valor con valores JSON, acotada y auditada;
- zonas de extensión explícitas para el comportamiento propio de cada cliente;
- un endpoint MCP donde los agentes se autentican con credenciales propias —hasheadas, con vencimiento y con alcance—, leen y escriben bajo los permisos que el AppSpec le da a su rol, y dejan rastro por herramienta;
- evolución incremental del esquema, que escribe la migración siguiente en vez de reescribir una ya aplicada.

Cada aplicación de cliente tiene su propio repositorio, su base de datos, su despliegue, sus credenciales y su ciclo de vida. La aplicación generada no llama a Claude App Factory en producción.

## Para empezar

Hace falta Python 3.11 o superior para la fábrica, y Node.js 20 o superior más PostgreSQL para la aplicación generada.

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

`ALLOW_UNSAFE_LOCAL_PREVIEW=true` es sólo para desarrollo local: habilita el selector de roles en `/dev-access`, y producción siempre lo ignora.

## De la validación local a producción

El camino de producción soportado usa Vercel, PostgreSQL y Clerk, pero el código generado sigue siendo portable. Un despliegue no está terminado hasta haber verificado las migraciones, el primer administrador, el acceso sólo por invitación, los permisos, el estado de salud y un recorrido autenticado por el navegador.

Leé el [manual de despliegue en Vercel](references/deployment-vercel.md) completo antes de desplegar. La aplicación generada incluye además su propio `RUNTIME.md` y su `.env.example`, así que sigue siendo operable después de salir de este repositorio.

## La frontera de la arquitectura

Tres zonas de propiedad:

| Zona | Directorios | Dueño |
|---|---|---|
| Generada | `src/generated/`, `database/generated/` | Se compila desde `app-spec.json`; se reemplaza en cada build |
| Plataforma | `src/platform/`, `database/platform/` | Viaja y se actualiza con la fábrica; nunca se edita por cliente |
| Cliente | `src/features/`, `src/components/custom/`, `database/custom/` | La aplicación; la fábrica nunca escribe acá |

- `app-spec.json` es la fuente de verdad de todo lo generado.
- Regenerar nunca puede pisar el comportamiento propio del cliente.
- Para cambiar el comportamiento de la plataforma en un cliente, se lo envuelve desde una feature; no se lo edita.
- Las integraciones, las aprobaciones, las escrituras a sistemas externos y los cálculos de dominio necesitan adaptadores revisados en la zona de cliente.

La evolución del esquema está implementada: `scripts/evolve_app.py` planifica un cambio, informa qué queda bloqueado y, con `--apply`, escribe la migración siguiente y refresca sólo los artefactos que son de la fábrica. Ver [evolución del AppSpec](references/evolution.md).

Ver también [AppSpec v0](references/app-spec-v0.md) y el [contrato de extensión](references/extension-contract.md).

## Estructura del repositorio

```text
SKILL.md                     Instrucciones de la skill del agente
references/                  Contratos de AppSpec, extensión y despliegue
scripts/                     Compilador determinista y verificación
assets/runtime-nextjs/       Runtime portable de la aplicación generada
```

En cada push, CI valida cuatro cosas: las pruebas del compilador; el chequeo de tipos y el build de
producción de la aplicación generada; las migraciones aplicadas contra un PostgreSQL real con una
prueba de ABM sobre cada entidad; y una evolución completa que carga datos, cambia el esquema y
comprueba que esos datos siguen ahí.

## Seguridad y propiedad de los datos

Nunca subas al repositorio `.env.local`, credenciales de proveedores, URLs de base de datos ni secretos de Clerk.

Una migración que borra datos no se aplica sola durante un despliegue: la guarda le pregunta a la base
si hay algo que perder y, si lo hay, frena hasta que una persona autorice esa migración por nombre.

El respaldo del código no reemplaza al respaldo de la base. El código vive en GitHub, los datos de la aplicación en PostgreSQL, la configuración del despliegue en el proveedor de hosting y la configuración de identidad en Clerk. Cada capa necesita su propio plan de recuperación.

Leé [SECURITY.md](SECURITY.md) antes de reportar una vulnerabilidad.

## Estado del proyecto

Claude App Factory es una base temprana. No es un producto no-code alojado ni una garantía general de
que lo generado esté listo para producción.

Lo que está probado hoy: el compilador es determinista y tiene pruebas; la aplicación generada
chequea tipos y compila; las migraciones generadas se aplican contra un PostgreSQL real; cada entidad
generada sobrevive a una prueba de ABM; y una evolución del esquema conserva los datos que ya
existían. Todo eso lo verifica CI en cada push.

Lo que todavía no está construido: actualizar la zona de plataforma de una aplicación ya generada sin
copiar archivos a mano, los permisos a nivel de registro y las relaciones `many_to_many`. Cada
limitación está documentada donde importa, en vez de dejar creer que funciona.

Las contribuciones más seguras son las que mejoran la neutralidad, el determinismo, la portabilidad,
la seguridad o la verificación sin introducir multi-tenencia compartida.

Las contribuciones son bienvenidas; empezá por [CONTRIBUTING.md](CONTRIBUTING.md).

## Licencia

[MIT](LICENSE) — usá, modificá y distribuí el proyecto con atribución y sin garantía.
