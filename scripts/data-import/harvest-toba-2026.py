#!/usr/bin/env python3
"""Capture the official TOBA 2026 American Graded/Listed Stakes table.

Read-only official source collection: no balance changes, game activation or currency conversion.
Run: python scripts/data-import/harvest-toba-2026.py
"""
from __future__ import annotations
from collections import Counter
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re

import requests
from bs4 import BeautifulSoup

URL = "https://toba.org/graded-stakes/2026-races/"
OUT = Path("docs/data/2026-us-graded-listed-races.json")
FIELDS = ["track", "date", "division", "stake", "grade", "age", "sex", "distance_furlongs", "surface", "field", "total_purse_usd", "winner"]


def parse() -> list[dict]:
    response = requests.get(URL, timeout=45, headers={"User-Agent": "Mozilla/5.0 (compatible; DerbyCareerDataResearch/1.0)"})
    response.raise_for_status()
    soup = BeautifulSoup(response.content, "html.parser")
    records = []
    for table in soup.find_all("table"):
        for tr in table.find_all("tr"):
            cells = tr.find_all(["td", "th"], recursive=False)
            if len(cells) != 12:
                continue
            fields = [c.get_text(" ", strip=True) for c in cells]
            track, date, division, stake, grade, age, sex, distance, surface, field, purse, winner = fields
            if not re.fullmatch(r"[A-Z]{2,5}", track) or not stake or grade not in ("1","2","3","L","LR"):
                continue
            try:
                date_iso = datetime.strptime(date, "%d-%b-%y").strftime("%Y-%m-%d")
            except ValueError:
                date_iso = None
            def safe_num(s):
                try: return float(s) if s else None
                except ValueError: return None
            purse_n = int(re.sub(r"[^0-9]", "", purse)) if re.search(r"\d", purse) else None
            uid = sha256(f"2026|{track}|{date}|{stake}".encode()).hexdigest()[:14].upper()
            records.append({
                "id": f"RACE_USA_2026_TOBA_{uid}",
                "track_code": track,
                "date": date_iso,
                "date_source": date,
                "division": division,
                "name": stake,
                "grade": grade,
                "age": age,
                "sex": sex,
                "distance_furlongs": safe_num(distance),
                "surface_code": surface,
                "field_actual": int(field) if field.isdigit() else None,
                "total_purse_usd": purse_n,
                "winner": winner or None
            })
    if len(records) < 500:
        raise RuntimeError(f"Official TOBA table expected >=500 rows; found {len(records)}. Website markup may have changed.")
    ids = [r["id"] for r in records]
    if len(ids) != len(set(ids)):
        raise RuntimeError("Duplicate stable IDs in official table")
    return records


def main():
    rows = parse()
    grades = Counter(r["grade"] for r in rows)
    output = {
        "source": URL,
        "season": 2026,
        "retrieved_at_utc": datetime.now(timezone.utc).isoformat(),
        "summary": {"rows": len(rows), "grades": dict(sorted(grades.items())), "dated": sum(bool(r["date"]) for r in rows), "undated": sum(not r["date"] for r in rows)},
        "races": rows,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(output, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("TOBA data:", json.dumps(output["summary"], sort_keys=True))


if __name__ == "__main__":
    main()
