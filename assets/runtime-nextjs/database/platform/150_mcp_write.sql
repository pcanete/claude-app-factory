-- SAFE MCP WRITES, IDEMPOTENCY, AND AGENT-LINKED MUTATION AUDIT. SAFE TO REAPPLY.

ALTER TABLE app_agent DROP CONSTRAINT IF EXISTS app_agent_scopes_check;
ALTER TABLE app_agent ADD CONSTRAINT app_agent_scopes_check CHECK (
  scopes <@ ARRAY['schema:read', 'records:read', 'records:write', 'records:delete']::text[]
  AND ARRAY['schema:read', 'records:read']::text[] <@ scopes
);

ALTER TABLE app_audit_log ADD COLUMN IF NOT EXISTS agent_id uuid;
ALTER TABLE app_audit_log ADD COLUMN IF NOT EXISTS agent_event_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_audit_log_agent_id_fkey') THEN
    ALTER TABLE app_audit_log
      ADD CONSTRAINT app_audit_log_agent_id_fkey
      FOREIGN KEY (agent_id) REFERENCES app_agent(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_audit_log_agent_event_id_fkey') THEN
    ALTER TABLE app_audit_log
      ADD CONSTRAINT app_audit_log_agent_event_id_fkey
      FOREIGN KEY (agent_event_id) REFERENCES app_agent_event(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS app_audit_log_agent_idx ON app_audit_log (agent_id);
CREATE INDEX IF NOT EXISTS app_audit_log_agent_event_idx ON app_audit_log (agent_event_id);

CREATE TABLE IF NOT EXISTS app_agent_mutation (
  agent_id uuid NOT NULL REFERENCES app_agent(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  tool_name text NOT NULL,
  entity_key text NOT NULL,
  request_hash text NOT NULL,
  record_id uuid,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, idempotency_key),
  CONSTRAINT app_agent_mutation_key_check CHECK (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
  CONSTRAINT app_agent_mutation_hash_check CHECK (request_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS app_agent_mutation_created_idx
  ON app_agent_mutation (created_at DESC);

-- Cerrada a cualquier API de datos del proveedor; el dueno no queda sujeto a RLS.
ALTER TABLE app_agent_mutation ENABLE ROW LEVEL SECURITY;
