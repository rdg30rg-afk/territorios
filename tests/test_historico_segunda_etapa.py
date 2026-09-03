from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "scripts" / "aplicar-historico-segunda-etapa.py"
SPEC = importlib.util.spec_from_file_location("historico_segunda_etapa", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class HistoricoSegundaEtapaTests(unittest.TestCase):
    def test_destino_es_estrictamente_dev(self) -> None:
        self.assertEqual(MODULE.normalize_project_ref(MODULE.DEV_REF), MODULE.DEV_REF)
        with self.assertRaises(MODULE.ApplyError):
            MODULE.normalize_project_ref(MODULE.PROD_REF)
        with self.assertRaises(MODULE.ApplyError):
            MODULE.normalize_project_ref("otro-proyecto")

    def test_codigo_numerico_entero_se_normaliza_sin_perder_el_texto(self) -> None:
        self.assertEqual(MODULE.code_key("60.0"), "60")
        self.assertEqual(MODULE.code_key(" 68.5 "), "68.5")
        self.assertEqual(MODULE.code_key("TEL"), "tel")
        self.assertIsNone(MODULE.code_key("  "))

    def test_punto_y_tel_son_candidatos_historicos(self) -> None:
        self.assertEqual(
            MODULE.classify_source_case(
                record_type="punto_encuentro",
                status="pendiente",
                reason=None,
                normalized={"url": "https://maps.app.goo.gl/x"},
            ),
            "historical_point_source",
        )
        self.assertEqual(
            MODULE.classify_source_case(
                record_type="territorio",
                status="conflicto",
                reason="enlace externo Zoom",
                normalized={"codigo_bruto": "TEL"},
            ),
            "historical_territory_special",
        )

    def test_ambiguedad_y_confirmacion_no_se_convierten_en_relacion(self) -> None:
        self.assertEqual(
            MODULE.classify_source_case(
                record_type="territorio",
                status="conflicto",
                reason="código de territorio duplicado",
                normalized={"codigo_bruto": "68.5"},
            ),
            "historical_closure",
        )
        self.assertEqual(
            MODULE.classify_source_case(
                record_type="territorio_personal",
                status="conflicto",
                reason="estado requiere confirmación",
                normalized=None,
            ),
            "historical_closure",
        )

    def test_salidas_y_comentarios_sin_evidencia_se_cierran(self) -> None:
        self.assertEqual(
            MODULE.classify_source_case(
                record_type="salida",
                status="conflicto",
                reason="fecha de origen no concluyente",
                normalized=None,
            ),
            "historical_closure",
        )
        self.assertEqual(
            MODULE.classify_source_case(
                record_type="otro",
                status="conflicto",
                reason="comentario fuera de una fila clasificada",
                normalized=None,
            ),
            "historical_closure",
        )


if __name__ == "__main__":
    unittest.main()
