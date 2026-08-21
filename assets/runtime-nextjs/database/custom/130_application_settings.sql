-- GENERIC SETTINGS AND ENCRYPTED USER SECRETS. SAFE TO REAPPLY.
BEGIN;

CREATE TABLE IF NOT EXISTS app_setting (
  namespace text NOT NULL,
  key text NOT NULL,
  value jsonb NOT NULL,
  updated_by uuid REFERENCES app_user(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (namespace, key),
  CONSTRAINT app_setting_namespace_check CHECK (namespace ~ '^[a-z][a-z0-9_.-]{0,63}$'),
  CONSTRAINT app_setting_key_check CHECK (key ~ '^[a-z][a-z0-9_.-]{0,63}$')
);

CREATE TABLE IF NOT EXISTS app_user_setting (
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  namespace text NOT NULL,
  key text NOT NULL,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, namespace, key),
  CONSTRAINT app_user_setting_namespace_check CHECK (namespace ~ '^[a-z][a-z0-9_.-]{0,63}$'),
  CONSTRAINT app_user_setting_key_check CHECK (key ~ '^[a-z][a-z0-9_.-]{0,63}$')
);

CREATE TABLE IF NOT EXISTS app_user_secret (
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  namespace text NOT NULL,
  key text NOT NULL,
  ciphertext text NOT NULL,
  initialization_vector text NOT NULL,
  authentication_tag text NOT NULL,
  key_version integer NOT NULL DEFAULT 1 CHECK (key_version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, namespace, key),
  CONSTRAINT app_user_secret_namespace_check CHECK (namespace ~ '^[a-z][a-z0-9_.-]{0,63}$'),
  CONSTRAINT app_user_secret_key_check CHECK (key ~ '^[a-z][a-z0-9_.-]{0,63}$')
);

CREATE INDEX IF NOT EXISTS app_user_secret_user_updated_idx
  ON app_user_secret (user_id, updated_at DESC);

COMMIT;

