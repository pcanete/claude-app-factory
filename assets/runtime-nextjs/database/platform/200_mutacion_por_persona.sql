-- Una escritura por MCP no siempre viene de una credencial de agente.
--
-- `app_agent_mutation` nació cuando el único cliente MCP era un agente con token, así
-- que `agent_id` es NOT NULL y apunta a `app_agent`. Pero por OAuth quien escribe es una
-- persona, y su identificador no existe en esa tabla: PostgreSQL rechazaba la clave
-- foránea y con ella toda la transacción. Leer funcionaba —ese camino sí distingue
-- persona de agente— y escribir fallaba con un error de base que no decía nada sobre la
-- causa real.
--
-- La tabla existe para que un reintento no cree dos registros. Esa protección vale igual
-- para una persona, así que la solución no es saltearla sino admitir los dos tipos de
-- autor: exactamente una de las dos columnas, y la clave primaria sobre el que haya.
--
-- El orden importa: `agent_id` no puede dejar de ser obligatoria mientras siga formando
-- parte de la clave primaria, así que primero se suelta la clave.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'app_agent_mutation_pkey' AND conrelid = 'app_agent_mutation'::regclass
  ) THEN
    ALTER TABLE app_agent_mutation DROP CONSTRAINT app_agent_mutation_pkey;
  END IF;
END $$;

ALTER TABLE app_agent_mutation ALTER COLUMN agent_id DROP NOT NULL;

ALTER TABLE app_agent_mutation
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES app_user(id) ON DELETE RESTRICT;

-- Columna generada: quien escribió, sea agente o persona. Permite una sola clave
-- primaria en vez de dos índices parciales que habría que mantener en paralelo.
ALTER TABLE app_agent_mutation
  ADD COLUMN IF NOT EXISTS principal_id uuid
  GENERATED ALWAYS AS (COALESCE(agent_id, user_id)) STORED;

DO $$
BEGIN
  -- Exactamente uno de los dos. Ni ninguno (una mutación sin autor no se puede auditar)
  -- ni los dos (no habría forma de saber a nombre de quién se hizo).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_agent_mutation_principal_check') THEN
    ALTER TABLE app_agent_mutation
      ADD CONSTRAINT app_agent_mutation_principal_check
      CHECK ((agent_id IS NULL) <> (user_id IS NULL));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'app_agent_mutation_principal_pkey' AND conrelid = 'app_agent_mutation'::regclass
  ) THEN
    ALTER TABLE app_agent_mutation
      ADD CONSTRAINT app_agent_mutation_principal_pkey PRIMARY KEY (principal_id, idempotency_key);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS app_agent_mutation_user_idx
  ON app_agent_mutation (user_id) WHERE user_id IS NOT NULL;
