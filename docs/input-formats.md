# Input formats

The implemented Python entry point currently accepts a small, declared genomic region with explicit sample-level strand-specific BigWigs and a gene table. Processed DESeq2/eNRSA, BAM and FASTQ adapters are extension points, not currently executable modes.

## Experiment JSON

Paths are resolved relative to the JSON file. Every sample needs a unique `sample_id`, a `group`, `time`, `replicate`, explicit `is_control`, and paired `plus` and `minus` BigWigs. Control assignment is never inferred from the filename. At least one control and one treatment at the same `time` are needed for a contrast. Replicate labels are recorded, but the demo currently calculates an unpaired group summary; it does not model pairing or batch.

```json
{
  "genome_assembly": "GRCh38",
  "normalization": "Tracks normalized as CPM from the same pipeline version",
  "region": {"chrom": "chr1", "start": 100000, "end": 110000},
  "genes_tsv": "genes.tsv",
  "output_dir": "results/run1",
  "parameters": {
    "peak_bin_bp": 100,
    "min_peak_signal": 8,
    "max_distance_bp": 100000,
    "min_abs_log2fc": 0.5,
    "pseudocount": 1.0
  },
  "samples": [
    {"sample_id":"ctrl_A","group":"control","time":"1h","replicate":"A","is_control":true,"plus":"tracks/ctrl_A_plus.bw","minus":"tracks/ctrl_A_minus.bw"},
    {"sample_id":"pert_A","group":"degrader","time":"1h","replicate":"A","is_control":false,"plus":"tracks/pert_A_plus.bw","minus":"tracks/pert_A_minus.bw"}
  ]
}
```

Each time-specific treatment is compared with controls that have the same time label. For an actual experiment, ensure these groups represent the intended contrast. Reused controls across time points must not be interpreted as independent evidence in downstream models.

## Gene TSV

Header is required. Gene IDs must be unique; transcript-level rows should not be supplied as if they were distinct genes.

```text
gene_id  symbol  chrom  start  end  strand
ENSG...  GENE1   chr1   100000 102500 +
```

Coordinates are 0-based and half-open and must match the BigWig assembly and chromosome names. The package fails on duplicate IDs or invalid intervals; it does not lift coordinates or reconcile annotation systems.

## Outputs

- `enhancer_candidates.tsv`: discovered interval, signal, morphology and overlap flags.
- `gel_links.tsv` / `.csv`: full enhancer/gene coordinates, distance, response values, per-sample group context and evidence class.
- `enhancers.bed`: 0-based enhancer intervals.
- `gel_links.bedpe`: enhancer anchor then strand-aware gene-promoter anchor; ten columns.
- `gel_links.interact`: UCSC `interact` (BED5+13) rows with evidence color field; candidate response categories are visual encodings, not confidence probabilities.
- `gel_links_<tier>.bedpe`: separate tracks for high, moderate, weak, discordant and insufficient response evidence.
- `summary.json`, `summary.md`, `provenance.json`, and `gel-results.zip`.

The complete table retains details that a browser arc format cannot show. `provenance.json` records sample track basenames, size, modification time and SHA-256 for files up to 32 MiB; hashing is skipped for larger tracks to bound input I/O. For large real BigWigs or genome-wide data, use a local/HPC worker and private storage; do not POST sequencing files to the static Vercel frontend.

The tiered BEDPE/interact score is a display code (high 1000, moderate 700, weak 450, discordant 250, insufficient 100), not a probability. UCSC interact `value` records the smaller absolute enhancer/gene log2FC for the pair; `exp` labels the source as perturbation-response. Colors are dark green, light green, orange, red and gray in tier order. Red means discordant measured responses, not experimentally disproven regulation. Generic BEDPE does not standardize per-record colors, so use the UCSC interact file or separate tiered BEDPE tracks when color is important.
