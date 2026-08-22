# Evolución segura del AppSpec

Usá este procedimiento para cambiar una aplicación que ya fue generada. El `app-spec.json` actual es la línea base del contrato con la base de datos: nunca lo reemplaces antes de producir el plan de evolución.

## Flujo de trabajo

1. Hacé un commit del código de la aplicación, o guardá una copia de su estado.
2. Creá un AppSpec propuesto aparte y validalo.
3. Generá un plan de sólo lectura:

   ```bash
   python /ruta/a/claude-app-factory/scripts/evolve_app.py \
     --project /ruta/a/la-aplicacion \
     --spec /ruta/a/propuesta.app-spec.json
   ```

4. Revisá cada cambio, cada advertencia, cada operación bloqueada y cada sentencia SQL propuesta.
5. Aplicá solamente un plan seguro:

   ```bash
   python /ruta/a/claude-app-factory/scripts/evolve_app.py \
     --project /ruta/a/la-aplicacion \
     --spec /ruta/a/propuesta.app-spec.json \
     --migration-name agregar_prioridades \
     --apply
   ```

6. Revisá el diff de Git y la nueva migración `database/generated/NNN_*.sql` antes de conectar una base de datos.
7. Respaldá la base de destino, o confirmá que se puede recuperar, y recién entonces corré `pnpm db:apply`, `pnpm db:smoke` y `pnpm typecheck` o `pnpm build`.
8. Verificá los permisos, reglas y vistas afectados, y un recorrido completo por el navegador. Usá el entorno de vista previa antes que producción donde esté disponible.

El paso de aplicación actualiza únicamente los artefactos que son de la fábrica:

- `app-spec.json`;
- `src/generated/app-spec.ts`;
- `src/generated/navigation.ts`;
- `src/generated/permissions.ts`;
- `database/generated/NNN_*.sql` cuando cambia el esquema;
- `BUILD_REPORT.md` y `EVOLUTION_REPORT.md`.

No pisa `src/features/`, `src/components/custom/`, `database/custom/`, la configuración de despliegue ni ningún otro archivo que sea del cliente.

## Cambios soportados automáticamente

- agregar una entidad, con sus campos, restricciones de enum, índices y claves foráneas `belongs_to`;
- agregar un campo opcional;
- agregar un campo obligatorio cuando tiene un valor por defecto seguro;
- agregar una relación `belongs_to` opcional;
- agregar roles o cambiarles la etiqueta;
- agregar valores a un enum sin quitar los que ya existen;
- agregar un índice de búsqueda o relajar un `NOT NULL`;
- cambiar los valores por defecto de un campo;
- cambiar etiquetas, ayudas, permisos, adjuntos, vistas, reglas y decisiones, que son metadatos del runtime.

Las relaciones `has_many` son metadatos inversos y no crean columnas en la base.

## Cambios que se frenan solos

- eliminar o renombrar una entidad, un campo o una relación almacenada;
- cambiar el tipo de un campo;
- quitar un valor de un enum;
- volver obligatorio un campo o una relación existente sin un relleno explícito;
- agregar unicidad donde puede haber duplicados, o quitar una restricción de unicidad;
- cambiar el destino, el tipo o el comportamiento de borrado de una clave foránea;
- eliminar un rol que todavía puede tener usuarios;
- cambiar la clave de la aplicación o la versión del AppSpec.

Estas operaciones no están prohibidas. Requieren una migración propia y revisada, análisis de los datos, respaldo y plan de reversión. Una vez que la base y el AppSpec fueron reconciliados de forma deliberada, los metadatos generados normales pueden continuar desde la nueva línea base.

## Invariantes de las migraciones

- Las migraciones aplicadas son inmutables; la evolución siempre crea la migración numerada siguiente.
- El runtime generado verifica las sumas de control de las migraciones.
- Revertir el código no revierte PostgreSQL.
- Un plan de evolución no es evidencia de que la migración funcionó contra datos reales.
- Nunca uses una base de producción como primera prueba de una migración.
