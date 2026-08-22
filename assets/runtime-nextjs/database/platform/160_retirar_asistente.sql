-- RETIRO DEL ASISTENTE INTERNO. SEGURA DE REAPLICAR.
--
-- El sistema deja de ejecutar modelos: los agentes se conectan por MCP y traen el
-- suyo. Con eso desaparece la necesidad de custodiar credenciales de proveedores
-- ajenos y de mantener un catálogo de modelos que envejece.
--
-- `app_setting` y `app_user_setting` NO se tocan: son la primitiva de configuración
-- del sistema y sobreviven al asistente que las estrenó.

DROP TABLE IF EXISTS ai_tool_call;
DROP TABLE IF EXISTS ai_run;
DROP TABLE IF EXISTS ai_message;
DROP TABLE IF EXISTS ai_conversation;

-- Sólo guardaba claves de OpenAI y Anthropic por usuario. Sin asistente interno no
-- hay nada que cifrar, y SETTINGS_ENCRYPTION_KEY deja de ser una pieza crítica.
DROP TABLE IF EXISTS app_user_secret;
