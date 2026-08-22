-- IDENTIDAD Y ALCANCE PARA LA CONFIGURACIÓN DEL SISTEMA. SEGURA DE REAPLICAR.
--
-- `app_audit_log` ya separa quién actúa: `actor_id` apunta a una persona y `agent_id`
-- a una credencial de agente, cada uno con su clave foránea. `app_setting` no siguió
-- ese patrón: nació con un solo `updated_by uuid REFERENCES app_user(id)`.
--
-- La consecuencia no era teórica. El identificador de un agente no existe en
-- `app_user`, así que guardarlo violaba la clave foránea, y la única forma de que un
-- agente pudiera escribir configuración era registrar `NULL` como autor. La
-- configuración del sistema se cambiaba sin que quedara constancia de quién.
--
-- Los dos autores pueden ser nulos a la vez -- un valor sembrado por instalación no
-- tiene autor -- pero nunca pueden estar los dos a la vez.

ALTER TABLE app_setting ADD COLUMN IF NOT EXISTS updated_by_agent uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_setting_updated_by_agent_fkey') THEN
    ALTER TABLE app_setting
      ADD CONSTRAINT app_setting_updated_by_agent_fkey
      FOREIGN KEY (updated_by_agent) REFERENCES app_agent(id) ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE app_setting DROP CONSTRAINT IF EXISTS app_setting_actor_check;
ALTER TABLE app_setting ADD CONSTRAINT app_setting_actor_check CHECK (
  updated_by IS NULL OR updated_by_agent IS NULL
);

CREATE INDEX IF NOT EXISTS app_setting_updated_by_agent_idx ON app_setting (updated_by_agent);

-- Alcances propios para la configuración.
--
-- Hasta ahora, escribir configuración por MCP sólo exigía que el rol de la credencial
-- tuviera la capacidad administrativa. Con eso, un token de sólo lectura emitido para
-- un rol administrador podía cambiar la configuración del sistema: el alcance de la
-- credencial no se miraba. Sobre entidades la verificación siempre fue doble --
-- alcance Y permiso del rol -- y la configuración quedó afuera.
--
-- No se agregan a los alcances obligatorios: una credencial que no los pida no ve ni
-- toca la configuración.
ALTER TABLE app_agent DROP CONSTRAINT IF EXISTS app_agent_scopes_check;
ALTER TABLE app_agent ADD CONSTRAINT app_agent_scopes_check CHECK (
  scopes <@ ARRAY[
    'schema:read', 'records:read', 'records:write', 'records:delete',
    'settings:read', 'settings:write'
  ]::text[]
  AND ARRAY['schema:read', 'records:read']::text[] <@ scopes
);
