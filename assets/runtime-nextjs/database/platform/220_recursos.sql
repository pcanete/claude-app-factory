-- Lo que un proceso trae para que otra persona lo repita: skills y carpetas de archivos.
--
-- Hasta acá, para repetir un proceso había que clonar el repositorio privado de skills y
-- sincronizar carpetas compartidas: cada persona nueva necesitaba permisos en otras cuentas.
-- Con almacén propio, quien administra publica cada recurso como un .zip versionado y la
-- aplicación se lo entrega a quien tenga acceso al proceso.
--
-- Cada fila es una versión. Nace `pendiente` cuando se entrega la dirección para subirla y
-- pasa a `publicado` recién cuando la aplicación comprobó en el almacén tamaño y MD5. La
-- versión vigente de un recurso es la última publicada.

CREATE TABLE IF NOT EXISTS app_resource (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL CHECK (nombre ~ '^[a-z0-9][a-z0-9._-]{0,59}$'),
  tipo text NOT NULL CHECK (tipo IN ('skill', 'archivos')),
  version text NOT NULL CHECK (version ~ '^[A-Za-z0-9._-]{1,64}$'),
  object_key text NOT NULL UNIQUE CHECK (length(object_key) BETWEEN 1 AND 1024),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  md5 text NOT NULL CHECK (md5 ~ '^[0-9a-f]{32}$'),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'publicado')),
  created_by uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  CHECK ((status = 'publicado') = (published_at IS NOT NULL)),
  UNIQUE (nombre, version)
);

CREATE INDEX IF NOT EXISTS app_resource_vigente_idx ON app_resource (nombre, published_at DESC) WHERE status = 'publicado';

-- Como el resto de las tablas: RLS sin políticas, cerrada para cualquier API de datos del proveedor.
ALTER TABLE app_resource ENABLE ROW LEVEL SECURITY;
