import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from check_version_bump import revisar  # noqa: E402


def manifiesto(version, files, package=None):
    return {"platform_version": version, "files": files, "package": package or {"dependencies": {}}}


class VersionBumpTest(unittest.TestCase):
    def test_sin_cambios_pasa(self):
        ok, _ = revisar(manifiesto("1.2.0", {"a": "1"}), manifiesto("1.2.0", {"a": "1"}))
        self.assertTrue(ok)

    def test_archivo_cambiado_sin_subir_falla(self):
        ok, mensaje = revisar(manifiesto("1.2.0", {"a": "1"}), manifiesto("1.2.0", {"a": "2"}))
        self.assertFalse(ok)
        self.assertIn("a", mensaje)

    def test_archivo_nuevo_o_borrado_cuenta(self):
        self.assertFalse(revisar(manifiesto("1.2.0", {"a": "1"}), manifiesto("1.2.0", {"a": "1", "b": "1"}))[0])
        self.assertFalse(revisar(manifiesto("1.2.0", {"a": "1", "b": "1"}), manifiesto("1.2.0", {"a": "1"}))[0])

    def test_package_cambiado_sin_subir_falla(self):
        base = manifiesto("1.2.0", {}, {"dependencies": {"x": "1"}})
        head = manifiesto("1.2.0", {}, {"dependencies": {"x": "2"}})
        self.assertFalse(revisar(base, head)[0])

    def test_cambio_con_version_mayor_pasa(self):
        self.assertTrue(revisar(manifiesto("1.2.0", {"a": "1"}), manifiesto("1.3.0", {"a": "2"}))[0])

    def test_la_comparacion_es_numerica_no_de_texto(self):
        # Como texto, "1.10.0" es menor que "1.9.0".
        self.assertTrue(revisar(manifiesto("1.9.0", {"a": "1"}), manifiesto("1.10.0", {"a": "2"}))[0])

    def test_bajar_la_version_falla(self):
        self.assertFalse(revisar(manifiesto("1.3.0", {"a": "1"}), manifiesto("1.2.0", {"a": "2"}))[0])


if __name__ == "__main__":
    unittest.main()
