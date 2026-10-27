# GEL Web v0.3 — Universal Smart Importer

**Historical version:** v0.4 now adds multi-contrast review and independent execution; see [current experiment workflow](multi-contrast-v0.4.md). The format and coordinate rules below remain relevant; its one-contrast restriction describes v0.3.

## Summary

The workspace now accepts multiple files or a processed-analysis folder in one local file-selection step. A bounded local detector inspects binary signatures and the first text record/header, then presents every file, preserved relative path, proposed role, evidence, and confidence. Researchers can change a role, remove a file, replace one file, add more files incrementally, and save the reviewed assignments as `gel_experiment_manifest.json`.

Selected file contents remain in browser `File` objects. Import and analysis run in the existing Web Worker pipeline. No user file is sent to GEL or to a third-party service. The synthetic-example buttons retrieve only the small static public fixtures from the GEL website.

## Detector contract

Detectors are registered in `apps/web/src/lib/smart-importer.ts` through `DetectorPlugin`:

```ts
type DetectorPlugin = {
  id: string;
  detect(context: { file: File; relativePath: string; header: string }): DetectorMatch | null;
};
```

Each match returns a proposed role, format, evidence string, confidence, and whether the role needs path-based inference. Add new pipeline support by writing a structural detector and a worker adapter; do not add filename-only recognition as a substitute for schema checks.

### Current detectors

| Input | Structural test | Automatic role behavior | Analysis use |
|---|---|---|---|
| BigWig | Binary magic signature | Plus/minus and control/treatment roles are inferred from path/name clues; otherwise left unassigned | Functional for four tracks over one declared interval |
| GTF | Nine columns, feature record, numeric coordinates | Gene annotation; GTF coordinates are 1-based inclusive | Functional for bounded BigWig analysis |
| GFF3 | Nine columns and GFF-style `key=value` attributes | Gene annotation; GFF coordinates are 1-based inclusive | Functional for bounded BigWig analysis |
| GEL gene TSV | Gene ID, symbol, chromosome, start/end, strand columns | Gene annotation; coordinate convention must be confirmed | Functional for bounded BigWig analysis |
| BED | Numeric chromosome/start/end fields | Annotation role proposed; coordinates remain BED 0-based half-open | Functional for BED6 gene annotation; other BED roles can be corrected manually |
| SAF | `GeneID,Chr,Start,End,Strand` header | FeatureCounts annotation; 1-based inclusive conversion | Functional for R-DESeq gene annotation and BigWig annotation |
| bedGraph | Chromosome/start/end/numeric-value row | Signal file detected, no analysis role assigned | Not yet an analysis input |
| eNRSA `gb_change.txt` | `Transcript`, `Gene`, effect, SE and adjusted-p columns | Gene-body statistics; filename may distinguish `pp_change.txt` | Functional, one contrast at a time |
| eNRSA `normalized_pp_gb.txt` | Transcript/gene coordinates and `ppc_`/`ppd_`/`gbc_`/`gbd_` sample columns | Gene coordinates and measurement provenance | Functional exact feature join |
| eNRSA `Enhancer_change.txt` | `Enhancer_ID`, interval and differential columns | eNRSA enhancer statistics | Functional, source coordinates preserved |
| eNRSA normalized enhancer counts | Enhancer ID and exact interval coordinates | Optional enhancer measurement QC | Optional exact-coordinate validation |
| R-DESeq2 enhancer table | `Chr,Start,End,Region_ID`, DESeq2 statistics | SAF-style differential interval table | Functional after user confirms coordinate convention |
| Gene differential table | Gene ID plus differential columns | Gene-body differential results | Functional with R-DESeq2 enhancer table and gene annotation |
| Sample design / metadata | Sample ID and condition/group fields | Design/metadata role | Optional eNRSA sample provenance; not a full multi-contrast workflow yet |
| eNRSA `nf.txt` | `sample,nfactor` columns | Normalization factors | Optional provenance/QC |
| `bidirectional_enhancers.bed` | BED interval row plus exact known filename | eRNA_diff SAF-derived filtered BED; path-based inference | Optional; its audited start-minus-one correction applies only to this role |
| Gzip text | Local `DecompressionStream` plus structural detector | Same roles as uncompressed tables | Functional where the decompressed text fits the 300 MB cap |

File signatures and schemas establish format, not experiment identity. BigWig condition and strand assignments inferred from names are marked **inferred** and must be reviewed. Explicit user role changes are stored as **user_confirmed**. Structural schema matches are marked **structurally_verified**. Assembly, contrast, sample, treatment, time, normalization and model provenance are not promoted to verified by filenames.

## Assembly and workflow readiness

Readiness is recomputed whenever files are added, removed, replaced, or reassigned. The page lists requirements for:

- BigWig descriptive analysis: control plus/minus, treatment plus/minus, and gene annotation.
- eNRSA statistical analysis: gene-body results, exact gene coordinate/measurement table, and enhancer results.
- R-DESeq2 analysis: enhancer results, gene-body results, and annotation.
- Combined analysis when a complete track group and at least one complete statistical input set are present.

No input mode is required before selection. GEL initially proposes the most complete workflow; if multiple complete workflows are available, a post-import selector appears. The researcher can continue adding files without restarting.

The current analysis engine processes one contrast per run. Files from multiple contrast directories remain distinguishable through their relative paths; repeated role assignments are shown as conflicts, and analysis is blocked until unused contrasts are removed or set to **Unrecognized / inspect manually**. This prevents silently treating shared-control contrasts as independent or pooling them.

The current condition/time form describes one selected contrast. A recognized sample design table is previewed for row/sample counts and declared condition, time, replicate and batch levels, and it is passed to the optional eNRSA validation path. GEL does not yet auto-build or execute an arbitrary multi-condition/time-course model from a sample sheet. Replicate and batch values are reported as written; neither establishes biological independence or matched replicate series.

## Coordinate and compatibility rules

All internal intervals are zero-based half-open. GTF/GFF and SAF genes convert `[start,end]` to `[start-1,end)`. Verified BED is preserved. The R-DESeq2 enhancer importer requires an explicit user choice between SAF 1-based inclusive and BED 0-based half-open; the role detector cannot establish coordinate provenance from column names. The eRNA_diff `bidirectional_enhancers.bed` SAF correction is only applied when that exact role is assigned.

Combined input follows the v0.2 contract: differential tables supply model-estimated effects and p-values; BigWigs supply a separate descriptive signal layer. An interval overlap never transfers a p-value. Combined status remains **Compatibility unverified** unless independent provenance proves assembly, contrast, feature identity, samples and normalization agree. Combined mode offers separate assembly declarations for tracks and statistics and blocks a run when both declarations disagree. Matching declarations are still user-reported, not independent verification. Contrast and treatment/time fields are shared in the current one-contrast UI; verify both source records before using the combined view.

The R-DESeq2 coordinate convention is included in the manifest. A missing or conflicting assembly/coordinate/contrast declaration blocks or separates analysis as appropriate. Chromosome aliases are not silently rewritten.

## Manifest format

The **Save experiment manifest** action exports a compact JSON record. It contains file paths relative to the selected folder when available, file sizes and modification times, current roles, recognition status, confidence/evidence, user-entered experiment fields with status, coordinate conventions, and analysis parameters. It contains no file contents. This v0.3 manifest is an audit export, not yet a reloadable import specification.

Representative shape:

```json
{
  "schema_version": 1,
  "product": "GEL Web",
  "experiment": {
    "genome_assembly": { "value": "GRCh38", "status": "user_confirmed" },
    "control": { "value": "vehicle", "status": "user_confirmed" },
    "treatment": { "value": "degrader", "status": "user_confirmed" },
    "time_point": { "value": "1h", "status": "user_confirmed" },
    "statistical_model": { "value": "PyDESeq2; ~ condition", "status": "user_confirmed" }
  },
  "files": [{
    "path": "contrast_1hr/eRNA/Enhancer_change.txt",
    "role": "enhancerChange",
    "detected_format": "eNRSA enhancer DE results",
    "recognition": "structurally_verified",
    "confidence": 0.99
  }],
  "privacy": { "selected_file_contents_uploaded": false }
}
```

## Resource limits and privacy

Text inputs use the existing 300 MB per-file cap, including a decompressed-output cap for gzip. Small text files (up to 2 MB) may be SHA-256 hashed locally for exact duplicate detection; large tracks and matrices are not read fully just to deduplicate. BigWig processing retains the v0.2 limits: four indexed tracks, one declared interval up to 50 Mb, and 64 MB of combined queried blocks. Annotation and candidate-pair caps remain in the worker. These are guardrails and are not genome-wide support claims.

The Playwright e2e tests verify that user-selected file analysis makes no external requests and no POST requests. The web worker has no upload client. No browser telemetry receives file contents or genomic coordinates.

## Known gaps

- FASTQ/BAM and generic bedGraph are detected but not processed.
- Multiple replicate BigWigs, arbitrary contrast sets, and multi-time-course execution are not supported; one track per role is required.
- Sample sheets are recognized but not used to infer biological independence or paired series automatically.
- Generic pipeline adapters still require deliberate schema and coordinate validation.
- Cross-input compatibility can remain unverified; GEL keeps evidence layers separate in that case.
- Browser memory is the practical limiting factor for large tables; a 300 MB text cap is not a recommended target.
- No predictive accuracy is implied. Concordant transcription remains candidate evidence, not causal validation.

## Tests

`smart-importer.test.ts` covers BigWig signature detection, ambiguous names, eNRSA and R-DESeq2 schemas, sample design, SAF/BED roles, relative folder paths, multi-contrast conflicts, and duplicate text files. `read-local-text.test.ts` covers local gzip and decompression ceilings. Playwright covers multi-file selection, folder selection, role correction/replacement, actual BigWig and eNRSA worker execution, downloads, and no network upload. Existing Python/browser parity fixtures remain unchanged.
