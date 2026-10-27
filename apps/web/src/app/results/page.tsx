"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Pair = {
  link_id: string; enhancer_id: string; gene_id: string; gene_symbol: string;
  chrom: string; enhancer_start: number; enhancer_end: number; gene_start: number;
  gene_end: number; gene_strand: string; tss: number; distance_bp: number;
  treatment: string; time: string; enhancer_log2fc: number; gene_body_log2fc: number;
  magnitude_gap_log2fc: number; direction_agreement: boolean | null;
  evidence_tier: string; morphology: string; overlaps_promoter: boolean;
  candidate_source: string;
};

const labels: Record<string, string> = {
  high: "High statistical support", moderate: "Effect-threshold concordant",
  weak: "Weak concordance", discordant: "Discordant", insufficient: "Insufficient",
};

export default function ResultsPage() {
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [query, setQuery] = useState("");
  const [tier, setTier] = useState("all");
  const [treatment, setTreatment] = useState("");
  const [time, setTime] = useState("");
  const [distance, setDistance] = useState(100000);
  const [sort, setSort] = useState("tier");
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    fetch("/demo/gel_links.json").then((response) => response.json())
      .then((rows: Pair[]) => setPairs(rows)).catch(() => setPairs([]));
  }, []);

  const treatments = [...new Set(pairs.map((row) => row.treatment))].sort();
  const times = [...new Set(pairs.filter((row) => !treatment || row.treatment === treatment).map((row) => row.time))].sort();
  const visible = useMemo(() => pairs
    .filter((row) => (!query || `${row.gene_symbol} ${row.gene_id}`.toLowerCase().includes(query.toLowerCase()))
      && (tier === "all" || row.evidence_tier === tier)
      && (!treatment || row.treatment === treatment)
      && (!time || row.time === time)
      && Math.abs(row.distance_bp) <= distance)
    .sort((a, b) => sort === "distance"
      ? Math.abs(a.distance_bp) - Math.abs(b.distance_bp)
      : sort === "magnitude"
        ? a.magnitude_gap_log2fc - b.magnitude_gap_log2fc
        : ["high", "moderate", "weak", "discordant", "insufficient"].indexOf(a.evidence_tier)
          - ["high", "moderate", "weak", "discordant", "insufficient"].indexOf(b.evidence_tier)),
  [pairs, query, tier, treatment, time, distance, sort]);

  const exportRows = selected.length ? visible.filter((row) => selected.includes(row.link_id)) : visible;
  const download = (format: "tsv" | "bedpe") => {
    const content = format === "tsv"
      ? [Object.keys(exportRows[0] ?? {}).join("\t"), ...exportRows.map((row) => Object.values(row).join("\t"))].join("\n")
      : exportRows.map((row) => {
        const start = Math.max(0, row.tss - (row.gene_strand === "+" ? 500 : 100));
        const end = row.tss + (row.gene_strand === "+" ? 101 : 501);
        const score = { high: 1000, moderate: 700, weak: 450, discordant: 250, insufficient: 100 }[row.evidence_tier as "high"] ?? 0;
        return `${row.chrom}\t${row.enhancer_start}\t${row.enhancer_end}\t${row.chrom}\t${start}\t${end}\t${row.link_id}\t${score}\t.\t${row.gene_strand}`;
      }).join("\n");
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(new Blob([content], { type: "text/plain" }));
    anchor.download = `gel-selected.${format}`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  };

  return <main className="results-wrap">
    <div className="workspace-title"><div><div className="eyebrow">SYNTHETIC EXAMPLE · COMPUTED WITH GEL CORE</div><h1>Candidate evidence</h1><p>Two detected signal peaks are compared against the nearby gene response. Both remain visible.</p></div><span className="pill pill-green">Synthetic · chrDemo · 10 kb</span></div>
    <div className="disclaimer">This is computed from generated plus/minus BigWigs using the Python analysis path. The example is not biological data and has no DESeq2 p-values.</div>
    <div className="results-toolbar">
      <input aria-label="Search gene" placeholder="Search gene symbol or ID" value={query} onChange={(event) => setQuery(event.target.value)} />
      <select aria-label="Treatment" value={treatment} onChange={(event) => { setTreatment(event.target.value); setTime(""); }}><option value="">All perturbations</option>{treatments.map((value) => <option key={value}>{value}</option>)}</select>
      <select aria-label="Time point" value={time} onChange={(event) => setTime(event.target.value)}><option value="">All time points</option>{times.map((value) => <option key={value}>{value}</option>)}</select>
      <select aria-label="Evidence tier" value={tier} onChange={(event) => setTier(event.target.value)}><option value="all">All evidence tiers</option>{Object.keys(labels).map((value) => <option key={value} value={value}>{labels[value]}</option>)}</select>
      <label className="range-control">Distance window <input type="range" min="500" max="100000" step="500" value={distance} onChange={(event) => setDistance(Number(event.target.value))} /> <b>{(distance / 1000).toFixed(1)} kb</b></label>
      <select aria-label="Sort results" value={sort} onChange={(event) => setSort(event.target.value)}><option value="tier">Sort: evidence</option><option value="distance">Sort: distance</option><option value="magnitude">Sort: magnitude similarity</option></select>
      <button className="button button-light" onClick={() => download("tsv")}>TSV ↓</button><button className="button button-light" onClick={() => download("bedpe")}>BEDPE ↓</button>
    </div>
    <div className="results-meta"><span>{visible.length} displayed candidate rows</span><span>{selected.length ? `${selected.length} selected` : "Select rows to export a subset"}</span></div>
    <div className="table-wrap"><table><thead><tr><th></th><th>Evidence</th><th>Gene</th><th>Enhancer interval</th><th>Distance</th><th>eRNA log₂FC</th><th>Gene body log₂FC</th><th>Magnitude gap</th><th>Peak class</th><th>Overlap</th></tr></thead><tbody>
      {visible.map((row) => <tr key={row.link_id}><td><input type="checkbox" aria-label={`Select ${row.link_id}`} checked={selected.includes(row.link_id)} onChange={(event) => setSelected((old) => event.target.checked ? [...old, row.link_id] : old.filter((item) => item !== row.link_id))} /></td><td><span className={`tier tier-${row.evidence_tier}`}>{labels[row.evidence_tier] ?? row.evidence_tier}</span></td><td><strong>{row.gene_symbol}</strong><small>{row.gene_id} · {row.gene_strand}</small><small>{row.chrom}:{row.gene_start.toLocaleString()}–{row.gene_end.toLocaleString()}</small></td><td><code>{row.chrom}:{row.enhancer_start.toLocaleString()}–{row.enhancer_end.toLocaleString()}</code><small>{row.enhancer_id}</small></td><td>{Math.abs(row.distance_bp).toLocaleString()} bp</td><td className={row.enhancer_log2fc >= 0 ? "effect-up" : "effect-down"}>{row.enhancer_log2fc > 0 ? "+" : ""}{row.enhancer_log2fc.toFixed(2)}</td><td className={row.gene_body_log2fc >= 0 ? "effect-up" : "effect-down"}>{row.gene_body_log2fc > 0 ? "+" : ""}{row.gene_body_log2fc.toFixed(2)}</td><td>{row.magnitude_gap_log2fc.toFixed(2)}</td><td>{row.morphology.replaceAll("_", " ")}</td><td>{row.overlaps_promoter ? "Promoter" : "No"}</td></tr>)}
    </tbody></table>{visible.length === 0 && <div className="empty-state">No candidates match these filters.</div>}</div>
    <div className="results-bottom"><span>Responses: {visible[0]?.treatment ?? treatment ?? "perturbation"} · {visible[0]?.time ?? time ?? "1h"} · control-referenced</span><Link href="/downloads">Download complete synthetic result bundle →</Link></div>
  </main>;
}
