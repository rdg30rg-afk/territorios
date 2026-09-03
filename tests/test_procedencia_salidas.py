from __future__ import annotations

import importlib.util
import json
import unittest
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "scripts" / "aplicar-procedencia-salidas.py"
SPEC = importlib.util.spec_from_file_location("procedencia_salidas", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class ProcedenciaSalidasTests(unittest.TestCase):
    def test_destino_es_exclusivamente_dev(self) -> None:
        self.assertEqual(MODULE.normalize_project_ref(MODULE.DEV_REF), MODULE.DEV_REF)
        with self.assertRaises(MODULE.ApplyError):
            MODULE.normalize_project_ref(MODULE.PROD_REF)
        with self.assertRaises(MODULE.ApplyError):
            MODULE.normalize_project_ref("otro-proyecto")

    def test_alias_es_lexico_y_preserva_el_texto_fuente(self) -> None:
        self.assertEqual(MODULE.source_alias_key("  Hugo Quiroga  "), "hugo quiroga")
        self.assertIsNone(MODULE.source_alias_key("-"))
        self.assertIsNone(MODULE.source_alias_key("  "))
        self.assertEqual(MODULE.source_alias_key("José"), "josé")

        result = MODULE.resolve_alias(
            ["Hugo Quiroga", "José Pérez", "Otro"],
            "  Hugo Quiroga  ",
        )
        self.assertEqual(result["status"], "matched")
        self.assertEqual(result["source_text"], "  Hugo Quiroga  ")
        self.assertEqual(result["matches"], ["Hugo Quiroga"])

    def test_alias_ambiguo_o_sin_evidencia_no_se_resuelve(self) -> None:
        self.assertEqual(
            MODULE.resolve_alias(["Hugo Quiroga", "hugo quiroga"], "Hugo Quiroga")["status"],
            "ambiguous",
        )
        self.assertEqual(MODULE.resolve_alias(["Hugo"], "Otra persona")["status"], "unmatched")
        self.assertEqual(MODULE.resolve_alias(["Hugo"], "-")["status"], "empty")

    def test_payload_se_parsea_sin_perder_anidamiento(self) -> None:
        raw = json.dumps(
            {
                "conductor_alias": "Hugo Quiroga",
                "priorizar": "Manzana C",
                "narrativa": {"L:PREDICADO:": "Texto fuente"},
                "estado_fuente": False,
                "estado_resolucion": "sin_confirmar",
            },
            ensure_ascii=False,
        )
        payload = MODULE.extract_source_payload(raw)
        self.assertEqual(payload["narrativa"]["L:PREDICADO:"], "Texto fuente")
        self.assertIs(payload["estado_fuente"], False)

    def test_payload_incompleto_o_no_objeto_se_rechaza(self) -> None:
        with self.assertRaises(MODULE.ApplyError):
            MODULE.extract_source_payload("not-json")
        with self.assertRaises(MODULE.ApplyError):
            MODULE.extract_source_payload("[]")
        with self.assertRaises(MODULE.ApplyError):
            MODULE.extract_source_payload(
                json.dumps({"conductor_alias": "Hugo Quiroga"})
            )

    def test_migracion_mantiene_raw_notes_y_protege_fecha(self) -> None:
        migration = (
            Path(__file__).parents[1]
            / "supabase"
            / "migrations"
            / "20260903200000_procedencia_y_edicion_salidas.sql"
        ).read_text(encoding="utf-8")
        self.assertIn("source_notes_raw text not null", migration)
        self.assertIn("source_payload jsonb not null", migration)
        self.assertIn("new.scheduled_for is distinct from old.scheduled_for", migration)
        self.assertIn("backfill_salida_importacion_procedencia", migration)
        self.assertIn("set notes = null", migration)


if __name__ == "__main__":
    unittest.main()
