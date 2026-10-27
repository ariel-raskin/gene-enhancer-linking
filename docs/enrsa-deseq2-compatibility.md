# HEL eNRSA / DESeq2 compatibility inventory

**Audit date:** 2026-10-27
**Primary dataset:** `/gs/gsfs0/users/araskin/PRO-seq/1_HRB_dAB_1-2-4hr_JCb`
**Status:** Interface specification from read-only inspection. No analysis engine or source files were modified.

## Scope and main conclusion

The source tree contains two different eRNA differential-analysis products and two different BigWig-generation routes. GEL must identify which feature catalog and statistical table a file belongs to before combining it with tracks. Files with the same sample names do not imply identical feature definitions, normalization, or statistical models.

The eight available eNRSA comparisons are the most direct compatible source for gene-body, promoter-proximal and eNRSA enhancer/eRNA effect estimates. The separate `eRNA_diff` featureCounts/R-DESeq2 branch provides statistics for its own merged peak catalog and can be used as an alternate enhancer feature source. It is not a replicate of the eNRSA enhancer analysis and should not be merged as if the rows or p-values were interchangeable.

## Sample design and statistical provenance

`eRNA_diff/quantification/sample_metadata.csv` has columns `Sample,Treatment,Timepoint,Replicate`, 19 libraries, and explicit A/B labels. The owner confirms A and B are independent biological replicates. The matching of A across all conditions to a common biological series is not established by this metadata alone. The eNRSA setup script derives `batch_A`/`batch_B` mechanically from those labels; that is a blocking variable, not independently documented technical processing batch.

The published directory `eNRSA_regular_wo_batchC` is explicitly generated with `USE_BATCH=false`. Each contrast was built from two control and two condition libraries and analyzed separately. `eNRSA/utils.py::run_deseq2` uses PyDESeq2 with `design_factors='condition'` and contrast `case` versus `control`; when the optional batch is present, it uses `['condition','batch']`. The inspected comprehensive design has 18 libraries in nine groups (dTAG 4 h excluded), with one A and one B in each group. A treatment-coded group-only matrix is full rank (9/9); group plus A/B block is also full rank (10/10). Thus a `~ group + replicate_block` sensitivity model is estimable on these 18 libraries. This algebraic rank does not establish that A/B are matched series; and the batch column is not evidence of technical batch. The actual published fits are group-only, one contrast at a time. The eight eNRSA comparisons share the same 0 h control libraries, so separate contrast estimates are dependent. The output is not a single joint time-course model and does not include between-feature covariance.

The separate eRNA R script `eRNA_diff/differential_analysis/run_deseq2.R` also runs each treatment/time condition versus the same 0 h control separately, with R DESeq2 `design=~Condition`. It filters features with `rowSums(count >= 10) >= 2`, estimates size factors within each contrast's subset, and writes `baseMean,log2FoldChange,lfcSE,stat,pvalue,padj`. It marks significant regions using `padj<0.05` and `abs(log2FC)>log2(1.5)`. The single-library dTAG 4 h group has only three total samples including controls and is skipped. Replicate labels are not used as a block in this R script.

The eNRSA pathway uses a different model/normalization relationship: the gene-body PyDESeq2 fit obtains median-ratio size factors per contrast; eNRSA records their reciprocals as `nf.txt`. Those same factors are supplied to promoter-proximal and enhancer comparisons. See [BigWig provenance](proseq-bigwig-provenance.md) for how the track script further averages NF values across a sample's contrast appearances.

The successful eNRSA output tree contains count/result tables and per-contrast `nf.txt`/design metadata, but no fitted `DeseqDataSet`, RDS, model covariance, or coefficient covariance artifact was found. The only `deseq2.pkl` reference in the eNRSA source is an error-dump path. Model-derived uncertainty is present as per-feature `lfcSE` in the result tables; shared-contrast covariance and enhancer-gene cross-feature covariance cannot be recovered from the delivered output files alone.

## eNRSA output compatibility matrix

Paths below are relative to `eNRSA_regular_wo_batchC/<CASE>_vs_0hr/` unless noted.

| File or pattern | Format and relevant fields | Role | Essential for precomputed-statistics import? | Coordinate / identifier handling | Distribution assessment |
|---|---|---|---|---|---|
| `known_gene/gb_change.txt` | TSV: `Transcript,Gene,baseMean,log2FoldChange,lfcSE,stat,pvalue,padj` | Primary gene-body differential estimates and uncertainty | **Yes** for gene-body statistical support | No coordinate columns. Join on the exact `Transcript` and `Gene` key to `known_gene/normalized_pp_gb.txt`; do not map only by symbol if transcript keys disagree. | Study-derived; do not publish without data-release/owner review. |
| `known_gene/pp_change.txt` | Same statistical columns as GB | Promoter-proximal differential estimates | Optional, strongly recommended as a separate supporting response | Same transcript/gene join. Keep separate from gene-body values. | Study-derived; do not publish without data-release/owner review. |
| `known_gene/normalized_pp_gb.txt` | TSV; `Transcript,Gene,chr,start,end,strand`, then sample columns grouped as `ppc_`, `ppd_`, `gbc_`, `gbd_` | Coordinates, representative transcript-level normalized measurements, promoter/body counts and densities | **Yes** to add gene coordinates and display sample-level normalized values | eNRSA parses RefSeq GTF start/end as 1-based inclusive and retains them. Convert `[start,end]` to BED `[start-1,end)` before interval operations. Chromosome values require explicit normalization/validation; records with unresolved names (including lowercase `x` observed in some rows) must not be silently coerced. | Study-derived, sample-level values; private by default. |
| `intermediate/count_pp_gb.txt` | TSV: `Transcript,Gene,chr,start,end,strand`, `ppc_<sample>`, `gbc_<sample>`, `gbd_<sample>` families | Underlying feature count matrix/measurements used by eNRSA | Optional for scores-only import; **required** to independently re-fit or audit the model | Transcript-level rows. Coordinate origin follows the retained GTF-derived annotations. Feature definitions differ among promoter count, gene-body count, and density. | Sample-level source measurements; private by default. |
| `eRNA/Enhancer_change.txt` | TSV: `Enhancer_ID,chr,start,end,baseMean,log2FoldChange,lfcSE,stat,pvalue,padj` | eNRSA enhancer differential results | **Yes** when using eNRSA eRNA statistics | Enhancer ID is local to the comparison; stable mapping is the interval coordinates plus ID. Coordinates are BED-derived intervals, treated as 0-based half-open; verify contig aliases and exact interval before linking. | Study-derived; do not publish without data-release/owner review. |
| `eRNA/normalized_count_enhancer.txt` | TSV: `Enhancer_ID,chr,start,end,<sample columns>` | Per-sample enhancer normalized counts | Optional for scores-only import; recommended for QC/plots | Use ID plus exact chromosome/start/end, not ID alone across unrelated experiments. Values are raw bedtools overlap counts multiplied by the eNRSA NF, not coverage-area integrals. | Sample-level source measurements; private by default. |
| `intermediate/nf.txt` | TSV: `sample,nfactor` | Per-contrast reciprocal gene-body DESeq2 size factors | Recommended for provenance validation; not needed to consume already computed effects | The same baseline sample has different `nf` records in different contrast folders. Keep contrast in the key. | Study-derived normalization metadata; private by default. |
| `intermediate/design_table_for_deseq2.txt` | TSV sample rows with `condition` for current outputs; the batch branch also has `batch` | Exact model sample assignment | **Yes** for full statistical provenance; required to re-fit | Bind sample IDs exactly. It is contrast-specific. | Sample metadata; release only under project data policy. |
| `analysis_summary.txt` | Human-readable execution summary | Source comparison, sample identities, model/batch setting, outputs | Recommended, effectively required for provenance | Cross-check with filenames and design table; never infer contrasts only from file names. | Usually safe as methods metadata after path/user information is redacted; inspect before sharing. |

`normalized_pp_gb.txt` represents a reduced gene-feature table. In eNRSA `change_pp_gb`, transcript features are selected by maximum summed promoter-proximal normalized count per `Gene`, then by maximum summed gene-body count, with the first row retained on a remaining tie. This is a representative-feature rule, not a sum of transcript measurements. Preserve the selected transcript key and annotation ambiguity; do not aggregate normalized transcript values by summation.

## Separate eRNA quantification / R-DESeq2 branch

Paths are relative to `eRNA_diff/`.

| File | Fields / semantics | Use and caveats | Distribution assessment |
|---|---|---|---|
| `quantification/bidirectional_enhancers.bed` | Five columns: `Chr,Start,End,Geneid,Score`; no strand field; BED-shaped output | Candidate peak annotation used by this branch. Stable IDs are `Geneid` values such as `Peak_1`. **Do not treat its coordinates as verified BED coordinates:** this file is regenerated from featureCounts/SAF `Start,End` without converting the 1-based SAF start. | Study-derived catalog; private by default until release review. |
| `quantification/total_counts_filtered.txt` | featureCounts TSV: `Geneid,Chr,Start,End,Strand,Length,<19 library columns>` | Raw integer total counts for the filtered merged peak catalog. Essential for re-fitting its R-DESeq2 results. | Sample-level source measurements; private by default. |
| `quantification/forward_strand_counts_filtered.txt`, `reverse_strand_counts_filtered.txt` | Same feature columns and libraries; generated by featureCounts `-s 1` and `-s 2` respectively against `all_peaks_merged.saf` | Strand-oriented support measurements. These labels are featureCounts stranded-assignment modes relative to the SAF feature strand; they must not be assumed to mean genomic plus/minus BigWig tracks without checking feature orientation and library strandedness. | Sample-level source measurements; private by default. |
| `quantification/sample_metadata.csv` | `Sample,Treatment,Timepoint,Replicate` | Explicit 19-library sample mapping. Essential to interpret counts. | Project metadata; release only under project data policy. |
| `differential_analysis/<condition>_vs_Control_results.csv` | `Chr,Start,End,Region_ID,baseMean,log2FoldChange,lfcSE,stat,pvalue,padj,Comparison,Significant` | Per-contrast R-DESeq2 results. Essential for using this branch's statistical evidence. Coordinates are carried unchanged from the SAF-based featureCounts annotation and are therefore 1-based inclusive, not BED intervals. Convert `Start` to `Start-1` when creating a BED/BigWig interval; retain raw source coordinates. | Study-derived; do not publish without data-release/owner review. |
| `quantification/bidirectional_filter.R` | Filtering logic, not a data matrix | Defines the catalog filter. Default `BIDIRECTIONAL_RATIO=0.001`; a region is kept if, in **any** sample labeled Control, reverse count is positive and forward/reverse exceeds 0.001. This highly permissive asymmetric condition does not establish independently demonstrated bidirectional transcription. | Analysis code; check source license and include required attribution if redistributed. |

The raw featureCounts header records featureCounts v2.1.1 and the `-s 1` / `-s 2` commands. The original `consensus/all_peaks_merged.bed` has intervals such as `chr1 190995 192145` (width 1,150 bp). Its counterpart `consensus/all_peaks_merged.saf` retains the same Start/End values, while the featureCounts row reports `Length=1151`, consistent with SAF's 1-based inclusive width. The featureCounts SAF specification defines Start and End as inclusive ([official Rsubread manual](https://www.bioconductor.org/packages/release/bioc/manuals/Rsubread/man/Rsubread.pdf)); BED uses 0-based half-open coordinates ([UCSC bedGraph specification](https://www.genome.ucsc.edu/goldenPath/help/bedgraph.html)). Because `bidirectional_filter.R` copies the returned Start/End fields unchanged into `bidirectional_enhancers.bed`, that filtered file's BED-shaped coordinates are one base to the right at the start relative to the source BED. The original peak count/effect is still attached to its SAF feature; use an explicit normalized interval `[Start-1,End)` for browser overlap and preserve original SAF fields. This is a verified coordinate-conversion gap, not a genome-build mismatch.

The `forward`/`reverse` filtered matrices and `total_counts_filtered.txt` share the filtered row set, but the count-based R estimates still differ from eNRSA's region table in catalog construction, normalization, and model implementation. `BIDIRECTIONAL_RATIO` is a catalog inclusion rule only; it is not evidence that every kept interval is truly bidirectional.

## Minimal upload sets

### Minimum for statistically supported gene-centric candidate screening

Use one consistent analysis branch and a single genome build:

1. Experiment manifest with samples, treatment, time, biological replicate, control relationship and contrast IDs.
2. `known_gene/gb_change.txt` plus `known_gene/normalized_pp_gb.txt` for each contrast (or equivalent unified gene TSV with gene-body effect, SE, p/padj, coordinates, strand, IDs).
3. `eRNA/Enhancer_change.txt` for the chosen enhancer catalog (or equivalent enhancer TSV with interval, effect, SE, p/padj and ID).
4. Statistical-method metadata naming software/version, count source, model formula, normalization and reference/control level.
5. Genome assembly and chromosome alias map; coordinate convention per table.

For full sample-level traceability and quantitative response plots, add `known_gene/normalized_pp_gb.txt`, `eRNA/normalized_count_enhancer.txt`, and the design table. For independent re-fitting or detailed measurement audit, add `count_pp_gb.txt`, `nf.txt` for every contrast, enhancer raw count matrices, and the source sample metadata. BigWigs are not required for differential concordance if the tables already contain compatible statistical features; they add morphology and visual context.

### Small eNRSA manifest example

```yaml
schema_version: 1
experiment_id: hel_runx1_bcor_dtag_1h_example
genome:
  assembly: GRCh38
  chromosome_style: chr-prefixed
  coordinate_system:
    enhancer_features: zero_based_half_open
    gene_features: one_based_inclusive
  gene_annotation: RefSeq-hg38.standard.gtf
  annotation_version: "record exact file checksum/release"
analysis:
  pipeline: eNRSA
  pipeline_version: "record source revision or source-file checksums"
  differential_engine: PyDESeq2
  design: "~ condition"
  normalization: "per-contrast DESeq2 median-ratio size factors; nf=1/sizeFactor; NF used for promoter/enhancer features"
  spike_in: false
contrasts:
  - id: dTAG_1hr_vs_0hr
    condition: dTAG_1hr
    control: 0hr
    gene_body_results: eNRSA_regular_wo_batchC/dTAG_1hr_vs_0hr/known_gene/gb_change.txt
    promoter_results: eNRSA_regular_wo_batchC/dTAG_1hr_vs_0hr/known_gene/pp_change.txt
    gene_measurements: eNRSA_regular_wo_batchC/dTAG_1hr_vs_0hr/known_gene/normalized_pp_gb.txt
    enhancer_results: eNRSA_regular_wo_batchC/dTAG_1hr_vs_0hr/eRNA/Enhancer_change.txt
    enhancer_measurements: eNRSA_regular_wo_batchC/dTAG_1hr_vs_0hr/eRNA/normalized_count_enhancer.txt
    design_table: eNRSA_regular_wo_batchC/dTAG_1hr_vs_0hr/intermediate/design_table_for_deseq2.txt
    normalization_factors: eNRSA_regular_wo_batchC/dTAG_1hr_vs_0hr/intermediate/nf.txt
samples:
  - id: 0hr_A
    treatment: Control
    time: 0h
    replicate: A
    role: control
  - id: 0hr_B
    treatment: Control
    time: 0h
    replicate: B
    role: control
  - id: dTAG_1hr_A
    treatment: dTAG
    time: 1h
    replicate: A
    role: treated
  - id: dTAG_1hr_B
    treatment: dTAG
    time: 1h
    replicate: B
    role: treated
```

Use a local `files:` section with paths/checksums for uploaded objects in a real manifest; do not hardcode HPC paths into public application examples.

## Coordinate and identifier mapping rules

- **Genome:** These outputs declare `hg38` in the eNRSA command. Treat this as GRCh38/hg38 only after the uploaded manifest says so. Assembly equality is required for combined mode; liftover is not an automatic compatibility fix.
- **Annotation version:** The command uses `/gs/gsfs0/users/araskin/eNRSA/ref/hg38/RefSeq-hg38.standard.gtf`. The analysis summary records the path and basename, but no RefSeq release/date or annotation checksum was found in the reviewed summary. The assembly is declared; exact annotation vintage remains unverified.
- **Chromosomes:** eNRSA `refine_chr` transforms annotation contig names, and actual gene rows include mixed forms (for example `chr5` and lowercase `x` were observed). Normalize only through an explicit alias table and record every conversion. Unmapped contigs remain unjoinable.
- **Gene coordinates:** `process_gtf` reads the RefSeq GTF start/end integers and retains them; GTF is 1-based inclusive. Convert to BED as `start0=start1-1; end0=end1`. Keep raw and converted fields.
- **eNRSA enhancer coordinates:** eNRSA enhancer intervals are built from BED-derived regions and output `chr,start,end`. Treat as 0-based half-open when the source BED is supplied/verified; otherwise mark origin unknown and do not use exact overlaps until source interval provenance is available.
- **eRNA R table:** `Start,End` come from SAF and are 1-based inclusive. Convert to `[Start-1,End)` for BED/BigWig operations. `bidirectional_enhancers.bed` has the same SAF coordinates copied without conversion and is not safe as a canonical BED source; prefer `consensus/all_peaks_merged.bed` or preserve and correct the SAF annotation with a recorded transform.
- **Feature IDs:** eNRSA `Enhancer_ID` is local to a comparison. Join by ID plus exact interval. Gene differential rows join on the exact `Transcript` composite and `Gene` pair to the matching coordinate/measurement output. eRNA branch `Region_ID`/`Geneid` refers to its own peak set. Cross-catalog maps are interval-overlap relations, not identity, and may be one-to-many.

## Proposed validator behavior for GEL Web

| Check | Block combined analysis when… | Warn / continue when… |
|---|---|---|
| Assembly | Required assembly is missing or inputs specify conflicting assemblies | User chooses BigWig-only descriptive mode with unknown build; disable genomic pair/link exports until specified |
| Coordinates | Coordinates are malformed, negative after conversion, or source convention is unknown for an exact overlap/statistical join | Valid source-specific convention is known and conversion applied (for example SAF 1-based inclusive `start-1,end`); retain raw and normalized coordinates in provenance |
| Chromosome names | Contig names cannot be reconciled for a requested overlap | Explicit aliases (e.g., `1` ↔ `chr1`) resolve; log all changes and dropped contigs |
| Sample/contrast map | Differential contrast endpoints cannot be matched to metadata or sample IDs conflict | Extra unmodeled sample columns are excluded only after user confirmation and explicit exclusion report |
| Differential statistics | A region is about to inherit another feature's p-value/SE because it overlaps | A region overlaps a measured feature but is not the same interval: show overlap annotation without transferring statistics |
| Normalization provenance | Combined mode would mix incompatible sample scaling definitions with no declared interpretation | Track method is unknown but the user requests morphology-only display; label scale unverified and omit quantitative cross-sample comparisons |
| Strand | Library strandedness/track orientation is unknown and strand-aware morphology is requested | Unstranded total signal can still be shown descriptively; disable bidirectional/asymmetric class calls |
| Statistical model | Model contrast/reference or uncertainty field mapping is ambiguous | Missing SE/p/padj is preserved as missing; keep descriptive effect if valid, but suppress significance-dependent class |
| Feature identity | Counts/stats rows fail exact ID/coordinate join | Unmatched peaks remain as BigWig-discovered candidates with `no_feature_stat`; unmatched stats rows are reported separately |
| Quantitative agreement | Track and count effects disagree strongly after matching exact samples, regions, normalization, and orientation | Agreement is approximate: display a diagnostic warning and both estimates, never overwrite one with the other |

BigWig-derived peaks without an exact measured feature can be returned as morphology-supported candidates with coordinates, signal metrics and `differential_stat_status=unavailable`. GEL must not propagate a nearby feature's significance. A user-requested approximate-overlap annotation may be shown as a distinct relation with overlap length/fraction, never as an exact identity.

## Combined-input behavior recommendation

### A. BigWig-only

Read plus/minus signal, quantify signal descriptively, detect candidate transcription peaks, and plot them. Do not create p-values, adjusted p-values, standard errors, or “significant response” labels from averaged BigWigs. If only condition-averaged tracks are supplied, replicates and inferential uncertainty are unavailable. A pseudocount fold change may be shown as a descriptive signal ratio only when its scale and value are clearly labeled.

### B. eNRSA/DESeq2-only

Use supplied enhancer and gene coordinates/effects/statistics to enumerate candidate pairs and classify response concordance. Require explicit contrast metadata, genome/coordinate definitions, feature identity mapping and model provenance. Retain eNRSA gene-body and promoter-proximal results separately. The current eight contrast tables share controls; do not treat them as independent replicates or combine their p-values as if independent.

### C. Combined

Use eNRSA/DESeq2 estimates as the sole source of differential effect and inferential statistics. Use BigWigs to show strand-specific morphology, local track context and visualization. Link statistics only to the same feature identifier and exact interval (or an explicitly approved one-to-one harmonization); for BigWig-only peaks with no corresponding statistical feature, report descriptive evidence only. Show track/count agreement diagnostics, and retain both values when they differ.

This design gives researchers one workflow without pretending that averaged track ratios reproduce model-based effects. The simplest safe default is: import tracks and processed tables together when available; otherwise allow either mode independently with mode-specific labels and disabled unavailable claims.

## Browser-side implementation recommendations

- Collect an explicit manifest and sample-to-condition mapping before enabling analysis. Show every validation result, coordinate conversion, excluded row, unmatched feature and scale provenance in a downloadable report.
- Parse processed TSV/CSV inputs in a Web Worker to keep the interface responsive. Build exact join keys from the assay/catalog ID and normalized interval; only allow interval-overlap joins as separately labeled annotations.
- Keep differential statistics as the authoritative evidence fields. Render BigWigs as track context using indexed/range access; do not download or expand an entire genome-wide BigWig into browser memory. A browser viewer may use local file handles; analysis of large files should use a local Python worker or user-controlled compute environment.
- Do not send private tracks or count matrices to the static Vercel site. If remote processing is introduced later, make storage, access control, data deletion, and compute authorization an explicit separate service.
- For BigWig-only input, display descriptive signal changes and disable significance-based controls. For combined mode, expose exact-feature join status and quantitative agreement side-by-side. A nonmatching signal peak remains `statistical evidence unavailable` even when it overlaps a tested feature.
- Preserve original coordinates and values in the export, alongside normalized coordinates and derived values, so a reviewer can reproduce each transform.

## Unresolved questions and risks

1. The extant `normalized_tracks_v1` directory name differs from the legacy script's configured `normalized_tracks`; the exact rename/copy operation was not located. A session-specific IGV track list is also absent, so the actual track set used in any past IGV review cannot be proven.
2. No independent record yet confirms that A and B labels are matched biological series across every condition. Do not use a blocked interpretation as established until sample lineage is confirmed.
3. The HOMER conversion in the legacy track route has not been benchmarked against the direct `multiNF` route at base resolution. Treat the two route outputs as distinct versions.
4. eNRSA's reference annotation and gene coordinate handling retain GTF start values; exact coordinate conversion and the mixed contig spellings need automated validation in the importer.
5. eRNA differential tables use separate feature catalogs and statistical pipelines. Their estimates should not be mixed or deduplicated by symbol/overlap alone.
6. Contrast-specific NF values average over the same shared controls to create display tracks; this is a display normalization convention, not a joint-model estimate of condition effects.
7. The RefSeq annotation release/checksum is not recorded in the reviewed eNRSA analysis summary; record it when making a portable dataset package.
