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

## Conectar un cliente MCP remoto (Claude, ChatGPT)

Un cliente remoto no puede recibir un token pegado a mano: llega sin credencial, recibe un `401` con
`WWW-Authenticate`, y desde ahí descubre dónde autenticarse. Esa cadena la sirve la aplicación sola.
Lo que hay que preparar es del lado del proveedor de identidad.

### Por qué falla la primera vez

El cliente intenta **registrarse solo** (RFC 7591). Si el servidor de autorización no publica
`registration_endpoint`, no puede, y el cliente pide un **Client ID** ya creado. Con Clerk hay dos
caminos, y la diferencia importa:

| | Registro dinámico | Aplicación OAuth creada a mano |
|---|---|---|
| Qué abre | un endpoint público donde **cualquiera** registra aplicaciones contra tu instancia | nada |
| Riesgo | alguien registra una con nombre creíble y se la ofrece a tus usuarios para que la aprueben | ninguno |
| Efecto secundario | la pantalla de consentimiento queda forzada y ya no se puede desactivar | ninguno |
| Cuándo conviene | una plataforma abierta a integraciones de terceros | conectar unos pocos clientes conocidos |

Para conectar dos o tres clientes propios, **la aplicación creada a mano es la opción correcta**. El
registro dinámico resuelve un problema de escala que no se tiene.

### El procedimiento

1. En el panel de Clerk, instancia de **producción**: `Configure → OAuth applications → Add`.
2. Nombre el del cliente (una aplicación por cliente: así se revocan por separado).
3. **Public activado.** Habilita PKCE, que es la razón por la que al cliente le alcanza con el Client
   ID y no necesita un secreto.
4. **Pantalla de consentimiento activada.** Es la que deja ver qué permisos se otorgan.
5. Alcances `email`, `profile` y `offline_access`. El último permite renovar la sesión sin volver a
   autorizar cada vez.
6. Guardá el Client ID. Clerk muestra además un Client Secret una sola vez: con `Public` activado no
   se usa, y si algún día hace falta se regenera.
7. **Agregá la URL de retorno del cliente y guardá.** Para Claude es
   `https://claude.ai/api/mcp/auth_callback`.
8. Pegá el Client ID en el conector.

### El paso que se pasa por alto

En el paso 7, cargar la URL la muestra en pantalla como una etiqueta **pero todavía no la guarda**:
aparece una barra de `Unsaved changes` con un botón `Save`. Si no se confirma, el conector falla con:

> The 'redirect_uri' parameter does not match any of the OAuth 2.0 Client's pre-registered redirect urls.

El mensaje sugiere que la URL está mal escrita, y en realidad no hay ninguna registrada. Después de
guardar, conviene recargar la página y comprobar que la URL figura en la lista.

### Cómo averiguar la URL exacta de un cliente

No la adivines: si no coincide carácter por carácter, el intento se rechaza. Cada intento fallido
queda en `Logs` de la instancia, y el evento `oauth_authorization.failed` incluye el `redirect_uri`
que el cliente envió, junto con el `oauth_client_id`. Ese registro es la fuente: dice exactamente qué
pidió el cliente, y comparándolo con lo registrado se ve de qué lado está el problema.

## Al probar el endpoint a mano

El servidor responde `text/event-stream`, así que un cliente que espere JSON plano tiene que quedarse
con la línea `data:` de la respuesta.

Y una advertencia que cuesta un rato descubrir: **no pases el JSON por el shell en Windows.** Git Bash
con una configuración regional que no sea UTF-8 reemplaza cada carácter acentuado por `U+FFFD` antes
de que `curl` lo envíe, y los datos llegan corruptos a la base. Parece un defecto del servidor y no lo
es: el mismo pedido enviado desde Node con `fetch` llega intacto.

Si al probar aparecen acentos rotos, verificá el cliente antes que la aplicación.
