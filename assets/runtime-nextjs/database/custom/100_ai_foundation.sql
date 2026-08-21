BEGIN;

CREATE TABLE IF NOT EXISTS ai_conversation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Nueva conversación',
  model_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_conversation_user_updated_idx
  ON ai_conversation (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS ai_message (
  conversation_id uuid NOT NULL REFERENCES ai_conversation(id) ON DELETE CASCADE,
  message_id text NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, message_id),
  UNIQUE (conversation_id, position)
);

CREATE TABLE IF NOT EXISTS ai_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES ai_conversation(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  provider_key text NOT NULL,
  model_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'aborted')),
  input_tokens integer NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens integer NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  total_tokens integer NOT NULL DEFAULT 0 CHECK (total_tokens >= 0),
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS ai_run_conversation_started_idx
  ON ai_run (conversation_id, started_at DESC);

CREATE TABLE IF NOT EXISTS ai_tool_call (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES ai_run(id) ON DELETE CASCADE,
  tool_call_id text NOT NULL,
  tool_name text NOT NULL,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, tool_call_id)
);

COMMIT;
