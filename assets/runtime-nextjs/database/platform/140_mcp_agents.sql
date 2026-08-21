-- MCP AGENT IDENTITIES AND READ-ACTIVITY LOG. SAFE TO REAPPLY.

CREATE TABLE IF NOT EXISTS app_agent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  role_key text NOT NULL REFERENCES app_role(key) ON UPDATE CASCADE ON DELETE RESTRICT,
  scopes text[] NOT NULL DEFAULT ARRAY['schema:read', 'records:read']::text[],
  active boolean NOT NULL DEFAULT TRUE,
  expires_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_agent_name_check CHECK (length(trim(name)) BETWEEN 1 AND 120),
  CONSTRAINT app_agent_token_hash_check CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT app_agent_scopes_check CHECK (
    scopes <@ ARRAY['schema:read', 'records:read']::text[]
    AND ARRAY['schema:read', 'records:read']::text[] <@ scopes
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS app_agent_name_normalized_uidx
  ON app_agent (lower(trim(name)));
CREATE INDEX IF NOT EXISTS app_agent_role_active_idx
  ON app_agent (role_key, active);

CREATE TABLE IF NOT EXISTS app_agent_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES app_agent(id) ON DELETE RESTRICT,
  tool_name text NOT NULL,
  entity_key text,
  input_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  result_count integer CHECK (result_count IS NULL OR result_count >= 0),
  duration_ms integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS app_agent_event_agent_started_idx
  ON app_agent_event (agent_id, started_at DESC);
CREATE INDEX IF NOT EXISTS app_agent_event_entity_started_idx
  ON app_agent_event (entity_key, started_at DESC)
  WHERE entity_key IS NOT NULL;

DROP TRIGGER IF EXISTS app_agent_set_updated_at ON app_agent;
CREATE TRIGGER app_agent_set_updated_at
  BEFORE UPDATE ON app_agent
  FOR EACH ROW EXECUTE FUNCTION app_set_updated_at();

-- Cerrada a cualquier API de datos del proveedor; el dueno no queda sujeto a RLS.
ALTER TABLE app_agent ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_agent_event ENABLE ROW LEVEL SECURITY;
