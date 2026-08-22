-- CONFIGURACION DEL SISTEMA: PARES CLAVE/VALOR GLOBALES Y POR USUARIO.
-- Es la primitiva de opciones de la aplicacion. Segura de reaplicar.

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


-- Cerrada a cualquier API de datos del proveedor; el dueno no queda sujeto a RLS.
ALTER TABLE app_setting ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_user_setting ENABLE ROW LEVEL SECURITY;
