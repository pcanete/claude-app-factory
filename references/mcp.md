# Acceso de agentes mediante MCP

Este contrato se aplica cuando Riel, Codex, Claude u otro coordinador necesita leer u operar los datos de una aplicación generada. La fábrica y el agente son sistemas separados: la aplicación generada controla autenticación, autorización, datos y auditoría; el agente externo aporta su propio modelo y orquestación.

## Superficie de herramientas

El runtime expone Streamable HTTP sin estado en `/api/mcp` mediante el SDK oficial de MCP para TypeScript.

Herramientas de lectura:

- `list_entities`: descubre entidades autorizadas;
- `describe_entity`: describe campos, relaciones, adjuntos y capacidades;
- `count_records`: cuenta una consulta acotada;
- `query_records`: busca, filtra, ordena y pagina hasta 100 registros;
- `get_record`: obtiene un registro por UUID;
- `export_snapshot`: exporta hasta 10 entidades y 100 registros por entidad con huella de contenido.

Herramientas de escritura:

- `create_record`: crea un registro;
- `update_record`: modifica exclusivamente los campos enviados;
- `delete_record`: elimina un registro y sus adjuntos con confirmación explícita.

No se ofrece SQL arbitrario, ejecución de código ni acceso directo a tablas internas.

## Archivos

`list_attachments` devuelve la metadata de los archivos de un registro —nombre, tipo, tamaño y
hash— sin el contenido. `read_attachment` devuelve el contenido en base64 junto con su `sha256`,
que el agente puede verificar antes de usarlo.

El permiso se resuelve sobre la entidad dueña del archivo y exige `read`, así que conocer el
identificador de un archivo no permite saltear la matriz de permisos. Ambas herramientas quedan
registradas en la actividad del agente como cualquier otra.

El límite sigue siendo el del adaptador incluido: 4 MB por archivo almacenados en PostgreSQL. Un
agente que necesite archivos grandes requiere un adaptador de almacenamiento propio.

## Identidad, alcances y autorización

Después de aplicar migraciones, creá una credencial distinta por agente:

```bash
pnpm mcp:agent:create -- --name "Riel" --role admin --access write --expires-days 90
```

Los niveles disponibles son:

- `read`: `schema:read` y `records:read`;
- `write`: agrega `records:write` para crear y actualizar;
- `full`: agrega también `records:delete`;
- `admin`: agrega `settings:read` y `settings:write`.

La configuración del sistema no viene incluida en `full` a propósito: cambiar cómo se
comporta la aplicación es una superficie distinta de leer y escribir sus datos, y se
otorga eligiéndola. Aun otorgada, sólo sirve si además el rol de la credencial tiene la
capacidad `manage_users`: el alcance habilita, el rol autoriza, y hacen falta los dos.

El token se imprime una sola vez. Guardalo como secreto del agente consumidor; PostgreSQL conserva sólo su hash SHA-256. El rol debe existir en AppSpec. Una operación se autoriza únicamente cuando coinciden el alcance de la credencial y el permiso `list`, `read`, `create`, `update` o `delete` de ese rol sobre la entidad. Lo mismo vale para la configuración del sistema: un token de sólo lectura emitido para un rol administrador no puede escribirla.

Todo cambio de configuración por MCP queda en `app_audit_log` con la identidad de quien lo hizo —`agent_id` para una credencial de agente, `actor_id` para una persona por OAuth—, igual que si se hubiera hecho desde el panel.

Conectá `https://<host>/api/mcp` con `Authorization: Bearer <token>`. En Vercel se admiten automáticamente la URL del deployment, la rama y el dominio estable indicado por `VERCEL_PROJECT_PRODUCTION_URL`. Configurá correctamente `NEXT_PUBLIC_APP_URL` y usá `MCP_ALLOWED_HOSTS` sólo para hosts adicionales explícitos.

## Seguridad de las mutaciones

Cada creación, actualización o eliminación:

- exige `idempotencyKey` única para el agente y la intención;
- rechaza reutilizar la misma clave con una entrada diferente;
- valida campos y relaciones contra AppSpec;
- ejecuta las mismas reglas deterministas que la interfaz humana;
- se realiza en una transacción PostgreSQL;
- registra la mutación en `app_audit_log` con `agent_id` y `agent_event_id`;
- limita la entrada a 100 campos y 64 KB;
- respeta un máximo de 120 herramientas por agente y minuto.

`delete_record` requiere además `records:delete` y `confirm: true`. Cuando una entidad necesite aprobación humana, segregación de funciones o efectos externos, debe añadirse un adaptador específico; no se debe debilitar este núcleo genérico.

## Trazabilidad

Toda llamada crea un `app_agent_event` antes de acceder a registros y finaliza como completada o fallida. Se almacenan agente, herramienta, entidad opcional, resumen acotado de entrada, cantidad de resultados, duración y error. Los valores enviados en una mutación se resumen mediante nombres de campos y una huella; no se guardan credenciales en texto plano ni registros devueltos.

Las mutaciones generan además el mismo evento de auditoría transaccional que una operación humana, enlazado con la identidad y la ejecución MCP.

Desactivá o hacé vencer la credencial en `app_agent` cuando deje de utilizarse. Nunca compartas una misma credencial entre agentes o ambientes independientes.

El asistente embebido es opcional e independiente. MCP debe funcionar aunque la aplicación no tenga claves de OpenAI, Anthropic o AI Gateway.

## Al probar el endpoint a mano

El servidor responde `text/event-stream`, así que un cliente que espere JSON plano tiene que quedarse
con la línea `data:` de la respuesta.

Y una advertencia que cuesta un rato descubrir: **no pases el JSON por el shell en Windows.** Git Bash
con una configuración regional que no sea UTF-8 reemplaza cada carácter acentuado por `U+FFFD` antes
de que `curl` lo envíe, y los datos llegan corruptos a la base. Parece un defecto del servidor y no lo
es: el mismo pedido enviado desde Node con `fetch` llega intacto.

Si al probar aparecen acentos rotos, verificá el cliente antes que la aplicación.
