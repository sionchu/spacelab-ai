#!/usr/bin/env python3
import gzip
import json
import re
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "data" / "playsafe" / "kapt-download"
OUT = ROOT / "data" / "playsafe" / "kapt-search-index.json.gz"
META = ROOT / "data" / "playsafe" / "kapt-search-index.meta.json"
MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS = {"a": MAIN}

def column(ref: str) -> str:
    return re.match(r"[A-Z]+", ref).group(0)
def cell_value(cell) -> str:
    inline = cell.find("a:is", NS)
    if inline is not None:
        return "".join(
            (node.text or "") for node in inline.iter(f"{{{MAIN}}}t")
        ).strip()
    value = cell.find("a:v", NS)
    return "" if value is None else (value.text or "").strip()

def latest_source() -> Path:
    files = sorted(SOURCE_DIR.glob("*.xlsx"), reverse=True)
    if not files:
        raise FileNotFoundError("K-apt source XLSX not found")
    return files[0]

def main():
    source = latest_source()
    complexes = {}
    row_count = 0
    with zipfile.ZipFile(source) as archive:
        root = ET.fromstring(archive.read("xl/worksheets/sheet1.xml"))
        sheet_data = root.find("a:sheetData", NS)
        for row in sheet_data:
            if int(row.attrib.get("r", "0")) < 3:
                continue
            cells = {
                column(cell.attrib["r"]): cell_value(cell)
                for cell in row.findall("a:c", NS)
            }
            code = cells.get("E", "")
            name = cells.get("F", "")
            lot = cells.get("H", "")
            road = cells.get("J", "")
            if not code or not name:
                continue
            row_count += 1
            key = code + "|" + name
            item = complexes.setdefault(key, {
                "code": code,
                "name": name,
                "lotAddresses": [],
                "roadAddresses": [],
            })
            if lot and lot not in item["lotAddresses"]:
                item["lotAddresses"].append(lot)
            if road and road not in item["roadAddresses"]:
                item["roadAddresses"].append(road)

    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sourceFile": source.name,
        "sourceUrl": "https://www.k-apt.go.kr/web/board/webReference/boardList.do",
        "rows": row_count,
        "complexes": list(complexes.values()),
    }
    encoded = json.dumps(
        payload, ensure_ascii=False, separators=(",", ":")
    ).encode("utf-8")
    with gzip.open(OUT, "wb", compresslevel=9) as handle:
        handle.write(encoded)
    META.write_text(json.dumps({
        "generatedAt": payload["generatedAt"],
        "sourceFile": source.name,
        "sourceUrl": payload["sourceUrl"],
        "sourceRows": row_count,
        "complexes": len(payload["complexes"]),
        "gzipBytes": OUT.stat().st_size,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        "source": source.name,
        "rows": row_count,
        "complexes": len(payload["complexes"]),
        "gzipBytes": OUT.stat().st_size,
    }, ensure_ascii=True))

if __name__ == "__main__":
    main()
