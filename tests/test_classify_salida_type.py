from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path
from types import ModuleType


def load_etl():
    openpyxl = ModuleType("openpyxl")
    openpyxl.load_workbook = lambda *args, **kwargs: None
    utils = ModuleType("openpyxl.utils")
    utils.get_column_letter = lambda column: "A"
    sys.modules.setdefault("openpyxl", openpyxl)
    sys.modules.setdefault("openpyxl.utils", utils)

    script = Path(__file__).parents[1] / "scripts" / "etl-salidas-predicacion.py"
    spec = importlib.util.spec_from_file_location("etl_salidas_predicacion", script)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


ETL = load_etl()


class ClassifySalidaTypeTests(unittest.TestCase):
    def test_sg_es_salida_de_grupos(self) -> None:
        self.assertEqual(ETL.classify_salida_type("SG"), "grupos")
        self.assertEqual(ETL.classify_salida_type(" sg "), "grupos")
        self.assertEqual(ETL.classify_salida_type("Salida de grupo"), "grupos")

    def test_sr_ss_zo_son_especiales(self) -> None:
        self.assertEqual(ETL.classify_salida_type("SR"), "especial")
        self.assertEqual(ETL.classify_salida_type("SS"), "especial")
        self.assertEqual(ETL.classify_salida_type("ZO"), "especial")

    def test_tel_y_asamblea_siguen_igual(self) -> None:
        self.assertEqual(ETL.classify_salida_type("TEL"), "telefonica")
        self.assertEqual(ETL.classify_salida_type("AC"), "asamblea")
        self.assertIsNone(ETL.classify_salida_type("61.1"))


if __name__ == "__main__":
    unittest.main()
