-- Lo producido, guardado por la aplicación en su propio almacén.
--
-- Hasta acá lo producido quedaba en una carpeta de Dropbox y la plataforma sólo anotaba su
-- ruta: para registrar, cada persona necesitaba acceso a esa cuenta. Con un almacén
-- compatible con S3 (R2, S3, Supabase Storage) configurado, la aplicación guarda los
-- archivos ella misma y quien opera sólo necesita entrar a la aplicación.
--
-- Esta tabla guarda qué hay en el almacén y de qué registro es; los bytes viven allá. Un
-- archivo nace `pendiente` cuando se entrega la dirección para subirlo y pasa a `guardado`
-- recién cuando la aplicación comprobó en el almacén que llegó con el tamaño y el MD5
-- declarados. Lo pendiente no cuenta como producido.

CREATE TABLE IF NOT EXISTS app_stored_file (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_key text NOT NULL,
  record_id uuid NOT NULL,
  object_key text NOT NULL UNIQUE CHECK (length(object_key) BETWEEN 1 AND 1024),
  original_name text NOT NULL CHECK (length(original_name) BETWEEN 1 AND 255),
  content_type text NOT NULL CHECK (length(content_type) BETWEEN 3 AND 127),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  md5 text NOT NULL CHECK (md5 ~ '^[0-9a-f]{32}$'),
  status text NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'guardado')),
  created_by uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  stored_at timestamptz,
  CHECK ((status = 'guardado') = (stored_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS app_stored_file_record_idx ON app_stored_file (entity_key, record_id, created_at);
CREATE INDEX IF NOT EXISTS app_stored_file_creator_idx ON app_stored_file (created_by);

-- Como el resto de las tablas: RLS sin políticas, cerrada para cualquier API de datos del proveedor.
ALTER TABLE app_stored_file ENABLE ROW LEVEL SECURITY;
