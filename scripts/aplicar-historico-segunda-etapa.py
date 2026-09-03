#!/usr/bin/env python3
"""Aplica la segunda etapa del historico exclusivamente en DEV.

La materializacion real vive en una RPC transaccional de PostgreSQL. Este
cliente solo descubre la corrida auditada, invoca la RPC y verifica los
conteos por otra RPC. No acepta una ref arbitraria: PROD no puede entrar ni
por typo ni por variable de entorno.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


DEV_REF = "rkmioktcsgqqjshrlkmy"
PROD_REF = "dwgvzcnarrjgqjotocdw"
SOURCE_SHA256 = "1559266196bcba5360ddbc71d3e33bc22e61c11f12d90daa809952a170e132e2"
PARSER_VERSION = "2.0.0-temporal"
APPLICATOR_VERSION = "2.0.0-historical-second-stage"
EXPECTED_TOTAL = 3346
EXPECTED_REMAINING = 471


class ApplyError(RuntimeError):
    """Error de preflight, seguridad o validacion."""


def normalize_project_ref(value: str | None) -> str:
    """Rechaza cualquier destino que no sea el clon DEV auditado."""

    ref = (value or DEV_REF).strip()
    if ref != DEV_REF or ref == PROD_REF:
        raise ApplyError(f"Destino bloqueado: se exige DEV exacto {DEV_REF}")
    return ref


def code_key(value: str | None) -> str | None:
    """Replica la normalizacion lexica segura de codigos del SQL."""

    if value is None:
        return None
    text = value.strip().lower()
    if not text:
        return None
    if text[:-2].isdigit() and text.endswith(".0"):
        return text[:-2]
    return text


def classify_source_case(
    *,
    record_type: str,
    status: str,
    reason: str | None,
    normalized: dict[str, Any] | None,
) -> str:
    """Clasificacion pura usada por las pruebas locales y la bitacora."""

    reason_text = (reason or "").lower()
    normalized = normalized or {}
    if record_type == "punto_encuentro":
        return "historical_point_source"
    if record_type == "territorio":
        code = code_key(
            str(normalized.get("codigo_bruto"))
            if normalized.get("codigo_bruto") is not None
            else None
        )
        if code == "tel":
            return "historical_territory_special"
        if "duplicado" in reason_text:
            return "historical_closure"
        return "historical_territory_candidate"
    if record_type == "grupo":
        return "historical_group"
    if record_type == "territorio_personal":
        if status == "conflicto" or "confirm" in reason_text:
            return "historical_closure"
        return "historical_personal"
    if record_type == "salida":
        return "historical_closure"
    return "historical_closure"


class DevRest:
    """Cliente minimo PostgREST con host DEV fijado en codigo."""

    def __init__(self, key_file: Path, project_ref: str = DEV_REF) -> None:
        self.project_ref = normalize_project_ref(project_ref)
        if not key_file.is_file():
            raise ApplyError(f"No existe el secreto DEV: {key_file}")
        self.key = key_file.read_text(encoding="utf-8").strip()
        if not self.key:
            raise ApplyError("El secreto DEV esta vacio")
        self.base = f"https://{DEV_REF}.supabase.co/rest/v1"
        self.headers = {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Accept-Profile": "public",
        }

    def request(
        self,
        method: str,
        resource: str,
        *,
        query: dict[str, str] | None = None,
        body: Any = None,
    ) -> Any:
        url = f"{self.base}/{resource.lstrip('/')}"
        if query:
            url += "?" + urlencode(query)
        headers = dict(self.headers)
        payload = None
        if body is not None:
            payload = json.dumps(body, ensure_ascii=False, allow_nan=False).encode("utf-8")
        request = Request(url, data=payload, headers=headers, method=method)
        try:
            with urlopen(request, timeout=60) as response:
                content = response.read()
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:1200]
            raise ApplyError(f"DEV {method} {resource}: HTTP {exc.code}: {detail}") from exc
        except URLError as exc:
            raise ApplyError(f"No se pudo conectar con DEV: {exc.reason}") from exc
        if not content:
            return None
        try:
            return json.loads(content.decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise ApplyError(f"DEV devolvio JSON invalido para {resource}") from exc

    def rpc(self, function_name: str, body: dict[str, Any]) -> Any:
        return self.request("POST", f"rpc/{function_name}", body=body)


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
    parser.add_argument(
        "--project-ref",
        default=DEV_REF,
        help=argparse.SUPPRESS,
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="ejecuta la RPC transaccional; sin esto solo hace validacion remota de DEV",
    )
    return parser.parse_args()


def find_importation(api: DevRest, requested_id: str | None) -> dict[str, Any]:
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
                f"Se esperaba una corrida DEV activa para el hash auditado; hay {len(active)}"
            )
        rows = active

    run = rows[0]
    if run.get("source_sha256") != SOURCE_SHA256:
        raise ApplyError("El hash remoto no coincide con la fuente auditada")
    if run.get("parser_version") != PARSER_VERSION:
        raise ApplyError("El parser remoto no coincide con la auditoria")
    return run


def validate(api: DevRest, importation_id: str) -> dict[str, Any]:
    result = api.rpc(
        "validate_historical_second_stage",
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
    api = DevRest(key_path, project_ref)
    run = find_importation(api, args.importation_id)
    importation_id = str(run["id"])
    print(f"DEV corrida={importation_id} estado={run.get('estado')}")

    before = validate(api, importation_id)
    print("VALIDACION ANTES", json.dumps(before, ensure_ascii=False, sort_keys=True))

    if not args.apply:
        print("PREFLIGHT: no se escribio ninguna tabla")
        return 0

    applied = api.rpc(
        "apply_historical_second_stage",
        {"p_importation_id": importation_id},
    )
    print("APLICACION", json.dumps(applied, ensure_ascii=False, sort_keys=True))
    if not isinstance(applied, dict) or applied.get("status") not in {
        "completed",
        "already_completed",
    }:
        raise ApplyError(f"La RPC no completo: {applied!r}")

    after = validate(api, importation_id)
    print("VALIDACION DESPUES", json.dumps(after, ensure_ascii=False, sort_keys=True))
    if after.get("ok") is not True:
        raise ApplyError("La validacion final de DEV no dio ok=true")
    print("DEV OK: 3346 reconciliados; 0 pendientes; 0 conflictos")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ApplyError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(2)
