# GEL Web v0.4 — Multi-contrast experiment screening

## Supported workflow

Select a processed experiment folder or add files incrementally in the universal workspace. When multiple comparisons are detected, GEL shows a contrast readiness matrix. A single comparison can also use **Organize as experiment**, or retain the established simple workflow. Files remain browser-local.

1. Review proposed comparisons and open a matrix row to inspect assignments.
2. Declare the experiment assembly, annotation provenance, source model, and track normalization. A per-contrast override can identify a genuine incompatibility.
3. Review controls, treatments, perturbations, times, sample IDs, track source types and exact file bindings. Names and directory structure produce proposals, never independently verified experimental identity.
4. Confirm reviewed metadata, exclude comparisons if desired, and analyze the ready subset.
5. Search a gene across contrasts; retain concordant, discordant, weak and insufficient rows. Download the complete experiment package.

All comparisons use the existing coordinate, interval distance, peak morphology, pseudocount and evidence-tier definitions. v0.4 adds orchestration and provenance; it introduces no new score, differential fit, biological replicate inference, or statistical pooling.

## Group detection and corrections

The structural detectors from v0.3 remain the format interface. A `_vs_` directory or differential filename proposes a contrast; recognized `known_gene`, `eRNA`, and `intermediate` subdirectories can establish a group boundary when a contrast name is absent. Unscoped strand tracks are grouped using condition/time clues and attached to a uniquely matching statistical comparison when possible. Shared annotations and control tracks remain available by reference. Generic names, multiple possible controls and repeated files per role require an explicit binding.

Identical text in different comparison folders is retained: equal bytes do not establish that two contrast-specific measurements are the same experiment. The simple view still reports duplicate roles. The experiment view resolves duplicates within each comparison instead of discarding valid comparisons. A complete eNRSA catalog and a complete R-DESeq2 catalog in the same combined group require explicit source selection; their statistics are never pooled.

Each comparison can choose eNRSA, R-DESeq2, BigWig, or combined execution. Bindings can reference any recognized local file with that role. Files can be reassigned to a comparison, made shared/unused, replaced or removed. Add a comparison manually when grouping cannot be inferred. A global sample sheet populates the sample registry; it is not automatically passed as every eNRSA contrast's design table. Contrast-specific design tables remain separate optional provenance.

## Manifest schema 2

`experiment_manifest.json` is a metadata-only, versioned record containing:

- Experiment ID, assembly, annotation provenance, default source model/normalization, regional scope and analysis scope selection.
- A single sample registry: exact sample ID, condition, time, biological replicate label, technical batch, confirmed matched block, and provenance. Blank or unestablished fields remain blank.
- A condition registry. Reusing the exact control condition ID and sample IDs references the same underlying controls.
- Ordered contrasts: stable ID, display label, control/treatment condition references, perturbation/time, control/treatment model-sample references, separate control/treatment track-sample references, source types, selected evidence mode, file bindings, coordinate declarations and confirmation/exclusion state.
- Local relative paths, file roles, byte sizes, modification times, recognition evidence and SHA-256 for files small enough to hash locally (up to 2 MiB). Large tracks are not fully read just for fingerprinting.

The exported manifest can be selected with its local files and applied through **Apply experiment metadata**. Relative paths must match the selected collection; missing paths stay unresolved. A recorded size or available checksum mismatch is reported. Application clears contrast confirmations so the researcher reviews source declarations again. This is not independent validation of normalization or sample lineage. Unknown assemblies are not inferred from a BigWig header, and chromosome aliases are not silently rewritten.

See the runnable [synthetic manifest](../examples/synthetic_experiment/experiment_manifest.json) for a complete example. Its p-values and effects are illustrative synthetic values, not real fitted DESeq2 results.

## Replicates, shared controls and compatibility

Biological replicate labels, technical processing batch, and a matched biological block are distinct metadata fields. GEL consumes supplied model estimates; editing metadata does not refit that model or turn an unblocked result into a blocked one. A/B labels alone do not establish a matched series. The HEL owner-confirmed biological independence remains part of the source audit; it is not generalized to arbitrary files.

The bounded track engine consumes exactly one plus/minus pair for control and one for treatment. Declare each pair as an individual replicate or a condition average. An individual-replicate pair requires exactly one track sample ID in the registry. Statistical/model sample references are separate: a two-replicate differential result can accompany a one-library display track without losing either provenance record. For example, `controlSampleIds = ["control_A", "control_B"]` and `controlTrackSampleIds = ["control_A"]` describe different evidence layers; they do not establish cross-source compatibility. Additional replicate files remain available for explicit selection or separate descriptive comparisons; GEL does not average them or estimate p-values from them. Averaged signal remains descriptive even if its contributing biological sample IDs are supplied.

Sample IDs cannot appear on both sides of one contrast. Referenced IDs must exist, and a declared sample condition must agree with its contrast assignment. Conflicting referenced sample records block the affected comparison until corrected. Issues in unreferenced sample records remain warnings so valid independent comparisons can proceed. A malformed researcher-edited registry must be repaired before running. For eNRSA, supplied statistical sample IDs are checked against normalized-measurement columns and, when provided, the contrast-specific design sample set. A contradiction fails that contrast. Matching IDs do not independently verify the model. Missing sample identities do not invent replicates: a statistics-only comparison may retain a shared condition reference with incomplete sample provenance.

Declared assembly conflicts block that comparison. Matching declarations leave compatibility unverified when independent source provenance is absent. Combined runs retain model effects/p-values in the primary layer and BigWig morphology/ratios in a separate track layer. Overlap never transfers a p-value to another interval. A numerical failure in either layer marks that contrast failed; other completed contrasts are retained.

## Scope, execution and resource limits

Each experiment uses one configured BigWig region. Existing safeguards remain: four selected tracks per execution, at most 50 Mb, 1 GiB per track, 64 MiB estimated indexed blocks per query, 150 MiB annotation cap, and 300 MiB per statistical text/decompressed file. This milestone does not scan chromosomes or genomes from BigWigs.

By default statistics use all features supplied in their tables. **Restrict statistical candidates to this same regional scope** filters enhancers intersecting the region and genes overlapping its distance flank before pair generation. All contrasts receive the same scope and parameters. Source-specific statistics remain unchanged. BigWig gene measurements retain the v0.3 annotation-envelope integration definition; provide a scan window containing the complete genes of interest to avoid partial-window measurements.

One experiment worker executes comparisons sequentially. At most 24 comparisons, 200,000 retained primary plus track-only links, and a 128 MiB UTF-16 serialized-result estimate are allowed. A contrast that would exceed the retained budget fails explicitly; earlier results remain available. These estimates do not measure browser process peak memory: object overhead, worker/UI result copies, and ZIP generation consume additional memory.

The worker holds exact File references once, caches at most 8 MiB of small decoded text and a 16 MiB conservative signal-block estimate, and reuses regional queries only for the identical File object and region. Cache identity is never a filename guess. Oversized cache entries are not retained. Completion sends only a resource summary after each contrast's result has already been delivered. File discovery reads eight bounded headers at a time and accepts at most 2,000 files per addition. Narrow the region or run a smaller subset if these guards are reached.

Progress reports the current comparison and completed/total count. Cancellation terminates the worker, stops scheduling, labels unfinished contrasts cancelled, and preserves already received successes. Results and downloads refer to a frozen run snapshot; later form edits require rerunning.

## Explorer and exports

The explorer searches gene IDs/symbols across comparisons, filters contrast/evidence/layer, and sorts by contrast, distance or magnitude gap. It displays coordinates/strand, perturbation/time, original effects, SE, adjusted p-values, agreement, magnitude gap, morphology, overlap and compatibility. The gene summary includes genes with zero candidates. Rendering is paginated at 100 candidate rows; gene summary display is capped at the first 100 matching rows, with all rows in the export. No conflicting responses are collapsed into a joint score.

`gel-experiment.zip` contains:

| Path | Contents |
|---|---|
| `gel_experiment_links.tsv`, `.csv` | Complete primary candidate rows with `experiment_id`, `contrast_id`, stable `candidate_id`, control/treatment/perturbation/time, assembly, sample IDs and evidence layer |
| `gel_gene_summary.tsv` | One gene/contrast record with gene effect/SE/padj, coordinates and counts by evidence tier; no pooled p-value |
| `gel_experiment_links.bedpe` | BEDPE columns 1–10, percent-encoded contrast ID in column 11, assembly in column 12 |
| `gel_experiment_links.interact` | UCSC 18-field colored interactions with contrast-qualified names |
| `track_only_experiment_links.tsv`, `.bedpe` | Separate combined-run descriptive track evidence, when present |
| `contrasts/<encoded contrast ID>/` | Existing per-contrast CSV/TSV, BED, BEDPE, colored interact/tier files, provenance, optional promoter results and validation |
| `experiment_manifest.json`, `source_provenance.json` | Reviewed source paths, samples, condition references, bindings and declarations |
| `analysis_parameters.json`, `validation_report.json`, `contrast_status.tsv` | Frozen parameters, each contrast's successful/failed/excluded/incomplete/cancelled state, source validation and resource estimates |

Coordinates are zero-based half-open. `candidate_id = encodeURIComponent(contrast_id) + "::" + encodeURIComponent(original_link_id)`; no input-order indices enter this ID. The original `link_id` and scientific fields remain unchanged in per-contrast exports. Download buttons export complete successful results; review filters do not silently remove rows from the experiment package. ZIP timestamps are ordinary archive metadata, so byte-identical ZIP files are not promised; candidate tables and tracks are deterministic for identical inputs/settings.

## Regression and validation

[Frozen v0.3 records](../examples/regression/v03-single-contrast.json) pin all genes, effects, enhancer intervals, candidate links and classifications for the three existing synthetic paths at release commit `9fa6dc18c1eb1fa72b748ed28648b3e00a67a43e`. The v0.4 extraction reuses the same scientific functions. Browser unit tests compare full records against this fixture and compare every new comparison against independent single-contrast execution, including shared-file cache use and reversed input order.

The multi-contrast fixture has two perturbations, three complete times each, two shared baseline samples, separate A/B identities, explicit averaged/replicate track metadata, a missing enhancer table, an incompatible build, and conflicting responses. A/B track signals in this artificial fixture are deliberately identical, so their supplied average is exact. This exercises metadata/execution, not empirical biological variability.

Python independently reconstructs the synthetic signal analytically and checks peak intervals, morphology, candidate membership, distances, strand position, effects (absolute log2 tolerance `1e-6`) and tiers against the frozen browser records for six treatment/time combinations. The real pyBigWig integration test remains enabled where the optional dependency exists. These are scientific regression/parity tests, not independent functional validation.

Playwright exercises local folder import, grouping, confirmation, exclusion, worker execution, cross-contrast gene search/filtering, ZIP contents, a corrupted contrast and cancellation. Request checks require same-origin application requests only and zero POST requests during local-file analysis. The synthetic buttons retrieve only public static fixtures. No hosted computation, input logging or genomic-data telemetry is added.

## Limits and next milestone

Genome-wide/chromosome chunking and parallel scheduling are v0.5. Replicate aggregation, new differential fitting, BAM/FASTQ processing, statistical pooling and prediction training are outside this milestone. Generic schemas still need deliberate adapters. File names and matching declarations do not prove reference, contrast or normalization compatibility. Conservative candidate evidence supports research review; the negative historical K562 benchmark result remains applicable.
