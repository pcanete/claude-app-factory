-- Corrige app_set_responsible, introducida en 180_responsable_humano.sql.
--
-- La función se monta como trigger sobre dos tablas: app_audit_log, que tiene
-- columna actor_id, y app_agent_event, que no la tiene. El CASE sobre
-- TG_TABLE_NAME parecía suficiente, pero PL/pgSQL resuelve las referencias a
-- campos de NEW antes de evaluar la rama del CASE: en app_agent_event fallaba
-- con «record "new" has no field "actor_id"».
--
-- Como toda llamada MCP de un agente empieza insertando en app_agent_event, el
-- efecto era que ninguna herramienta funcionaba -- ni siquiera una lectura.
--
-- to_jsonb(NEW) resuelve el campo en tiempo de ejecución y devuelve NULL cuando
-- la columna no existe, así que el COALESCE cae al responsable del agente.
--
-- Va en un archivo nuevo y no editando 180 porque el runner de migraciones
-- guarda el checksum de lo aplicado y aborta si un archivo ya aplicado cambia.
CREATE OR REPLACE FUNCTION app_set_responsible()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.responsible_user_id IS NULL THEN
    NEW.responsible_user_id := COALESCE(
      (to_jsonb(NEW) ->> 'actor_id')::uuid,
      (SELECT owner_user_id FROM app_agent WHERE id = NEW.agent_id)
    );
  END IF;
  RETURN NEW;
END;
$$;
