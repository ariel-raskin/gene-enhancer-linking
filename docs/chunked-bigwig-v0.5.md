# GEL Web v0.5 — Bounded chromosome and annotated-genome screening

## Supported scopes

Use **Organize as experiment** after importing files. The existing simple single-contrast view remains available. New experiments default to a selected chromosome; set its exact name from your tracks. Choose an interval, one/multiple chromosomes, or the whole **annotated** genome. The last option means every contig represented in the supplied annotation, not every scaffold in a reference assembly. No contig is excluded by a naming heuristic. Chromosomes above the current typed reader's signed 32-bit coordinate limit are rejected explicitly. Explicit exclusions and other unselected BigWig contigs are exported in `scopePlan`.

Confirm the assembly, normalization, strand roles, source type and contrast as before. **Inspect BigWig scope and estimates** reads annotation and indexed headers in a worker before querying signal. It reports available contigs, selected regions/bases, chunks, budgets and exclusions. Every contrast subsequently validates its own dictionary. Missing contigs, length conflicts, out-of-bounds annotations and malformed tracks fail the affected comparison. A matching dictionary does not independently prove the declared assembly or normalization.

The annotation must contain explicit, unique representative gene features. Use a compact BED/TSV or GTF/GFF with `gene` records. The unchanged importer neither invents gene envelopes from arbitrary transcript-only GTF records nor sums transcript counts. Large reference GTFs may need upstream conversion to a compact gene table.

## Regional audit and scientific contract

The reference is `bigwig.ts` plus the frozen v0.3 records and v0.4 experiment fixture. The new execution path changes scheduling, not these definitions:

- Internal intervals are zero-based half-open; no chromosome aliases or liftover.
- Exact unzoomed BigWig intervals are integrated as `overlap_bp * abs(score)`. Negative minus signal never cancels plus signal.
- Bin width is `max(10, floor(peakBinBp))` (must fit within a core), anchored at the **declared scope start**, with a partial final bin.
- The discovery signal is `(CP + abs(CM) + TP + abs(TM)) / (4 * bin_width)` in integrated coverage units. Active bins meet `minMeanSignal`; gaps up to `mergeGapBp` are bridged. This is a four-track mean, not a condition-total mean.
- Morphology uses control strands only, over the two half-open halves of the final merged interval, clipped to 250 bp from its midpoint. It reuses `classifyGeometry`; no center-base omission or new geometry class is introduced.
- Gene signal integrates **both strands over the supplied annotation envelope**. It is not sense-only eNRSA gene-body counting and can contain antisense/intronic/overlapping transcription.
- Descriptive effect is `log2((treatment_integral + pseudocount)/(control_integral + pseudocount))`. No new SE, p-value or replicate inference is calculated.
- All eligible peaks/genes and all evidence tiers are retained, subject to explicit overlap filters and fail-fast resource limits. Existing direction, magnitude and tier definitions are unchanged. Promoter/body overlap flags refer to the candidate gene; they do not establish absence of overlaps with every other transcription unit.
- Peak IDs retain `chrom:start-end:bwN`, numbered after morphology filtering, in genomic order within each chromosome. Experiment IDs also contain the contrast ID. Changing the declared scope can change bin phase, peak boundaries and numbering; identical scope/settings are reproducible.

### Two reference caveats discovered in this audit

1. The regional reader returns **whole records** overlapping its query. Gene-envelope integration includes the external tails of records crossing an interval boundary; it does not fetch all external signal for partially covered genes. v0.5 reproduces that behavior at the outer scope edges to preserve parity, and clips contributions only at internal chunk edges. Include complete genes in interval scans. Full-chromosome scans have no external boundary records. Discovery bins and enhancer measurements are always bounded by the declared scope.
2. The older Python demo CLI discovers from controls alone and uses different center-flank sampling. Its agreement on the original demo does not prove general equivalence to Web discovery. It is preserved. `gel_core/browser_reference.py` is an independent Python oracle for the explicit frozen **Web** contract, reusing Python's existing morphology function. It is a validation implementation, not a second public analysis path or a new score.

## Chunk execution

`genomic-scope.ts` plans disjoint cores on the original bin grid, rounding requested chunk width down to a whole bin (at least one bin). `chunked-bigwig.ts` runs two passes:

1. Read exact typed-array signal for each core, accumulate gene-envelope integrals with an interval sweep, and stitch active bins across cores. A pending peak can span arbitrarily many cores. Inactive gap signal is measured later if the gap joins a peak.
2. Reread bounded cores and accumulate the finalized peak integrals and its four central morphology measurements. Classify complete peaks, then call the existing indexed `buildLinks` once per chromosome.

A fixed halo cannot guarantee preservation of arbitrarily long merged peaks. Streaming stitching replaces peak-detection halos; global chromosome summaries and the existing TSS index replace per-gene search halos. Each base of a normal interval is owned by exactly one core; each gene and completed peak is emitted once. Chromosome endpoints, gaps crossing cores, long peaks, partial bins and shifted bin origins are tested.

There is one analysis Web Worker. Query concurrency is configurable as 1 or 2 in-flight **chunk reads**, consumed in genomic order; it is I/O overlap, not a multi-core CPU pool. Contrasts remain sequential. Readers use local Blob handles, indexed byte estimates, `getFeaturesAsArrays` without zoom selection, and AbortSignal support. See the [GMOD API](https://github.com/GMOD/bbi-js/blob/main/docs/api.md); implementation is pinned by the existing package lock. A bounded 8 MiB exact-File/exact-query cache can reuse shared controls; it makes no filename-based identity assumptions and is not a chromosome-sized cache.

UI cancellation terminates the worker immediately and marks unfinished contrasts cancelled. Completed contrasts remain reviewable. Programmatic AbortSignal cancellation is checked between chunk batches and passed through indexed signal queries. A failed contrast returns no truncated success. Later valid contrasts can still run. Cross-contrast validated contig-length conflicts fail the conflicting comparison.

## Limits and result handling

| Resource | Limit / behavior |
|---|---|
| BigWig file | 1 GiB each; four selected tracks per comparison |
| Annotation | 150 MiB file; text/decompression guards also apply; at most 200,000 gene features |
| Core | Default 250 kb; configurable 100–1,000,000 bp, aligned to bins |
| In-flight chunks | 1 default, 2 opt-in; lazy core iterator; at most 100,000 chunk passes per contrast |
| Compressed queries | 8 MiB combined / in-flight concurrency per core; checked before data reads |
| Signal arrays | 64 MiB combined estimated in flight; oversized decoded tracks fail explicitly |
| Query cache | 8 MiB, independent of the signal budget |
| Peak summaries | 200,000 retained plus current raw peaks |
| Candidate pairs | Default 100,000 per contrast, configurable up to 200,000; checked during pair enumeration |
| Result summaries | 96 MiB UTF-16 JSON estimate per chunked contrast; experiment retains existing 200,000-row / 128 MiB guards |
| Experiment | 24 comparisons, independently validated; no shared-control p-value pooling |
| ZIP export | 256 MiB uncompressed payload budget; individual table downloads remain available |

These guards are not exact process-memory guarantees. BigWig decoder/index buffers, object overhead, worker/UI structured clones, Blob storage and browser GC add memory. The 64 MiB figure measures/guards signal array backing buffers; it is not a measured browser RSS. A pathologically compressed or malformed input can allocate temporary parser buffers before a decoded-size guard fires. The worker-error path reports failure; no server fallback exists.

Results are accumulated as bounded feature summaries per chromosome, never complete chromosome coverage matrices. The explorer stores references to candidate rows and decorates only the visible page of 100 rows, avoiding a second fully expanded experiment table in the UI. Experiment downloads format 500 rows at a time into native Blobs; ZIP uses STORE and streaming file records instead of retaining every table as a JavaScript string. This increases ZIP size compared with compression. Complete result objects still reside in worker/UI memory while running; there is **no persistent IndexedDB result store**. High-density whole-genome/default-distance output may exceed the explicit guards even when signal queries fit.

Narrowing the scope, raising a signal floor or reducing distance changes the scientific candidate population. GEL never does that automatically to make a job fit. A completed run certifies its recorded scope/settings only, not arbitrary genome-wide throughput on another device.

## Manifest additions (schema 2, optional versioned extension)

```json
{
  "genomicScope": {
    "version": 1,
    "mode": "chromosomes",
    "chromosomes": ["chr21", "chr22"],
    "excludedContigs": []
  },
  "execution": {"chunkBases": 250000, "queryConcurrency": 1, "maxPairs": 100000}
}
```

The existing `scope` interval is retained for interval execution. Older v0.4 manifests lacking `genomicScope` retain their original regional engine and cache behavior. Reselect a genomic scope to opt into chunking. Statistical tables retain all supplied features by default. Optional restriction filters the declared interval or selected chromosome names before pair generation; annotated-genome restriction keeps supplied model features except explicit contig exclusions. A model catalog can differ from the track annotation and remains a separate evidence layer. No statistical values are transferred to newly discovered peaks. Combined layers and shared sample identities retain v0.4 semantics.

A manifest-renamed contrast now excludes an automatically inferred duplicate using the same exact treatment track pair or statistical pair. The duplicate remains visible and can be reviewed; it is not run a second time simply because its inferred name differs.

## Exports and browser coordinates

The same TSV/CSV/BED/BEDPE/interact package and gene explorer are used. Contrast-specific effects and IDs remain separate. `scopePlan`, chromosome summaries, contig lengths, input sizes, query bytes, chunk progress, completion/truncation flags and resource settings are exported in validation/provenance.

Promoter anchors now clip to a validated chromosome end as well as zero. This repairs an invalid end anchor found in the new synthetic chromosome-end fixture; master feature coordinates and evidence remain unchanged. Existing frozen fixtures away from chromosome ends retain identical anchors. Statistical-only inputs without contig lengths retain an explicit bounds limitation; no chromosome lengths are invented. Export colors remain response-evidence categories, not causal confidence.

## Validation and extension

See [v0.5 validation](chunked-bigwig-v0.5-validation.md). Public fixtures are synthetic. Private HEL tracks, candidate coordinates, locus examples and biological result counts remain outside Git and Vercel.

Next priorities: persistent paged result storage and streaming-to-disk archives for default-density whole-genome outputs; stronger decoder-side memory bounds; measured constrained-device runs; then multi-contrast whole-genome capacity studies. No new scoring model, BAM/FASTQ pipeline or mandatory backend is introduced.
