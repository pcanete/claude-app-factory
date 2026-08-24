# AppSpec v0

El AppSpec es la frontera estable entre un pedido en lenguaje natural y el software generado. Describe la estructura del negocio sin imponer un CRM, un ERP, una gestión de casos ni ningún otro vertical.

## Raíz

Claves obligatorias:

- `version`: por ahora `0.1`.
- `app`: identidad y valores de presentación por defecto.
- `roles`: los roles de la aplicación.
- `entities`: las entidades del dominio.
- `views`: navegación y presentaciones estándar.

Claves opcionales:

- `rules`: reglas de negocio declarativas que ejecuta el runtime.
- `decisions`: supuestos, decisiones confirmadas y preguntas sin resolver.

## App

```json
{
  "app": {
    "key": "control_mantenimiento",
    "name": "Control de mantenimiento",
    "description": "Gestiona equipos, técnicos y órdenes de trabajo",
    "locale": "es-AR",
    "timezone": "America/Argentina/Buenos_Aires",
    "theme": {
      "primary": "#5B5BD6",
      "surface": "#111318"
    }
  }
}
```

Las claves usan `snake_case`, tienen que coincidir con `^[a-z][a-z0-9_]*$` y llegan hasta 48 caracteres. Las etiquetas son para las personas y pueden llevar espacios y acentos.

## Roles y permisos

Cada rol tiene una clave estable y una etiqueta. Los permisos sobre una entidad enumeran uno o más de `list`, `read`, `create`, `update` y `delete`.

```json
{
  "roles": [
    {"key": "admin", "label": "Administrador", "capabilities": ["manage_users", "view_audit", "view_rules"]},
    {"key": "technician", "label": "Técnico", "capabilities": []}
  ]
}
```

Toda entidad tiene que definir sus permisos de forma explícita. El compilador rechaza roles o acciones que no conoce.

`capabilities` declara el acceso administrativo que no se puede expresar como permiso sobre una entidad:

| Capacidad | Concede |
|---|---|
| `manage_users` | Invitar, desactivar y reasignar usuarios de la aplicación |
| `view_audit` | Leer la auditoría |
| `view_rules` | Revisar el conjunto de reglas compilado |

Las capacidades son opcionales pero recomendadas. Cuando al menos un rol las declara, esa declaración manda y algún rol tiene que tener `manage_users`. Cuando ningún rol las declara, el runtime cae en una heurística heredada —cualquier rol que tenga `list`, `read` y `delete` sobre *todas* las entidades hereda las tres capacidades— y el reporte del build lo registra como un control pendiente antes de producción. Esa heurística le concede la administración a roles que nadie declaró como administradores: mejor declarar las capacidades.

## Entidades

```json
{
  "key": "work_order",
  "label": "Orden de trabajo",
  "label_plural": "Órdenes de trabajo",
  "description": "Intervenciones planificadas o correctivas",
  "title_field": "summary",
  "fields": [],
  "relationships": [],
  "permissions": {
    "admin": ["list", "read", "create", "update", "delete"],
    "technician": ["list", "read", "update"]
  }
}
```

El compilador agrega `id`, `created_at` y `updated_at`; no los declares como campos.

Tipos de campo soportados en v0:

| Tipo | Representación en PostgreSQL | Notas |
|---|---|---|
| `text` | `text` | Texto corto o buscable |
| `long_text` | `text` | Contenido largo |
| `integer` | `bigint` | Números enteros |
| `decimal` | `numeric(18,4)` | Dinero o medidas; la semántica de moneda es del dominio |
| `boolean` | `boolean` | Verdadero o falso |
| `date` | `date` | Fecha de calendario |
| `datetime` | `timestamptz` | Instante absoluto |
| `email` | `text` | Semántica y validación en la interfaz |
| `url` | `text` | Semántica y validación en la interfaz |
| `enum` | `text` + check | Requiere `options` no vacío |
| `tags` | `text[]` + índice GIN | Varios valores por registro; hasta 50 etiquetas de 48 caracteres |
| `person` | `uuid` + clave foránea a `app_user` | Una persona de la aplicación, no su nombre escrito |
| `file` | `jsonb` | Metadatos de almacenamiento, no los bytes del archivo |
| `json` | `jsonb` | Válvula de escape; preferí campos explícitos |

Opciones de un campo:

- `required`, `unique`, `searchable`: booleanos.
- `default`: escalar compatible con el tipo.
- `options`: arreglo de `{key,label}` para campos `enum`, y opcional para `tags`.
- `help`: explicación para quien lo usa.

Un campo `tags` con `options` queda restringido a esos valores; sin `options` acepta etiquetas libres, siempre normalizadas a minúsculas y sin repetidos. Se filtra por contención, así que un registro coincide cuando tiene todas las etiquetas pedidas.

### Permisos a nivel de registro

Los permisos de un rol responden "¿puede modificar clientes?". Una entidad puede además
declarar *cuáles*:

```json
{
  "record_access": {
    "owner_field": "responsable",
    "roles": { "director": "all", "socio": "own" }
  }
}
```

`owner_field` tiene que ser un campo de tipo `person` de la propia entidad: sin un dueño
declarado no hay forma de decidir de quién es una fila, y adivinarlo —por el creador, por
una convención de nombre— es como se construyen los permisos que fallan abiertos.

Tres reglas que definen el comportamiento:

- **Un rol que la política no menciona no alcanza ningún registro.** El silencio no concede.
- **Si falta la identidad, la consulta falla.** Una entidad con política que recibe una
  consulta sin identidad lanza un error en vez de devolver todo: un olvido rompe la
  pantalla, nunca abre los datos.
- **Un agente no puede exceder a su responsable.** Su alcance es el más restrictivo entre
  el de su rol y el de la persona que responde por él.

El filtro se aplica dentro de la consulta SQL —en listados, conteos, fichas, tableros,
exportación, modificación y borrado—, no descartando filas después de traerlas: un conteo
que incluye lo que no se puede ver ya es una filtración, aunque las filas no se muestren.

Las entidades pueden habilitar adjuntos universales por registro:

```json
{
  "attachments": {
    "enabled": true,
    "max_files": 20,
    "max_size_mb": 3,
    "allowed_types": ["application/pdf", "image/jpeg", "image/png"]
  }
}
```

Los adjuntos se guardan fuera de la fila de la entidad, heredan sus permisos de `read` y `update`, y quedan auditados. El adaptador de PostgreSQL incorporado está limitado a propósito a 4 MB por archivo; los requerimientos de archivos grandes o subida directa van detrás del adaptador de almacenamiento que es del cliente.

Las relaciones soportan:

- `belongs_to`: agrega una columna de clave foránea en la entidad actual.
- `has_many`: metadato de navegación inversa; no agrega ninguna columna.
- `many_to_many`: reservado en v0 y rechazado por el compilador hasta que se implemente la semántica de tabla intermedia.

Para `belongs_to` hay que indicar `key`, `label`, `target`, `required` y `on_delete` (`restrict`, `cascade`, `set_null`).

## Vistas

Los tipos aceptados en v0 son `table`, `form`, `detail`, `dashboard`, `calendar` y `kanban`. Las vistas con nombre de tipo `table`, `dashboard`, `calendar` y `kanban` tienen su propia ruta en el runtime. Los metadatos de `form` y `detail` siguen configurando las rutas estándar de cada entidad.

```json
{
  "key": "open_orders",
  "label": "Órdenes abiertas",
  "type": "table",
  "entity": "work_order",
  "navigation": true,
  "fields": ["summary", "status", "scheduled_for"]
}
```

Las vistas de tabla soportan filtros dinámicos por campo, búsqueda de texto libre sobre los campos buscables y ordenamiento validado. Configuración opcional:

```json
{
  "default_sort": {"field": "scheduled_for", "direction": "asc"},
  "page_size": 50,
  "bulk_edit_fields": ["status", "approved"]
}
```

Los listados se paginan. `bulk_edit_fields` es opcional y sólo puede referenciar campos `enum` o `boolean`; una mutación masiva tiene un tope de 100 registros, se ejecuta de forma atómica y aplica los mismos permisos, reglas y rastro de auditoría que una edición individual.

Las vistas kanban requieren `entity` y `group_by`, y `group_by` tiene que referenciar un campo `enum`. Poné `allow_move: true` para habilitar el movimiento auditado de tarjetas. Las vistas de calendario requieren `entity` y `date_field`, que tiene que referenciar un campo de fecha o fecha y hora; `end_date_field` es opcional. Poné `allow_reschedule: true` para habilitar cambios de fecha auditados. Las dos operaciones requieren permiso de `update` y pasan por las reglas deterministas. Las vistas de tablero contienen uno o más widgets deterministas:

```json
{
  "key": "operations",
  "label": "Operación",
  "type": "dashboard",
  "navigation": true,
  "widgets": [
    {"key": "open_total", "label": "Abiertas", "type": "metric", "entity": "work_order", "aggregate": "count"},
    {"key": "by_status", "label": "Por estado", "type": "breakdown", "entity": "work_order", "group_by": "status"},
    {"key": "recent", "label": "Recientes", "type": "recent", "entity": "work_order", "fields": ["summary", "status"], "limit": 5}
  ]
}
```

Los widgets de métrica aceptan `count`, `sum` o `avg`; `sum` y `avg` requieren un `field` numérico. Los widgets de tablero nunca ejecutan SQL arbitrario.

## Reglas

Las reglas son deliberadamente chicas y deterministas. El runtime las ejecuta en el servidor antes de una mutación; no se acepta código arbitrario, llamadas de red, correo, integraciones ni acciones de IA.

```json
{
  "key": "prevent_invalid_schedule",
  "label": "Impedir agendas inválidas",
  "priority": 20,
  "enabled": true,
  "when": {"entity": "work_order", "event": "before_save"},
  "if": {
    "all": [
      {"field": "scheduled_for", "operator": "is_not_empty"},
      {"field": "scheduled_for", "operator": "lt", "value": {"source": "now"}}
    ]
  },
  "then": [{"action": "block", "message": "La fecha agendada no puede estar en el pasado."}]
}
```

Los eventos aceptados son `before_create`, `before_update`, `before_delete` y `before_save`; `before_save` aplica a la creación y a la modificación. Las reglas corren por prioridad ascendente y, a igual prioridad, por orden de declaración.

Las condiciones son árboles estructurados:

- nodos lógicos: `all`, `any` y `not`;
- comparaciones: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `not_in` y `contains`;
- chequeos de estado: `is_empty`, `is_not_empty`, `changed` y `not_changed`;
- los valores de comparación pueden ser literales, `{ "source": "now" }` o `{ "source": "field", "field": "otro_campo" }`.

Las acciones se limitan a:

- `{ "action": "set", "field": "priority", "value": "high" }`;
- `{ "action": "block", "message": "Explicación que ve la persona." }`.

`set` también puede tomar el valor de otro campo o de la hora actual. Una regla `before_delete` sólo puede bloquear. Cada ejecución queda registrada dentro del evento de auditoría de la mutación. Las aprobaciones de varios pasos y los efectos hacia afuera siguen siendo features del cliente.

## Decisiones

```json
{
  "decisions": [
    {
      "status": "assumption",
      "topic": "file_retention",
      "statement": "Conservar archivos mientras el registro exista"
    }
  ]
}
```

Los estados permitidos son `confirmed`, `assumption` y `unresolved`.

## Invariantes de compilación

- Las claves de entidad y de campo son únicas.
- Las relaciones apuntan a entidades que existen.
- `title_field` referencia un campo declarado.
- Los roles de los permisos existen.
- Los campos de una vista existen en la entidad referenciada.
- Las políticas de adjuntos están acotadas y tienen patrones MIME válidos.
- Los campos de kanban, calendario, edición masiva, ordenamiento y widgets de tablero son compatibles con su tipo.
- El SQL generado usa únicamente identificadores validados y no abre ninguna transacción propia.
- Las capacidades declaradas son valores conocidos, y al menos un rol tiene `manage_users`.
- La salida nunca sobrescribe un directorio de proyecto que no esté vacío.
