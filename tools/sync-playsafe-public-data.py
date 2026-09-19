#!/usr/bin/env python3
import gzip
import json
import math
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

BASE = "https://www.data.go.kr"
DATA_DIR = Path(__file__).resolve().parents[1] / "data" / "playsafe"
OUT = DATA_DIR / "public-context.json.gz"
META = DATA_DIR / "public-context.meta.json"

SOURCES = {
    "parks": {
        "pk": 15012890,
        "columns": [
            "MANAGE_NO", "PARK_NM", "PARK_SE", "RDNMADR", "LNMADR",
            "LATITUDE", "LONGITUDE", "PARK_AR", "MVM_FCLTY", "AMSMT_FCLTY",
            "CNVNNC_FCLTY", "ETC_FCLTY", "PHONE_NUMBER", "REFERENCE_DATE",
        ],
    },
    "childZones": {
        "pk": 15012891,
        "columns": [
            "FCLTY_KND", "TRGET_FCLTY_NM", "RDNMADR", "LNMADR",
            "LATITUDE", "LONGITUDE", "CCTV_YN", "CCTV_NUMBER",
            "CHLD_PRTN_ZON_YN", "PRTCAREA_RW", "REFERENCE_DATE",
        ],
    },
    "childAccidentHotspots": {
        "pk": 15029185,
        "columns": [
            "ACDNT_AREA_MANAGE_NO", "ACDNT_YEAR", "ACDNT_TYPE_SE",
            "CTPRVN_SIGNGU_NM", "ACDNT_AREA_LC_NM", "OCCRRNC_CO",
            "CASLT_CO", "DEATH_CO", "SWPSN_CO", "SINJPSN_CO",
            "INJPSN_CO", "LATITUDE", "LONGITUDE",
            "REFERENCE_DATE",
        ],
    },
    "childCenters": {
        "pk": 15129438,
        "columns": [
            "CNTR_NM", "CTPV_NM", "SGG_NM", "LCTN_ROAD_NM",
            "LCTN_LOTNO_ADDR", "LAT", "LOT", "TELNO", "PSCP_CNT",
            "NOW_NOPE", "OPER_INST_TYPE", "DATA_CRTR_YMD",
        ],
    },
    "toilets": {
        "pk": 15012892,
        "columns": [
            "TOILET_NM", "RDNMADR", "LNMADR", "LATITUDE", "LONGITUDE",
            "OPEN_TIME", "MEN_CHILDREN_TOILET_BOWL_NUMBER",
            "MEN_CHILDREN_URINAL_NUMBER", "LADIES_CHILDREN_TOILET_BOWL_NUMBER",
            "DIPERS_EXCHG_POSI", "EMG_BELL_YN", "REFERENCE_DATE",
        ],
    },
}


def get_json(url):
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "PlaySafe-public-data-sync/1.0 (+https://github.com/sionchu/spacelab-ai)",
            "Referer": "https://www.data.go.kr/",
            "X-Requested-With": "XMLHttpRequest",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as response:
        return json.load(response)


def valid_coord(lat, lon):
    try:
        lat = float(lat)
        lon = float(lon)
    except (TypeError, ValueError):
        return None
    if not (32 <= lat <= 39.5 and 124 <= lon <= 132):
        return None
    return round(lat, 7), round(lon, 7)


def download_standard(pk, requested_columns):
    header = get_json(f"{BASE}/download/columList.json?pk={pk}&ext=JSON")
    table = header["tableVO"]
    available = set(table.get("colNmList") or [])
    columns = [column for column in requested_columns if column in available]
    total = int(header.get("totalCount") or 0)
    if not total:
        raise RuntimeError(f"standard dataset {pk} has no downloadable rows")
    per_page = 10000
    rows = []
    for page in range(1, math.ceil(total / per_page) + 1):
        query = [
            ("publicDataPk", str(pk)),
            ("svcTableNm", table["svcTableNm"]),
            ("totalCount", str(total)),
            ("perPage", str(per_page)),
            ("page", str(page)),
        ] + [("colNmList", column) for column in columns]
        url = f"{BASE}/download/standard.json?" + urllib.parse.urlencode(query)
        rows.extend(get_json(url))
    return rows, total


def s(value):
    return str(value or "").strip()


def n(value):
    try:
        number = float(str(value or "0").replace(",", ""))
        return int(number) if number.is_integer() else number
    except ValueError:
        return 0


def normalize_parks(rows):
    result = []
    for row in rows:
        point = valid_coord(row.get("LATITUDE"), row.get("LONGITUDE"))
        if not point:
            continue
        lat, lon = point
        result.append({
            "id": s(row.get("MANAGE_NO")),
            "name": s(row.get("PARK_NM")),
            "type": s(row.get("PARK_SE")),
            "address": s(row.get("RDNMADR")) or s(row.get("LNMADR")),
            "lat": lat, "lon": lon,
            "areaM2": n(row.get("PARK_AR")),
            "exercise": s(row.get("MVM_FCLTY")),
            "amusement": s(row.get("AMSMT_FCLTY")),
            "convenience": s(row.get("CNVNNC_FCLTY")),
            "etc": s(row.get("ETC_FCLTY")),
            "phone": s(row.get("PHONE_NUMBER")),
            "referenceDate": s(row.get("REFERENCE_DATE")),
        })
    return result


def normalize_zones(rows):
    result = []
    for index, row in enumerate(rows):
        point = valid_coord(row.get("LATITUDE"), row.get("LONGITUDE"))
        if not point:
            continue
        lat, lon = point
        result.append({
            "id": f"zone-{index}",
            "facilityType": s(row.get("FCLTY_KND")),
            "name": s(row.get("TRGET_FCLTY_NM")),
            "address": s(row.get("RDNMADR")) or s(row.get("LNMADR")),
            "lat": lat, "lon": lon,
            "cctv": s(row.get("CCTV_YN")),
            "cctvCount": n(row.get("CCTV_NUMBER")),
            "active": s(row.get("CHLD_PRTN_ZON_YN")),
            "roadWidth": s(row.get("PRTCAREA_RW")),
            "referenceDate": s(row.get("REFERENCE_DATE")),
        })
    return result


def normalize_accident_hotspots(rows):
    result = []
    allowed = {"보행어린이", "스쿨존어린이"}
    for row in rows:
        accident_type = s(row.get("ACDNT_TYPE_SE"))
        if accident_type not in allowed:
            continue
        point = valid_coord(row.get("LATITUDE"), row.get("LONGITUDE"))
        if not point:
            continue
        lat, lon = point
        result.append({
            "id": s(row.get("ACDNT_AREA_MANAGE_NO")),
            "name": s(row.get("ACDNT_AREA_LC_NM")),
            "accidentType": accident_type,
            "year": s(row.get("ACDNT_YEAR")),
            "region": s(row.get("CTPRVN_SIGNGU_NM")),
            "lat": lat, "lon": lon,
            "occurrences": n(row.get("OCCRRNC_CO")),
            "casualties": n(row.get("CASLT_CO")),
            "deaths": n(row.get("DEATH_CO")),
            "seriousInjuries": n(row.get("SWPSN_CO")),
            "minorInjuries": n(row.get("SINJPSN_CO")),
            "reportedInjuries": n(row.get("INJPSN_CO")),
            "referenceDate": s(row.get("REFERENCE_DATE")),
        })
    return result


def normalize_centers(rows):
    result = []
    for index, row in enumerate(rows):
        point = valid_coord(row.get("LAT"), row.get("LOT"))
        if not point:
            continue
        lat, lon = point
        result.append({
            "id": f"center-{index}",
            "name": s(row.get("CNTR_NM")),
            "address": s(row.get("LCTN_ROAD_NM")) or s(row.get("LCTN_LOTNO_ADDR")),
            "lat": lat, "lon": lon,
            "phone": s(row.get("TELNO")),
            "capacity": n(row.get("PSCP_CNT")),
            "current": n(row.get("NOW_NOPE")),
            "operatorType": s(row.get("OPER_INST_TYPE")),
            "referenceDate": s(row.get("DATA_CRTR_YMD")),
        })
    return result


def normalize_toilets(rows):
    result = []
    for index, row in enumerate(rows):
        point = valid_coord(row.get("LATITUDE"), row.get("LONGITUDE"))
        if not point:
            continue
        child_fixture_count = (
            n(row.get("MEN_CHILDREN_TOILET_BOWL_NUMBER"))
            + n(row.get("MEN_CHILDREN_URINAL_NUMBER"))
            + n(row.get("LADIES_CHILDREN_TOILET_BOWL_NUMBER"))
        )
        diaper = s(row.get("DIPERS_EXCHG_POSI"))
        if child_fixture_count <= 0 and not diaper:
            continue
        lat, lon = point
        result.append({
            "id": f"toilet-{index}",
            "name": s(row.get("TOILET_NM")),
            "address": s(row.get("RDNMADR")) or s(row.get("LNMADR")),
            "lat": lat, "lon": lon,
            "openTime": s(row.get("OPEN_TIME")),
            "childFixtures": child_fixture_count,
            "diaperChange": diaper,
            "emergencyBell": s(row.get("EMG_BELL_YN")),
            "referenceDate": s(row.get("REFERENCE_DATE")),
        })
    return result


NORMALIZERS = {
    "parks": normalize_parks,
    "childZones": normalize_zones,
    "childAccidentHotspots": normalize_accident_hotspots,
    "childCenters": normalize_centers,
    "toilets": normalize_toilets,
}


def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    output = {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "data.go.kr nationwide standard-data download grid",
        "datasets": {},
    }
    for name, config in SOURCES.items():
        print(f"sync {name} ({config['pk']})")
        rows, total = download_standard(config["pk"], config["columns"])
        normalized = NORMALIZERS[name](rows)
        output["datasets"][name] = {
            "publicDataPk": config["pk"],
            "sourceRows": total,
            "rows": normalized,
        }
        print(f"  source={total:,} normalized={len(normalized):,}")

    payload = json.dumps(output, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    with gzip.open(OUT, "wb", compresslevel=9) as handle:
        handle.write(payload)
    META.write_text(json.dumps({
        "generatedAt": output["generatedAt"],
        "source": output["source"],
        "datasets": {name: {
            "publicDataPk": value["publicDataPk"],
            "sourceRows": value["sourceRows"],
            "normalizedRows": len(value["rows"]),
        } for name, value in output["datasets"].items()},
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size / 1024 / 1024:.2f} MiB)")


if __name__ == "__main__":
    main()
