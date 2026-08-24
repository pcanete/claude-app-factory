-- TODA ACCIÓN TIENE UNA PERSONA RESPONSABLE. SEGURA DE REAPLICAR.
--
-- Hasta acá un agente era un actor suelto: tenía rol, alcances y vencimiento, pero no
-- respondía ante nadie. Si una credencial borraba algo a las tres de la mañana, la
-- auditoría decía qué agente fue y no quién se hacía cargo.
--
-- Un agente no es un sujeto autónomo: es la extensión de alguien. Por eso pasa a tener
-- un responsable humano obligatorio, y toda entrada de actividad --la de una persona y
-- la de un agente-- lleva a una persona.
--
-- El responsable se deriva en la base, con un disparador, en vez de confiar en que cada
-- lugar del código se acuerde de completarlo. Una garantía que depende de recordarla no
-- es una garantía: es una convención hasta que alguien agrega una ruta nueva.

-- 1. Quién responde por cada agente ------------------------------------------------

ALTER TABLE app_agent ADD COLUMN IF NOT EXISTS owner_user_id uuid;
ALTER TABLE app_agent ADD COLUMN IF NOT EXISTS created_by_user_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_agent_owner_user_id_fkey') THEN
    -- RESTRICT: una persona con agentes vivos no se elimina sin resolverlos antes.
    ALTER TABLE app_agent ADD CONSTRAINT app_agent_owner_user_id_fkey
      FOREIGN KEY (owner_user_id) REFERENCES app_user(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_agent_created_by_user_id_fkey') THEN
    -- Quién lo creó es historia: si esa persona se va, el dato se afloja pero el agente vive.
    ALTER TABLE app_agent ADD CONSTRAINT app_agent_created_by_user_id_fkey
      FOREIGN KEY (created_by_user_id) REFERENCES app_user(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Los agentes que ya existen quedan a cargo de quien los creó, según la auditoría. Si
-- esa huella no está, van al administrador más antiguo que siga activo: alguien tiene
-- que responder, y dejarlos huérfanos sería exactamente lo que esta migración corrige.
UPDATE app_agent AS a
   SET created_by_user_id = COALESCE(a.created_by_user_id, (
         SELECT log.actor_id FROM app_audit_log AS log
          WHERE log.entity_key = 'app_agent' AND log.record_id = a.id
            AND log.action = 'agent_create' AND log.actor_id IS NOT NULL
          ORDER BY log.created_at ASC LIMIT 1)),
       owner_user_id = COALESCE(a.owner_user_id, (
         SELECT log.actor_id FROM app_audit_log AS log
          WHERE log.entity_key = 'app_agent' AND log.record_id = a.id
            AND log.action = 'agent_create' AND log.actor_id IS NOT NULL
          ORDER BY log.created_at ASC LIMIT 1))
 WHERE a.owner_user_id IS NULL OR a.created_by_user_id IS NULL;

UPDATE app_agent
   SET owner_user_id = (SELECT id FROM app_user WHERE active ORDER BY created_at ASC LIMIT 1)
 WHERE owner_user_id IS NULL
   AND EXISTS (SELECT 1 FROM app_user WHERE active);

-- No se declara NOT NULL: una instalación sin usuarios todavía no puede completarlo, y
-- una migración que falla por eso deja la aplicación sin desplegar. Lo exige el runtime
-- al crear agentes, y el índice de abajo deja ver los que quedaron sin resolver.
CREATE INDEX IF NOT EXISTS app_agent_sin_responsable_idx
  ON app_agent (created_at) WHERE owner_user_id IS NULL;
CREATE INDEX IF NOT EXISTS app_agent_owner_idx ON app_agent (owner_user_id);

-- 2. El responsable viaja con cada rastro -------------------------------------------

ALTER TABLE app_audit_log   ADD COLUMN IF NOT EXISTS responsible_user_id uuid;
ALTER TABLE app_agent_event ADD COLUMN IF NOT EXISTS responsible_user_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_audit_log_responsible_fkey') THEN
    ALTER TABLE app_audit_log ADD CONSTRAINT app_audit_log_responsible_fkey
      FOREIGN KEY (responsible_user_id) REFERENCES app_user(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_agent_event_responsible_fkey') THEN
    ALTER TABLE app_agent_event ADD CONSTRAINT app_agent_event_responsible_fkey
      FOREIGN KEY (responsible_user_id) REFERENCES app_user(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Derivación en la base: si actuó una persona, es ella; si actuó un agente, su
-- responsable. El código puede pasarlo explícitamente, pero no hace falta que lo haga.
CREATE OR REPLACE FUNCTION app_set_responsible()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.responsible_user_id IS NULL THEN
    NEW.responsible_user_id := COALESCE(
      CASE WHEN TG_TABLE_NAME = 'app_audit_log' THEN NEW.actor_id ELSE NULL END,
      (SELECT owner_user_id FROM app_agent WHERE id = NEW.agent_id)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS app_audit_log_responsible ON app_audit_log;
CREATE TRIGGER app_audit_log_responsible
  BEFORE INSERT ON app_audit_log
  FOR EACH ROW EXECUTE FUNCTION app_set_responsible();

DROP TRIGGER IF EXISTS app_agent_event_responsible ON app_agent_event;
CREATE TRIGGER app_agent_event_responsible
  BEFORE INSERT ON app_agent_event
  FOR EACH ROW EXECUTE FUNCTION app_set_responsible();

-- Completar lo ya registrado, para que la historia previa también tenga responsable.
UPDATE app_audit_log AS log
   SET responsible_user_id = COALESCE(
         log.actor_id,
         (SELECT owner_user_id FROM app_agent WHERE id = log.agent_id))
 WHERE log.responsible_user_id IS NULL;

UPDATE app_agent_event AS event
   SET responsible_user_id = (SELECT owner_user_id FROM app_agent WHERE id = event.agent_id)
 WHERE event.responsible_user_id IS NULL;

CREATE INDEX IF NOT EXISTS app_audit_log_responsible_idx   ON app_audit_log (responsible_user_id);
CREATE INDEX IF NOT EXISTS app_agent_event_responsible_idx ON app_agent_event (responsible_user_id);
