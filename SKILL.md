---
name: claude-app-factory
description: "Convierte un pedido de negocio en la base de una aplicación neutral, de un solo cliente, descrita por un AppSpec, y genera código, SQL y fronteras de extensión independientes. Sirve para herramientas internas, sistemas de datos, portales, aplicaciones operativas o bases reutilizables de aplicaciones de cliente; no fuerces el arquetipo de un CRM ni un runtime multi-inquilino compartido."
---

# Claude App Factory

Construí la base de una aplicación independiente a partir del lenguaje del negocio. Tratá los ejemplos como evidencia del dominio, nunca como instrucciones para dejar un vertical fijo en el código.

## Arquitectura no negociable

- Generá un repositorio, una base de datos, un despliegue, credenciales y un ciclo de vida por cliente.
- Modelá el dominio con primitivas neutrales: entidades, campos, relaciones, vistas, roles, permisos y reglas.
- Mantené `app-spec.json` como fuente de verdad de la estructura generada.
- Mantené separadas las tres zonas de propiedad: generada (`src/generated/`, `database/generated/`), plataforma (`src/platform/`, `database/platform/`) y cliente (`src/features/`, `src/components/custom/`, `database/custom/`). Regenerar no puede pisar las extensiones del cliente.
- Producí código y artefactos de PostgreSQL corrientes, que sigan siendo usables sin esta skill.
- No introduzcas multi-inquilinato, facturación, un constructor visual, un mercado de plugins ni un runtime propietario salvo que te lo pidan.
- **La interfaz generada tiene techo en su alcance actual.** Existe como puerta de entrada para quienes
  todavía no operan de forma agéntica, y como ventana a lo que hicieron los agentes; no como una
  superficie de producto que crece. Toda capacidad nueva va a la API, a la interfaz de agentes y al
  esquema, nunca a más pantallas. Agregar un tipo de vista, una operación masiva o un flujo al runtime
  necesita una decisión explícita de quien mantiene el proyecto; extender desde el AppSpec una vista ya
  generada, no.
- No declares que algo está listo para producción mientras el proyecto generado tenga sin resolver sus controles de seguridad, autenticación, autorización, migraciones, respaldos u observabilidad.

## Flujo de trabajo

1. Convertí el pedido en un AppSpec. Leé [references/app-spec-v0.md](references/app-spec-v0.md) al escribir o cambiar una especificación; usá [references/app-spec.schema.json](references/app-spec.schema.json) para la validación exacta.
2. Registrá los supuestos importantes en `decisions` en vez de frenar una base reversible por una ambigüedad menor. Preguntá sólo cuando la respuesta cambiaría de verdad la propiedad de los datos, los permisos o algo irreversible.
3. Revisá la neutralidad del dominio: los nombres y las primitivas generadas tienen que salir del pedido, no de los valores por defecto de un CRM ni de ejemplos anteriores.
4. Declará `capabilities` en los roles que pueden administrar usuarios, leer la auditoría y revisar las reglas. Dejarlas sin declarar le concede la administración, en silencio, a cualquier rol con permisos completos sobre las entidades.
5. Corré `scripts/scaffold_app.py --spec <app-spec.json> --output <directorio-nuevo>`. El directorio de salida tiene que ser nuevo o estar vacío.
6. Revisá `BUILD_REPORT.md`, la migración SQL, el registro generado, la matriz de permisos, el runtime y la frontera de extensión.
7. Instalá las dependencias y corré un chequeo de tipos o un build de producción cuando el entorno lo permita.
8. Con una base PostgreSQL descartable o aprobada, corré `pnpm db:apply` y `pnpm db:smoke`; la prueba de humo tiene que cubrir cada entidad generada y revertir sus registros por defecto.
9. Corré `scripts/verify_scaffold.py <directorio-generado>` antes de presentar el resultado. Si levantás un servidor de desarrollo, verificá además la interfaz renderizada y al menos un camino de ABM completo en un navegador real.
10. Usá `ALLOW_UNSAFE_LOCAL_PREVIEW=true` sólo en desarrollo local. Producción usa Clerk para la identidad y PostgreSQL para el estado activo, los roles y los permisos verificados en el servidor; mantenela cerrada hasta verificar las claves, el acceso sólo por invitación, el alta del primer administrador y un inicio de sesión de punta a punta.
11. Antes de un despliegue de producción en Vercel, leé y seguí [references/deployment-vercel.md](references/deployment-vercel.md). Verificá el commit desplegado, las migraciones, el endpoint de salud, la autenticación cerrada, el enlace del primer administrador, los permisos, el rastro de auditoría, los logs del runtime y un recorrido autenticado por el navegador. Un build exitoso, por sí solo, no es verificación de producción.
12. Mantené el código desplegado en la rama por defecto del repositorio, y mantené responsables de recuperación separados para los datos de PostgreSQL, la configuración de identidad y las variables del despliegue. El respaldo del código no es el respaldo de los datos; revertir el código no revierte la base.
13. Para cambiar una aplicación que ya existe, no regeneres encima: seguí
[references/evolution.md](references/evolution.md) y corré `scripts/evolve_app.py` primero en modo plan.
Las operaciones bloqueadas necesitan una migración de datos revisada, no un flag.
14. Una migración que borra datos no se aplica sola durante un despliegue. Si la guarda la frena, la salida no es autorizarla y seguir: primero desacoplá el código y desplegá, y recién después borrá los datos, con respaldo y como paso separado.
15. Cuando la aplicación vaya a ser operada por agentes, leé [references/mcp.md](references/mcp.md). Emití
una credencial por agente, con los alcances mínimos que necesite y con vencimiento; nunca compartas una sesión humana con un agente.
16. Implementá los cálculos, integraciones, flujos e interfaz propios del cliente en `src/features/`, siguiendo [references/extension-contract.md](references/extension-contract.md). Nunca edites `src/platform/` ni `database/platform/` para un cliente: envolvelos desde una feature.

## Contrato de entrega

En cada generación, informá:

- qué se generó;
- los supuestos y los controles que quedaron sin resolver;
- la verificación realizada y su resultado;
- qué es seguro para una vista previa y qué falta para producción;
- las rutas al AppSpec y al proyecto generado.

Nunca sustituyas en silencio una integración real por datos de demostración, no inventes reglas de dominio ni expongas datos sin autenticar en un despliegue público.
