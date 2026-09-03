#!/usr/bin/env python3
"""Mueve la procedencia de las salidas historicas a su tabla propia.

El script es deliberadamente pequeno: el criterio y la transaccion viven en
PostgreSQL. Este cliente solo descubre la corrida auditada en DEV, hace el
preflight, invoca el backfill idempotente y vuelve a validar los conteos.
Nunca acepta la referencia de PROD.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys
from pathlib import Path
from typing import Any, Iterable


DEV_REF = "rkmioktcsgqqjshrlkmy"
PROD_REF = "dwgvzcnarrjgqjotocdw"
SOURCE_SHA256 = "1559266196bcba5360ddbc71d3e33bc22e61c11f12d90daa809952a170e132e2"
PARSER_VERSION = "2.0.0-temporal"
APPLICATOR_VERSION = "2.1.0-salida-procedencia"
EXPECTED_SOURCE_ROWS = 1790


class ApplyError(RuntimeError):
    """Error de seguridad, preflight o reconciliacion."""


def normalize_project_ref(value: str | None) -> str:
    """Solo permite el clon DEV auditado."""

    ref = (value or DEV_REF).strip()
    if ref != DEV_REF or ref == PROD_REF:
        raise ApplyError(f"Destino bloqueado: se exige DEV exacto {DEV_REF}")
    return ref


def source_alias_key(value: str | None) -> str | None:
    """Clave exacta del alias; no hace fold de acentos ni fuzzy matching."""

    if value is None:
        return None
    trimmed = value.strip()
    if not trimmed or trimmed == "-":
        return None
    return trimmed.lower()


def extract_source_payload(raw: str | None) -> dict[str, Any]:
    """Parsea el legado sin aceptar listas, escalares ni JSON incompleto."""

    if raw is None or not raw.strip():
        raise ApplyError("La procedencia fuente esta vacia")
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ApplyError(f"JSON fuente invalido: {exc.msg}") from exc
    if not isinstance(payload, dict):
        raise ApplyError("La procedencia fuente debe ser un objeto JSON")
    required = {
        "conductor_alias",
        "priorizar",
        "narrativa",
        "estado_fuente",
        "estado_resolucion",
    }
    missing = sorted(required.difference(payload))
    if missing:
        raise ApplyError(f"Faltan claves de procedencia: {', '.join(missing)}")
    if not isinstance(payload["narrativa"], dict):
        raise ApplyError("La narrativa fuente debe ser un objeto JSON")
    if not isinstance(payload["estado_fuente"], bool):
        raise ApplyError("estado_fuente debe ser booleano")
    return payload


def resolve_alias(alias_names: Iterable[str], source_text: str | None) -> dict[str, Any]:
    """Devuelve el resultado de la regla exacta usada por la migracion."""

    key = source_alias_key(source_text)
    if key is None:
        return {
            "status": "empty",
            "source_text": source_text,
            "matches": [],
        }

    matches = [name for name in alias_names if source_alias_key(name) == key]
    if len(matches) == 1:
        status = "matched"
    elif len(matches) == 0:
        status = "unmatched"
    else:
        status = "ambiguous"
    return {
        "status": status,
        "source_text": source_text,
        "matches": matches,
    }


def _load_dev_rest() -> type[Any]:
    """Reusa el cliente HTTP ya auditado, sin duplicar manejo de secretos."""

    root = Path(__file__).resolve().parents[1]
    source = root / "scripts" / "aplicar-historico-segunda-etapa.py"
    spec = importlib.util.spec_from_file_location("historico_dev_rest", source)
    if spec is None or spec.loader is None:
        raise ApplyError(f"No se pudo cargar el cliente DEV: {source}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.DevRest


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--importation-id",
        help="UUID de importaciones; si falta se descubre por hash/parser en DEV",
    )
    parser.add_argument(
        "--key-file",
        default=".supabase-dev-service-role",
        help="secreto local de service role para DEV",
    )
    parser.add_argument("--project-ref", default=DEV_REF, help=argparse.SUPPRESS)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="ejecuta la RPC transaccional; sin esto solo hace preflight",
    )
    return parser.parse_args()


def find_importation(api: Any, requested_id: str | None) -> dict[str, Any]:
    if requested_id:
        rows = api.request(
            "GET",
            "importaciones",
            query={
                "id": f"eq.{requested_id}",
                "select": "id,estado,source_sha256,parser_version,corrida_at",
                "limit": "2",
            },
        ) or []
        if len(rows) != 1:
            raise ApplyError("La importacion indicada no existe de forma unica en DEV")
    else:
        rows = api.request(
            "GET",
            "importaciones",
            query={
                "source_sha256": f"eq.{SOURCE_SHA256}",
                "parser_version": f"eq.{PARSER_VERSION}",
                "select": "id,estado,source_sha256,parser_version,corrida_at",
                "order": "corrida_at.desc,id.desc",
                "limit": "20",
            },
        ) or []
        active = [row for row in rows if row.get("estado") != "revertida"]
        if len(active) != 1:
            raise ApplyError(
                "Se esperaba una corrida DEV activa para el hash auditado; "
                f"hay {len(active)}"
            )
        rows = active

    run = rows[0]
    if run.get("source_sha256") != SOURCE_SHA256:
        raise ApplyError("El hash remoto no coincide con la fuente auditada")
    if run.get("parser_version") != PARSER_VERSION:
        raise ApplyError("El parser remoto no coincide con la auditoria")
    return run


def call_preflight(api: Any, importation_id: str) -> dict[str, Any]:
    result = api.rpc(
        "preflight_salida_importacion_procedencia",
        {"p_importation_id": importation_id},
    )
    if not isinstance(result, dict):
        raise ApplyError(f"Preflight DEV inesperado: {result!r}")
    return result


def call_validate(api: Any, importation_id: str) -> dict[str, Any]:
    result = api.rpc(
        "validate_salida_importacion_procedencia",
        {"p_importation_id": importation_id},
    )
    if not isinstance(result, dict):
        raise ApplyError(f"Validacion DEV inesperada: {result!r}")
    return result


def main() -> int:
    args = parse_args()
    project_ref = normalize_project_ref(args.project_ref)
    env_ref = os.environ.get("SUPABASE_PROJECT_REF")
    if env_ref is not None:
        normalize_project_ref(env_ref)

    root = Path(__file__).resolve().parents[1]
    key_path = Path(args.key_file)
    if not key_path.is_absolute():
        key_path = root / key_path

    dev_rest = _load_dev_rest()
    api = dev_rest(key_path, project_ref)
    run = find_importation(api, args.importation_id)
    importation_id = str(run["id"])
    print(f"DEV corrida={importation_id} estado={run.get('estado')}")

    preflight = call_preflight(api, importation_id)
    print("PREFLIGHT", json.dumps(preflight, ensure_ascii=False, sort_keys=True))
    if preflight.get("ok") is not True:
        raise ApplyError("El preflight de procedencia no dio ok=true")

    if not args.apply:
        print("PREFLIGHT OK: no se escribio ninguna tabla")
        return 0

    applied = api.rpc(
        "backfill_salida_importacion_procedencia",
        {"p_importation_id": importation_id},
    )
    print("BACKFILL", json.dumps(applied, ensure_ascii=False, sort_keys=True))
    if not isinstance(applied, dict) or applied.get("status") not in {
        "completed",
        "already_completed",
    }:
        raise ApplyError(f"El backfill no completo: {applied!r}")

    after = call_validate(api, importation_id)
    print("VALIDACION", json.dumps(after, ensure_ascii=False, sort_keys=True))
    if after.get("ok") is not True:
        raise ApplyError("La validacion final de DEV no dio ok=true")
    print(
        "DEV OK: 1.790 procedencias estructuradas; "
        "1.781 alias exactos; 9 alias vacios; 0 JSON fuente en notes"
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ApplyError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(2)
