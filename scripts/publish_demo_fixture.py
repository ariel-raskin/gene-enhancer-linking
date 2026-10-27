"""Copy computed synthetic outputs into the small static Next.js demo fixture."""

from __future__ import annotations

import csv
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "examples" / "demo" / "results"
DEST = ROOT / "apps" / "web" / "public" / "demo"
DEMO = ROOT / "examples" / "demo"


def main() -> None:
    if not (SOURCE / "gel_links.tsv").is_file() or not (SOURCE / "summary.json").is_file():
        raise SystemExit("demo outputs are missing; run the GEL CLI first")
    DEST.mkdir(parents=True, exist_ok=True)
    with (SOURCE / "gel_links.tsv").open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle, delimiter="\t"))
    by_pair = {(row["enhancer_id"], row["gene_id"]): row for row in rows}
    if len(rows) != 6 or len({row["enhancer_id"] for row in rows}) != 3:
        raise SystemExit("synthetic fixture changed unexpectedly: expected 3 signal intervals and 6 pairs")
    if by_pair.get(("chrDemo:1900-2100", "GENE_CONC"), {}).get("evidence_tier") != "moderate":
        raise SystemExit("expected the designed outward candidate to be effect-threshold concordant")
    if by_pair.get(("chrDemo:3900-4100", "GENE_CONC"), {}).get("evidence_tier") != "discordant":
        raise SystemExit("expected the designed unidirectional candidate to be discordant")
    summary = json.loads((SOURCE / "summary.json").read_text(encoding="utf-8"))
    if summary.get("interact_validation", {}).get("valid") is not True:
        raise SystemExit("synthetic UCSC interact export did not pass structural validation")
    numeric_fields = {"enhancer_start", "enhancer_end", "gene_start", "gene_end", "tss", "distance_bp",
                      "midpoint_to_tss_bp", "transcription_oriented_offset_bp", "enhancer_log2fc",
                      "enhancer_se", "enhancer_q_value", "gene_body_log2fc", "gene_body_se",
                      "gene_q_value", "magnitude_gap_log2fc"}
    bool_fields = {"direction_agreement", "both_significant", "overlaps_promoter"}
    for row in rows:
        for key in numeric_fields:
            if row.get(key, "") == "":
                row[key] = None
            else:
                row[key] = float(row[key]) if any(char in row[key] for char in ".eE") else int(row[key])
        for key in bool_fields:
            value = row.get(key, "")
            row[key] = True if value == "True" else False if value == "False" else None
    (DEST / "gel_links.json").write_text(json.dumps(rows, indent=2) + "\n", encoding="utf-8")
    names = ("gel_links.tsv", "gel_links.csv", "enhancer_candidates.tsv", "enhancers.bed",
             "gel_links.bedpe", "gel_links.interact", "gel_links_high.bedpe", "gel_links_moderate.bedpe",
             "gel_links_weak.bedpe", "gel_links_discordant.bedpe", "gel_links_insufficient.bedpe",
             "gel-results.zip", "summary.json", "summary.md", "provenance.json", "sample_metadata.tsv")
    for name in names:
        source = SOURCE / name
        if source.is_file():
            shutil.copy2(source, DEST / name)
    (DEST / "tracks").mkdir(parents=True, exist_ok=True)
    for track in (DEMO / "data").glob("*.bw"):
        shutil.copy2(track, DEST / "tracks" / track.name)
    shutil.copy2(DEMO / "genes.tsv", DEST / "genes.tsv")
    (DEST / "enrsa").mkdir(parents=True, exist_ok=True)
    for table in (DEMO / "enrsa").iterdir():
        if table.is_file():
            shutil.copy2(table, DEST / "enrsa" / table.name)
    print(f"Published {len(rows)} computed candidate rows to {DEST}")


if __name__ == "__main__":
    main()
