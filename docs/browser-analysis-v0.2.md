# GEL Web v0.2 browser analysis and input contract

**Historical version:** v0.4 reuses this single-contrast engine inside a [multi-contrast workflow](multi-contrast-v0.4.md). The scientific definitions and supported table schemas below remain the reference.

## Scope

This release adds client-side import and analysis for two input paths: (1) four indexed BigWigs for one control-versus-treatment contrast over one explicitly selected interval, and (2) one contrast of eNRSA or eRNA_diff differential tables. Combined mode runs both paths and preserves them as separate evidence layers. It does not upload selected files, run a server-side worker, process BAM/FASTQ, or claim genome-wide BigWig support.

The current K562 CRISPRi evaluation in the research prototype did not demonstrate improved accuracy over distance-only assignment. GEL remains a candidate-discovery and review tool. A pair with concordant nascent transcription is not a validated causal enhancer–gene relationship.

## Browser execution and privacy

The Next.js workspace creates a dedicated Web Worker for import and analysis. BigWigs are wrapped as browser `Blob` file handles; the reader accesses indexed byte ranges for the requested chromosome interval instead of expanding the entire file. The worker enforces a 1 GB per-track file cap, 50 Mb scan-interval cap, 64 MB combined compressed-query cap, 150 MB annotation cap, and 1,000,000 candidate-pair cap. Differential text imports are capped at 300 MB per file. These are guardrails, not a promise that every computer can use the maximum.

The worker has no HTTP, analytics, or upload code. A synthetic-example button fetches only small public synthetic fixtures from the same static site, then passes `File` objects to the worker. User-selected files and generated genomic results are not sent to GEL or another service. The static synthetic-results page may fetch its public JSON fixture separately.

The BigWig reader uses [`@gmod/bbi`](https://github.com/GMOD/bbi-js), which supports `Blob`-backed file handles, indexed region queries, and byte-size estimates. [`generic-filehandle2`](https://github.com/GMOD/generic-filehandle2) supplies `BlobFile`. Local reads use BigWig's 0-based half-open query coordinates. Minus-strand track values may be negative; GEL integrates their absolute magnitude and never cancels plus/minus signal by signed addition.

## Input modes

| Mode | Status in v0.2 | Measurement meaning |
|---|---|---|
| BigWig-only | Functional for four single-contrast plus/minus tracks over one declared interval | Descriptive normalized coverage integrals and pseudocount log2 ratios; no SE or p-value is inferred |
| eNRSA / PyDESeq2 | Functional for the three required files from one contrast | Source-model gene-body and enhancer effect estimates, SE, p-value, adjusted p-value, plus exact gene coordinate join |
| eRNA_diff / R-DESeq2 | Functional for one enhancer-results CSV plus gene-body results and a gene annotation | SAF enhancer coordinates are corrected; gene response results must be supplied separately because this branch's peak differential table does not contain gene-body effects |
| Combined | Functional as two separate runs in one browser session; compatibility is reported | Differential tables remain the inferential layer; BigWig-derived morphology and ratios stay separate unless a future validator proves exact feature, contrast, and normalization compatibility |
| BAM / FASTQ | Not supported | No alignment or quantification is performed |

BigWig input requires the four file roles: control plus, control minus, treatment plus, treatment minus. This release uses one file per role; a file can be a condition average or a single replicate, but GEL does not infer replicate structure from the filename. State the signal scaling/averaging description, assembly, explicit contrast, and annotation. A BigWig header does not prove the genome assembly or normalization history.

The BigWig interval is the scanning window. It must include the genes of interest plus enough flank to find candidate enhancers; the separately configured candidate window is measured from the enhancer interval to the gene TSS. Gene-body signal is integrated across the supplied gene annotation interval. This is not identical to eNRSA's gene-body feature definition, which excludes the promoter-proximal portion.

## eNRSA and eRNA_diff table schemas

### eNRSA required inputs

| File | Required columns | Use |
|---|---|---|
| `known_gene/gb_change.txt` | `Transcript`, `Gene`, `baseMean`, `log2FoldChange` (or audited alias `LFC`), `lfcSE`, `stat`, `pvalue` (or `pval`), `padj` | Primary gene-body differential effects and uncertainty |
| `known_gene/normalized_pp_gb.txt` | `Transcript`, `Gene`, `chr`, `start`, `end`, `strand`; optional measurement families `ppc_`, `ppd_`, `gbc_`, `gbd_` followed by sample identifiers | Gene coordinates and selected representative transcript; optional normalized measurements/provenance |
| `eRNA/Enhancer_change.txt` | `Enhancer_ID`, `chr`, `start`, `end`, `baseMean`, `log2FoldChange` (or `LFC`), `lfcSE`, `stat`, `pvalue` (or `pval`), `padj` | Enhancer response statistics; ID is local to the source contrast and is paired with exact interval coordinates |

`gb_change` rows join to `normalized_pp_gb` by the exact `Transcript` **and** `Gene` pair. The importer does not sum normalized transcript measurements. It errors if more than one differential transcript row maps to a single gene ID, rather than silently collapsing the records. eNRSA retained GTF annotation coordinates as 1-based inclusive; GEL converts gene `[start,end]` to `[start-1,end)` and records both the original coordinate rule and the conversion. The enhancer table is treated as 0-based half-open per the audited eNRSA BED-derived source; where that source provenance is not supplied, the enhancer coordinate check remains unverified.

Minimal local manifest for one eNRSA contrast:

```yaml
schema_version: 1
experiment_id: sample_degrader_1h
genome:
  assembly: GRCh38
  chromosome_style: chr-prefixed
  gene_coordinates: one_based_inclusive_gtf
  enhancer_coordinates: zero_based_half_open_bed_derived
contrast:
  id: degrader_1h_vs_vehicle
  control: vehicle
  treatment: degrader
  time_point: 1h
  model: "PyDESeq2; ~ condition; median-ratio size factors"
files:
  gene_body_results: known_gene/gb_change.txt
  gene_coordinates_and_measurements: known_gene/normalized_pp_gb.txt
  enhancer_results: eRNA/Enhancer_change.txt
optional_files:
  promoter_results: known_gene/pp_change.txt
  enhancer_measurements: eRNA/normalized_count_enhancer.txt
  design_table: intermediate/design_table_for_deseq2.txt
  normalization_factors: intermediate/nf.txt
```

This manifest is a researcher-side record, not an upload control. GEL Web currently asks for these declarations in the workspace and saves them to `input_provenance.json`.

Optional eNRSA inputs:

- `known_gene/pp_change.txt`: separate promoter-proximal differential estimates. These remain a secondary table and are never combined with gene-body estimates.
- `eRNA/normalized_count_enhancer.txt`: optional exact enhancer ID + chromosome + interval measurement QC. Rows that do not match all four identity fields are reported unmatched; no approximate overlap inherits a statistic.
- `intermediate/design_table_for_deseq2.txt`: optional sample/condition provenance table. GEL checks that its sample IDs agree with normalized measurement columns where present.
- `intermediate/nf.txt`: optional `sample,nfactor` normalization provenance.

Sample-level measurement columns are summarized in validation output but not re-fit. The eight time/treatment contrasts in the HEL example share baseline libraries; they must be imported one at a time in this version. Their p-values and effects are not independent observations.

### Separate eRNA_diff R-DESeq2 branch

`differential_analysis/<condition>_vs_Control_results.csv` requires `Chr,Start,End,Region_ID,baseMean,log2FoldChange,lfcSE,stat,pvalue,padj` (additional `Comparison` and `Significant` columns are retained as source metadata when supplied). Coordinates originate in 1-based inclusive SAF rows, so GEL converts `[Start,End]` to `[Start-1,End)`. It is a distinct enhancer catalog and count/model branch from eNRSA. Supply an independent gene-body differential table with a `Gene`, `gene_id`, `geneId`, or `Geneid` key and a gene annotation table. Gene IDs must match exactly.

The optional `quantification/bidirectional_enhancers.bed` file is BED-shaped but the audited eRNA_diff pipeline copied SAF coordinates into it without subtracting one. If selected through GEL's specific optional “SAF start correction” role, GEL converts its start to `start-1` and retains that fact. This file has no differential statistics by itself. When a corrected interval matches a differential row, that row's existing statistic remains attached; GEL never transfers it to another region based on overlap.

## Coordinate checks and historical impact

All internal candidate intervals and BED/BEDPE outputs are 0-based half-open. Conversion behavior is source-specific:

| Source | Source coordinates | GEL behavior |
|---|---|---|
| eNRSA gene coordinates from retained GTF | 1-based inclusive | Convert start minus one; preserve end |
| eNRSA enhancer change | Audited BED-derived, 0-based half-open | Preserve exactly; leave unverified when the originating catalog is not documented |
| eRNA_diff differential results | SAF 1-based inclusive | Convert start minus one; preserve end |
| eRNA_diff `bidirectional_enhancers.bed` | SAF values copied into BED-shaped file | Convert start minus one only in this explicitly selected source role |
| Verified BED and BigWig coordinates | 0-based half-open | Preserve exactly |

#### Historical HEL prototype findings

Read-only inspection of HPC `src/enhancer_gene_linking/core.py`, `pipeline.py`, and `scripts/discover_signal_candidates.py` found that the v1 importer read `bidirectional_enhancers.bed` as BED and retained its coordinates. That file's SAF-derived start is one base larger than the original `consensus/all_peaks_merged.bed` start. Therefore HEL v1 standardized enhancer intervals and downstream v1–v6 positional pairing/browser anchors sourced from that table carry a +1 start offset for this catalog. The effect and count statistics remain associated with the same SAF feature ID; the offset can affect exact boundaries, interval-to-TSS distance at an edge, and promoter/gene-body overlap flags. Historical results are preserved unchanged. v7's `discover_signal_candidates.py` reads the SAF start and subtracts one for its signal-derived reference intervals; those intervals use corrected coordinates.

The historical prototype also compared SAF featureCounts Start/End fields to the BED-shaped filtered file and found exact equality; that confirms the two SAF-derived products share fields, not that either field pair is BED. The original consensus BED and SAF Length (inclusive width) are the evidence for the one-base correction. For a fresh analysis, use source-specific import, preserve raw coordinates, and review the validation report before exporting arcs.

## Compatibility statuses

| Status | Meaning and behavior |
|---|---|
| **Verified compatible** | Required assembly, chromosome mapping, coordinate transforms, contrast/sample assignment, normalization/model metadata, strand orientation, and exact feature identities are explicit and agree. Only exact matched features may share numerical evidence. |
| **Compatibility unverified** | No contradiction is found, but provenance is missing or a mapping is unproven. Keep morphology/track plots separate; do not merge numerical responses or statistical fields. This is the default for combined inputs in v0.2. |
| **Incompatible** | A declared assembly, contig length/name, coordinate convention, contrast, or exact feature definition conflicts. Block combined numeric analysis; the user may still run either source alone where valid. |

Current combined mode deliberately reports compatibility as unverified: the audit showed that eNRSA feature effects and HEL averaged BigWigs use related but nonidentical measurements and normalization factors. The workspace runs the two analyses separately, shows the track-only peak layer separately, and records that no numerical evidence was merged. An overlap is displayed as positional context only, never as an identity or p-value transfer.

## Evidence tiers and exports

- **High:** both exact statistical features pass the configured adjusted-p and effect thresholds and their directions agree. This describes two locus responses, not association significance.
- **Moderate:** response direction/effect thresholds agree, but at least one adjusted-p value is missing or above threshold, or the magnitude gap exceeds the configured strong-tier cutoff.
- **Weak:** effects are compatible but small/uncertain under the chosen thresholds, or the BigWig-only descriptive ratios are modestly concordant.
- **Discordant:** both effects pass the thresholds but directions differ. This does not experimentally disprove a relationship.
- **Insufficient:** a response is missing, near zero, or below the effect threshold.

The minimum effect sizes, maximum magnitude gap, maximum adjusted-p, TSS distance, signal floor, bin size, morphology classes, and overlap filters are saved in `analysis_parameters.json`. `input_provenance.json` records source role, filename, size, modified time, mode, assembly, contrast, and normalization/model descriptions. `validation_report.json` records conversions, row matching, feature counts, compatibility status, processing time, and limitations.

The ZIP includes `gel_links.csv`, `gel_links.tsv`, `gel_genes.bed`, `gel_enhancers.bed`, `gel_links.bedpe`, a UCSC `interact` track plus one per evidence tier, parameters, provenance, and validation report. BED and BEDPE use 0-based half-open coordinates. Filtered direct downloads reflect the current result filters; the ZIP contains the complete candidate table. All exports are prepared in a second Web Worker.

## Synthetic fixtures

`examples/demo/data/` provides the small chrDemo BigWigs and `examples/demo/genes.tsv`. `examples/demo/enrsa/` uses the audited eNRSA headers and coordinates. The workspace's two “Load synthetic example” buttons load those public assets into local `File` objects and run the same worker code used by a researcher-selected file. The fixture is artificial, not a genome assembly, and its p-values are illustrative synthetic values rather than real DESeq2 inference.

## Current limits

- BigWig analysis is one contrast and one interval; it does not estimate biological replication, standard errors, or p-values.
- BigWig-derived gene-body signal uses the supplied annotation interval, not eNRSA's exact gene-body counting interval.
- The browser interface supports one eNRSA/R contrast per run. It does not combine shared-control contrasts as independent observations or refit DESeq2.
- eNRSA table parsing supports audited headers and a limited set of explicit aliases; other pipeline schemas need adapters.
- Chromosome names are compared exactly. There is no implicit `chr` alias rewriting or liftover; a mismatch prevents a safe feature join and is visible in the validation report.
- The selected peak catalog is not a biological enhancer label. Signal geometry can be promoter, gene-body, read-through, or otherwise confounded.
- The single-region browser workflow and candidate cap are intended for bounded research review, not whole-genome throughput.
