#!/usr/bin/env python3
"""Materializa la parte inequívoca de una importación histórica en DEV.

El comando es fail-closed: acepta únicamente el proyecto DEV conocido, exige
``--apply`` para escribir y nunca resuelve identidades territoriales ni de
conductores por semejanza. Es reanudable porque todos los IDs de destino se
derivan de ``source_key`` y los destinos conservan ``registro_id``.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


DEV_REF = "rkmioktcsgqqjshrlkmy"
PROD_REF = "dwgvzcnarrjgqjotocdw"
APPLICATOR_VERSION = "1.1.0-safe-facts-alias-sources"
KNOWN_SOURCE_SHA256 = "1559266196bcba5360ddbc71d3e33bc22e61c11f12d90daa809952a170e132e2"
KNOWN_PARSER_VERSION = "2.0.0-temporal"
NAMESPACE = uuid.UUID("9f92f646-1754-4cbf-86f4-9fa9cabbb71b")


class ApplyError(RuntimeError):
    pass


def load_etl_module() -> Any:
    path = Path(__file__).with_name("etl-salidas-predicacion.py")
    spec = importlib.util.spec_from_file_location("territorios_etl", path)
    if spec is None or spec.loader is None:
        raise ApplyError(f"No se pudo cargar el ETL desde {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def stable_id(kind: str, source_key: str) -> str:
    return str(uuid.uuid5(NAMESPACE, f"{kind}:{source_key}"))


def fetch_all(api: Any, table: str, query: dict[str, str]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for offset in range(0, 100_000, 1000):
        page_query = {**query, "limit": "1000", "offset": str(offset)}
        page = api.request("GET", table, query=page_query) or []
        if not isinstance(page, list):
            raise ApplyError(f"Respuesta inesperada al leer {table}")
        rows.extend(page)
        if len(page) < 1000:
            return rows
    raise ApplyError(f"Paginación fuera de límite al leer {table}")


def post_batches(api: Any, table: str, rows: list[dict[str, Any]]) -> None:
    for start in range(0, len(rows), 100):
        api.request(
            "POST",
            table,
            query={"on_conflict": "id"},
            body=rows[start : start + 100],
            prefer="resolution=ignore-duplicates,return=minimal",
        )
        print(f"  {table}: {min(start + 100, len(rows))}/{len(rows)}")


def rpc(api: Any, function_name: str, body: dict[str, Any]) -> Any:
    url = f"{api.base}/rpc/{quote(function_name, safe='')}"
    payload = json.dumps(body, ensure_ascii=False, allow_nan=False).encode("utf-8")
    request = Request(url, data=payload, headers=api.headers, method="POST")
    try:
        with urlopen(request, timeout=60) as response:
            data = response.read()
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:1000]
        raise ApplyError(f"RPC {function_name}: {exc.code} {detail}") from exc
    except URLError as exc:
        raise ApplyError(f"RPC {function_name}: {exc.reason}") from exc
    return json.loads(data.decode("utf-8")) if data else None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--importation-id", required=True)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="escribe únicamente en DEV; sin esta opción hace preflight",
    )
    return parser.parse_args()


def build_plan(records: list[dict[str, Any]]) -> dict[str, Any]:
    aliases_by_key: dict[str, dict[str, Any]] = {}
    alias_sources: list[dict[str, Any]] = []
    histories: list[dict[str, Any]] = []
    outings: list[dict[str, Any]] = []
    results: list[dict[str, Any]] = []
    outing_territories: list[dict[str, Any]] = []
    blockers: list[dict[str, Any]] = []

    for record in records:
        # Sólo lo originalmente limpio. Un conflicto resuelto requiere aplicar
        # la decisión append-only, y un descartado jamás puede materializarse.
        if record["estado"] != "pendiente" or record.get("normalizado") is None:
            continue
        normalized = record["normalizado"]
        source_key = record.get("source_key")
        if not source_key:
            raise ApplyError(f"Registro {record['id']} sin source_key")

        if record["tipo"] == "conductor":
            alias_text = normalized["alias"].strip()
            alias_key = alias_text.casefold()
            alias_id = stable_id("conductor_alias", alias_key)
            aliases_by_key.setdefault(
                alias_key,
                {
                    "id": alias_id,
                    "alias": alias_text,
                    "conductor_id": None,
                    "confianza": "dudoso",
                    "nota": "Alias preservado desde Excel; identidad pendiente de resolución.",
                },
            )
            alias_sources.append(
                {
                    "id": stable_id("conductor_alias_source", source_key),
                    "alias_id": alias_id,
                    "source_record_id": record["id"],
                }
            )
            continue

        if record["tipo"] == "historial_territorio":
            histories.append(
                {
                    "id": stable_id("territorio_historial", source_key),
                    "territory_id": None,
                    "territory_unit_version_id": None,
                    "source_map_version_id": None,
                    "source_code_text": normalized.get("territorio_codigo_fuente"),
                    "resolution_status": "unresolved",
                    "fecha": normalized.get("fecha"),
                    "texto": normalized.get("texto"),
                    "clase": normalized.get("clase", "sin_dato"),
                    "source_detail": {
                        "clasificacion_visual": normalized.get("clasificacion_visual"),
                        "slot_columna": normalized.get("slot_columna"),
                        "valor_bruto": normalized.get("valor_bruto"),
                    },
                    "origen": "excel",
                    "registro_id": record["id"],
                }
            )
            continue

        if record["tipo"] != "salida":
            continue

        date_value = normalized.get("fecha")
        time_value = normalized.get("hora")
        if not date_value or not time_value:
            blockers.append(
                {
                    "id": record["id"],
                    "reason": "No se materializa una salida sin fecha y hora concluyentes.",
                }
            )
            continue

        outing_id = stable_id("salida", source_key)
        outing_type = normalized.get("tipo_salida")
        titles = {
            "telefonica": "Salida telefónica",
            "asamblea": "Asamblea",
            "especial": "Salida especial",
        }
        notes = {
            "conductor_alias": normalized.get("conductor_alias"),
            "priorizar": normalized.get("priorizar_bruto"),
            "narrativa": normalized.get("narrativa") or {},
            "estado_fuente": normalized.get("estado_fuente"),
            "estado_resolucion": normalized.get("estado_resolucion"),
        }
        outings.append(
            {
                "id": outing_id,
                "title": titles.get(outing_type, "Salida de predicación"),
                "territory_id": None,
                "driver_id": None,
                "group_id": None,
                "meeting_point_name": normalized.get("lugar_bruto"),
                "meeting_point_lat": None,
                "meeting_point_lng": None,
                "scheduled_for": f"{date_value}T{time_value}-03:00",
                "notes": json.dumps(notes, ensure_ascii=False, separators=(",", ":")),
                "tipo": outing_type,
                "origen": "excel",
                "registro_id": record["id"],
            }
        )

        # La casilla fuente significa “Territorio completado”; no demuestra
        # por sí sola que la salida ocurrió ni a qué hora ocurrió. El valor se
        # conserva en notes/staging y no genera salida_resultados automática.

        references = normalized.get("referencias_territoriales") or []
        for position, reference in enumerate(references):
            source_code = reference.get("codigo_fuente")
            if not source_code:
                continue
            outing_territories.append(
                {
                    "id": stable_id(f"salida_territorio:{position}", source_key),
                    "salida_id": outing_id,
                    "territory_unit_version_id": None,
                    "source_map_version_id": None,
                    "source_code_text": source_code,
                    "role": {
                        "principal": "primary",
                        "secundario": "secondary",
                    }.get(reference.get("rol"), "reference"),
                    "position": position,
                    "resolution_status": "unresolved",
                    "confidence": "unknown",
                    "source_record_id": record["id"],
                }
            )

    return {
        "aliases": list(aliases_by_key.values()),
        "alias_sources": alias_sources,
        "histories": histories,
        "outings": outings,
        "results": results,
        "outing_territories": outing_territories,
        "blockers": blockers,
    }


def main() -> int:
    args = parse_args()
    project_ref = os.environ.get("SUPABASE_PROJECT_REF")
    key_file_value = os.environ.get("SUPABASE_SERVICE_ROLE_KEY_FILE")
    if project_ref != DEV_REF or project_ref == PROD_REF:
        raise ApplyError(f"Destino bloqueado: se exige DEV exacto {DEV_REF}")
    if not key_file_value:
        raise ApplyError("Falta SUPABASE_SERVICE_ROLE_KEY_FILE")

    etl = load_etl_module()
    api = etl.SupabaseRest(project_ref, Path(key_file_value).expanduser().resolve())
    runs = api.request(
        "GET",
        "importaciones",
        query={
            "id": f"eq.{args.importation_id}",
            "select": "id,estado,source_sha256,parser_version",
        },
    ) or []
    if len(runs) != 1:
        raise ApplyError("La importación indicada no existe en DEV")
    run = runs[0]
    if run["source_sha256"] != KNOWN_SOURCE_SHA256:
        raise ApplyError("El hash del archivo no coincide con la fuente auditada")
    if run["parser_version"] != KNOWN_PARSER_VERSION:
        raise ApplyError("La versión del parser no coincide con la auditada")

    records = fetch_all(
        api,
        "importacion_registros",
        {
            "importacion_id": f"eq.{args.importation_id}",
            "select": "id,tipo,estado,motivo,normalizado,source_key",
            "order": "created_at.asc,id.asc",
        },
    )
    if len(records) != 3346:
        raise ApplyError(f"Staging incompleto: {len(records)} de 3346 registros")

    plan = build_plan(records)
    counts = {name: len(items) for name, items in plan.items()}
    expected = {
        "aliases": 44,
        "alias_sources": 55,
        "histories": 1030,
        "outings": 1790,
        "results": 0,
        "outing_territories": 1788,
        "blockers": 4,
    }
    if counts != expected:
        raise ApplyError(f"Preflight cambió: actual={counts}, esperado={expected}")
    print("PLAN", json.dumps(counts, sort_keys=True))
    if not args.apply:
        print("PREFLIGHT OK: no se escribió ninguna tabla.")
        return 0

    completed = api.request(
        "GET",
        "importacion_aplicaciones",
        query={
            "importacion_id": f"eq.{args.importation_id}",
            "applicator_version": f"eq.{APPLICATOR_VERSION}",
            "status": "eq.completed",
            "select": "id",
            "limit": "1",
        },
    ) or []
    if completed:
        raise ApplyError(f"La versión {APPLICATOR_VERSION} ya fue completada")

    # Cada intento conserva su propia bitácora. Los IDs de los destinos sí son
    # deterministas, por lo que reintentar continúa siendo idempotente.
    application_id = str(uuid.uuid4())
    started = datetime.now().astimezone().isoformat()
    api.request(
        "POST",
        "importacion_aplicaciones",
        query={"on_conflict": "id"},
        body={
            "id": application_id,
            "importacion_id": args.importation_id,
            "source_sha256": run["source_sha256"],
            "parser_version": run["parser_version"],
            "applicator_version": APPLICATOR_VERSION,
            "status": "running",
            "counts": counts,
            "started_at": started,
            "finished_at": None,
            "error_message": None,
        },
        prefer="resolution=merge-duplicates,return=minimal",
    )

    try:
        post_batches(api, "conductor_alias", plan["aliases"])
        post_batches(api, "conductor_alias_sources", plan["alias_sources"])
        post_batches(api, "territorio_historial", plan["histories"])
        post_batches(api, "salidas", plan["outings"])
        post_batches(api, "salida_resultados", plan["results"])
        post_batches(api, "salida_territorios", plan["outing_territories"])

        for blocker in plan["blockers"]:
            api.request(
                "PATCH",
                "importacion_registros",
                query={"id": f"eq.{blocker['id']}"},
                body={
                    "estado": "conflicto",
                    "quality_status": "blocked",
                    "motivo": blocker["reason"],
                },
                prefer="return=minimal",
            )

        finalized = rpc(
            api,
            "finalize_historical_application",
            {"p_importation_id": args.importation_id},
        )
        if finalized != 2875:
            raise ApplyError(f"Finalización incompleta: {finalized} de 2875")

        api.request(
            "PATCH",
            "importacion_aplicaciones",
            query={"id": f"eq.{application_id}"},
            body={
                "status": "completed",
                "counts": {**counts, "staging_finalized": finalized},
                "finished_at": datetime.now().astimezone().isoformat(),
            },
            prefer="return=minimal",
        )
    except Exception as exc:
        try:
            api.request(
                "PATCH",
                "importacion_aplicaciones",
                query={"id": f"eq.{application_id}"},
                body={
                    "status": "failed",
                    "error_message": str(exc)[:1000],
                    "finished_at": datetime.now().astimezone().isoformat(),
                },
                prefer="return=minimal",
            )
        finally:
            raise

    print(f"APLICACION OK: id={application_id}; staging aplicado={finalized}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ApplyError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(2)
