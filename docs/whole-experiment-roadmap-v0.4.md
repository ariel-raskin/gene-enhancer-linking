# GEL Web v0.4 — Whole-experiment screening roadmap

## Purpose and scope

The next major milestone is to screen a complete processed PRO-seq experiment in the browser, across multiple contrasts and the genome, using the existing gene-centric definitions and evidence tiers. This is an implementation plan, not a new score. It does not add FASTQ/BAM processing, machine learning, or causal claims. The current bounded single-contrast workflows and Python reference remain the baseline until parity is demonstrated.

## Design constraints

- Keep each contrast's measurements, metadata, and evidence separately addressable. A contrast is not a biological replicate.
- Represent shared controls explicitly. Do not combine contrast p-values or treat repeated-control comparisons as independent observations.
- Keep replicate BigWigs distinct from averaged BigWigs. Require sample/condition/replicate and normalization provenance before replicate-level summaries; averaged tracks support descriptive signal only.
- Retain per-contrast candidate evidence and coordinates in a stable experiment-wide link table. A gene summary may summarize availability and evidence, but must not hide conflicting contrasts.
- Reuse the current peak classes, coordinate transformations, thresholds, and evidence-tier rules. Any changed definition requires a separately versioned scientific change and parity review.
- Keep file contents local. No analysis endpoint or server upload is needed for this milestone.

## Proposed internal experiment model

Introduce a versioned, validated manifest with `experiment_id`, assembly, chromosome naming, annotation provenance, normalization descriptions, and an ordered list of contrasts. Each contrast records a unique ID, control and treatment condition, time point, optional perturbation, samples, replicate labels, optional batch, and whether tracks are replicate-level or averaged. Each sample-track record maps plus and minus files to one sample and one condition. Statistical tables retain their source model and exact feature IDs. Shared samples are referenced by stable sample IDs across contrasts.

Validation should produce three states for each relationship: verified from explicit metadata, inferred and requiring confirmation, or conflicting. Missing metadata can permit separate descriptive workflows, but cannot silently authorize pooled statistical evidence.

## Implementation order

### 1. Freeze current definitions and fixtures

Extract the current one-contrast parsing, interval, morphology, and tier definitions into documented reusable interfaces without altering their behavior. Preserve current examples as golden fixtures. Add a small two-treatment, three-time-point fixture with one shared control, explicit sample IDs, replicate tracks, one averaged-track alternative, an eNRSA directory per contrast, and deliberate conflicting metadata. Expected results include contrast-specific evidence, shared-control flags, and stable exported IDs.

### 2. Add contrast-aware import and review

Extend the smart importer to group files by structural schema and relative contrast directory, then propose (never silently verify) control, treatment, time, sample, strand, and replicate assignments. Let users confirm or correct the proposed manifest. Show shared controls and repeated sample IDs before analysis. Validate each contrast independently, and allow a valid subset to proceed while reporting excluded contrasts.

Acceptance checks: one contrast remains byte/schema compatible with current outputs; multiple contrast groups are not merged; duplicate/conflicting roles are actionable; identical files and assignments are invariant to selection order.

### 3. Batch BigWig queries over genomic regions

Build a genome interval plan once from the annotation and configured maximum distance. Partition each chromosome into bounded chunks with a halo large enough for peak and gene-window operations; assign each interval to one core chunk to avoid double counting. Query each BigWig once per chunk (or grouped interval batch), compute strand-specific coverage and peak morphology, and reuse those arrays for overlapping genes and candidate intervals. Avoid rescanning a chromosome independently for every gene.

Keep the current interval integration, binning, pseudocount, strand sign, morphology, and tier definitions unchanged. The chunk engine must match the bounded engine on the same genomic windows before it can replace the existing path.

### 4. Add bounded worker scheduling and cancellation

Use a small worker pool, initially capped at two workers on mobile/unknown devices and four on desktop, with a conservative override. Process one chromosome chunk per task and transfer compact typed arrays or summarized intervals rather than copying full chromosomes between workers. Set explicit limits for input track count, per-query output, retained candidate rows, and in-flight chunk memory. Estimate memory before scheduling; refuse or ask for smaller scope when the hard budget cannot be met. Support cancellation that stops scheduling, terminates active workers, releases buffers, and leaves no partial result marked complete.

Report progress by completed chunks and contrasts, plus an estimated remaining-work range. Keep intermediate summaries in an incremental store and aggregate deterministically by chromosome, coordinate, contrast ID, and stable feature ID. Do not rely on `navigator.deviceMemory` as a precise measurement; use it only as a conservative hint with fixed ceilings and a user-visible resource profile.

### 5. Build contrast-aware gene summaries and exports

For each gene, show all per-contrast changes, candidate enhancer evidence, signal source type, and compatibility state. Experiment-wide BEDPE rows must identify their contrast and use the same assembly and 0-based half-open anchors as the source result. A ZIP should contain the complete contrast table, a gene-centric summary, per-contrast browser tracks, manifest, parameters, and validation report. Keep discordant and insufficient evidence visible.

### 6. Validate browser/Python scientific equivalence

Retain Python as an independent oracle, not a code-generation target. Add matching fixtures in both runtimes and compare in stages:

1. Imported coordinates and coordinate conversions (exact).
2. Queried strand-specific interval coverage and gene/enhancer integrals (exact where source values permit; otherwise documented floating tolerance).
3. Peak boundaries and morphology classes (exact for deterministic fixture signals).
4. Per-contrast effects and pseudocount calculations (within stated numeric tolerance).
5. Candidate pair membership, overlap flags, evidence class, stable ordering, and BEDPE anchors (exact).

Fixtures should cover chromosome start/end boundaries, adjacent intervals, one-base features, negative-valued minus tracks, asymmetric divergent peaks, overlapping genes, multiple candidate enhancers, missing tracks, non-divisible chunk sizes, halo edges, shared controls, and repeated sample references. Also run row/file-order permutation tests. A whole-genome claim requires successful comparison on representative indexed tracks, not only synthetic windows.

### 7. Scale validation progressively

Run a synthetic multi-chromosome workload, then one representative real chromosome, then the full HEL processed-track workload in bounded stages. Record browser, device profile, track sizes, worker count, peak memory when measurable, runtime, cancellation behavior, and result counts. Test a desktop browser and a constrained mobile profile. The release gate is: no lost/duplicated boundary peaks, deterministic outputs, no unbounded memory growth, and graceful cancellation. If the client cannot finish a declared workload under the hard budget, report that limit rather than falling back to an unplanned hosted worker.

## Resource profiles (initial targets for measurement)

Use conservative starting ceilings, then adjust only from measured browser runs:

| Profile | Concurrent workers | In-flight signal budget | Intended use |
|---|---:|---:|---|
| Constrained/mobile | 1–2 | 128 MiB | Review a few chromosomes or a small target list |
| Standard desktop | 2 | 256 MiB | Typical laptop whole-experiment trial |
| High-memory desktop | 4 | 512 MiB | Opt-in, browser/device permitting |

These are working engineering limits, not guarantees of whole-genome feasibility. Keep a separate limit on retained output rows and allow streaming/download generation so complete tables do not need to remain duplicated in memory. Show estimates and permit cancellation before a large run.

## Definition of done

- Multi-contrast manifest imports correctly with shared-control and replicate/average semantics explicit.
- All valid contrasts execute independently and retain their metadata in a combined experiment package.
- Chunked genome queries are deterministic, bounded, cancellable, and match the current engine on overlapping windows.
- Python/browser parity tests pass for coordinates, signal integration, classifications, candidates, and exports.
- A representative genome-wide workload completes within stated resource limits, with runtime and memory documented.
- No performance result or concordance tier is described as evidence of causal regulation.

## Known limitations to carry forward

BigWigs do not recover replicate-level uncertainty if they are already averaged. Multiple statistical contrasts can share libraries and controls, so experiment-wide summaries must preserve their dependence rather than imply extra replication. Chromosome chunking introduces boundary risks that require halo and deduplication tests. Browser memory varies and cannot be inferred exactly. The Python implementation is a reference for equivalence, not independent biological validation. A complete screen remains candidate discovery for manual review, not functional enhancer-target validation.
