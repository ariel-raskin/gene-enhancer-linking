# v0.6.1 persistence performance and integrity

Baseline: `945f75d60f99e19bcc7aabdf4da6dbb3f7c8ac19` (v0.6). Development branch: `feat/indexeddb-throughput-v061`.

This changes result storage and diagnostics. Discovery, coordinates, normalization, pseudocounts, classifications, thresholds and statistical interpretations are unchanged. No new statistical fit or predictive score is introduced.

## Measurement design

`scripts/benchmarks/benchmark-storage-v061.mjs` reads the exact released store from Git. `raw` uses its original implementation with an isolated database name. `actual` uses the proposed store. Both use the same lazy scientific row generator, synthetic eNRSA records, 500-row batches, strict durability, query population and exporters. The fixture is the existing 1,200-gene / 200-enhancer stress construction (240,000 pairs), reduced to 100 genes for 20,000 pairs. Benchmark condition labels are fixed identically for both layouts. Records are computed, not precomputed outputs.

Two repetitions per size alternate baseline and candidate in separate normal persistent Chromium profiles. The profiles contain synthetic data only. Query totals and first-page identifiers match for genomic order, distance, magnitude, gene, enhancer, contrast and coordinate/morphology queries. Complete TSV counts and FNV-1a diagnostic checksums match; FNV is not a cryptographic hash. Each stored scientific batch independently retains the existing SHA-256 integrity checks. Scientific regression and private Python parity are separate validation tracks.

Persistence wall time starts at the storage sink, includes lazy row generation, validation/packing, feature writes, summaries, checkpoints and awaited commits, and excludes parsing/setup, queries, export and deletion. It is not the entire application or BigWig scan time. Synthetic export timings end after the writable closes; subsequent readback verification is excluded. Private UI-harness stream timings additionally include full file row-count readback and removal, and are labeled separately.

Reproduce from the repository root with a running local production server (`npm run build --prefix apps/web`, then `npm run start --prefix apps/web`):

```powershell
$env:GEL_BENCH_ROWS = '20000,240000'
$env:GEL_BENCH_REPEATS = '2'
$env:GEL_BENCH_VARIANTS = 'raw,actual'
$env:GEL_BENCH_EXPORT = '1'
node scripts/benchmarks/benchmark-storage-v061.mjs
```

The default output is `.git/storage-benchmarks-v061`; override `GEL_BENCH_OUTPUT` to retain measurements elsewhere. `GEL_BASE_URL` selects the local workspace URL. Full Git history is needed for the released source. `base,parallel,lean,compact` are optional isolated exploratory variants, not migration implementations. The final runner freezes the candidate module before repetitions and records its compiled hash. Primary measurements predate that runner-only reproducibility refinement; its storage layout and scientific records are the same. Directory file-length diagnostics captured **after run deletion** are not live result footprint measurements; use the explicitly timed origin estimate (and live diagnostic when present) with the stated limitations.

The Windows host has approximately 8 GB RAM and variable background memory pressure. These are paired single-device observations, not hardware-independent throughput guarantees or cold-cache benchmarks. Browser origin usage is an estimate with compaction/reporting lag, not exact physical allocation. Dedicated synthetic profiles are cleaned only after results are recorded.

## Before/after measurements

Medians of two repeats (seconds):

| Rows | Operation | Released v0.6 | v0.6.1 candidate |
|---:|---|---:|---:|
| 20,000 | Persistence pipeline | 8.568 | 6.405 |
| 240,000 | Persistence pipeline | 180.773 | 104.297 |
| 20,000 | Complete TSV | 1.477 | 1.368 |
| 240,000 | Complete TSV | 20.911 | 15.407 |
| 20,000 | Complete ZIP | 10.233 | 12.742 |
| 20,000 | Delete saved run | 0.361 | 0.150 |
| 240,000 | Delete saved run | 14.686 | 9.590 |

The 240,000-row persistence reduction is approximately **42%**, or 1.73 times the throughput. Its individual baseline times were 163.19/198.36 s versus 94.09/114.51 s. The smaller fixture has more noise: 10.83/6.30 s versus 5.96/6.85 s. **There is no demonstrated ZIP speedup**; exporters retain the same implementation and readback path, and observed ZIP times vary substantially.

Both complete 240,000-row TSVs were 126,876,738 bytes with the same diagnostic checksum. Their shorter benchmark labels explain the size difference from the v0.6 UI stress fixture's 147,036,738-byte export. The 20,000-row TSV was 10,479,738 bytes. ZIP sizes differ slightly because provenance now includes schema and profiling diagnostics, and timestamps are run-specific.

Median reported origin usage for 240,000 rows was approximately 211.25 MB versus 118.99 MB (decimal), about 44% lower. The compressed scientific payload was identical: 7,960,468 bytes in the instrumented trials. Origin estimates are noisy for small runs; use counts and verified output contents to establish completeness, not a storage-size estimate.

Both layouts produced 2,160,000 secondary index entries in 485 batch transactions. Full-origin usage divided by the identical gzip row payload was about 26.5 versus 15.0; this includes feature records, metadata, indexes, journals and free pages, so it is **not** a direct measurement of index-only or filesystem write amplification. The UTF-8 scientific row payload was 237,030,490 bytes. Compressed payload bytes and serialization sizes are exact application byte counts; IndexedDB exposes no counter of physical bytes written per index mutation. Native filesystem I/O and total worker/native peak allocation are not measured by these JavaScript counters.

Indexed-query medians (milliseconds, hydrated first 100 rows plus exact count):

| Rows | Layout | Genomic order | Distance sort | Magnitude sort | Gene search | Enhancer search | Contrast | Coordinate + morphology |
|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 20,000 | v0.6 | 572 | 460 | 369 | 71 | 155 | 478 | 1,746 |
| 20,000 | v0.6.1 | 374 | 270 | 272 | 88 | 207 | 365 | 1,410 |
| 240,000 | v0.6 | 5,444 | 4,162 | 3,765 | 140 | 270 | 3,818 | 22,189 |
| 240,000 | v0.6.1 | 3,670 | 5,155 | 4,730 | 95 | 212 | 2,182 | 18,929 |

These include bounded batch decompression/checksum validation, not just index seeks. Results and counts matched exactly. Distance/magnitude pages were slower in the larger candidate trial; compact keys are not a universal query speedup. Composite residual filters still walk the selected index population and are a remaining latency limitation.

## Actual bottleneck and alternatives

Disjoint stage measurements in a 240,000-row baseline trial found approximately 102.8 of 121.0 commit seconds waiting for queued rows and gene-summary requests. The nested last-row drain diagnostic was 102.2 s, showing that most of that interval precedes completion of row/index writes. It must **not** be added again to the parent interval. Synchronous projection/enqueue took about 10.3 s; serialization/encoding/hashing/compression together about 5.1 s. The final transaction-completion wait was about 1.8 s; quota checks about 0.28 s. Browser APIs do not expose the CPU time of each internal secondary-index mutation; index ablation and layout comparisons measure their combined effect.

Exploratory 20,000-row repeated trials:

| Design | Observation / decision |
|---|---|
| Original nine indexes | About 4.95–5.03 s under the initial load |
| Queue gene-summary reads together | About 4.76–5.02 s; modest effect, not the principal bottleneck |
| Also remove duplicate chromosome index | About 4.34–4.36 s; genomic-order index has exactly the same key path |
| Also use compact numeric primary/run keys | About 3.71–4.09 s; retained all required query and sorting capabilities |
| Append-only compressed batches | Already the payload architecture in v0.6; retained |
| OPFS payload plus IndexedDB indexes | Not adopted: compressed payload is a small fraction of footprint; row/index draining dominates. Moving only payloads would leave that cost and introduce cross-store crash coordination. Existing sequential OPFS results are not a complete database comparison. No claim of a benchmarked full hybrid is made. |
| Deferred index construction | Not adopted: store-wide backfill/version-change transactions would block existing runs and complicate cancellation/recovery. Fully searchable commits are retained. |
| Drop useful distance/magnitude/tier indexes | Not adopted: it would trade write speed for global sorting/filtering scans and change the equivalent query workload. |
| SQLite WASM | Not installed or claimed benchmarked. Native compact-key gains were measurable without adding a VFS, locking or deployment integration layer. |
| Relax durability | Not adopted; earlier comparisons showed no reliable advantage. Strict transactions remain. |

The exploratory instrumentation originally used per-request completion handlers; the final implementation observes only the last row request. The primary release comparison uses the uninstrumented original baseline. Profiling overhead and device load are therefore not mistaken for an algorithmic improvement.

## Schema and existing saved runs

Database name remains `gel-results-v1`; IndexedDB schema version advances to **2**. The upgrade is additive. Original `rows`, features, payloads, checkpoints and run metadata remain intact. No original numerical record is rewritten or automatically deleted.

New runs receive an internal numeric key from `runKeys` in the same creation transaction as their UUID-based run record. `rowIndex` has primary key `(numeric run key, ordinal)`, with a unique `(numeric run key, layer, contrast, source link ID)` index. The other indexes retain ordering, distance, magnitude, gene, symbol, enhancer, contrast and tier functionality with numeric run prefixes. Genomic chromosome queries reuse the order index. There are still nine secondary entries per new row including uniqueness; the gain comes primarily from smaller keys and references, not omitting required functionality.

Public candidate identifiers and result ordering remain unchanged. Numeric storage ordinals are internal and do not replace source or candidate IDs in exports. Payloads, summaries, uniqueness, checkpoints and counters still commit together. Summary reads are queued together within that transaction; no biological measurements are aggregated differently.

Schema-1 runs are read through their original indexes and remain explorable/exportable. Their numerical records are read-only; explicit deletion or marking interrupted remains available. A native browser test compares their unchanged metadata/rows, creates and deletes a neighboring schema-2 run, and terminates a worker during an active transaction. Pending rows/checkpoint/count changes roll back together. No source-validated resume is implemented. An old open tab may need closing/reloading for the version upgrade; no automatic reset or downgrade is attempted.

## Profiling contract

`resources.storageProfile` records numeric diagnostics only. Major sequential commit stages are quota wait, validation/serialization, row encoding/hash, compression wait, checkpoint hash, transaction creation, checkpoint/run reads, feature enqueue, projection enqueue, queued-row/summary wait, metadata enqueue and final commit wait. Their durations are wall spans, not all CPU time. The row-drain diagnostic is nested. `commitWallMs` is inclusive; `partitionWallMs` is its parent plus generation/packing/metadata work. Do not add parents and children. The legacy `writeMs` field remains for compatibility and can omit the final commit latency.

Counters distinguish attempted from committed rows, commit transactions, class-method read/write transactions, feature adds, summary reads/puts, derived row-index entries and exact compressed/encoded payload bytes. Query/hydration transactions outside the class are not included in class-method counters. The buffer estimate covers current serialization/encoding/payload representations, not JS object, worker or native process peak memory. Checkpoints save recent completed metrics; an interrupted run's diagnostics can lag while its authoritative row counters remain transactional.

The query worker reports indexed-query and summary wall times separately. Export wall time includes destination-write waits, so those waits must not be added a second time. Neither wall-minus-write-wait nor coarse main-context heap reporting establishes total CPU or native memory use.

## Release validation and real data

In progress: final full regression suites, real chromosome-21/1 reruns and the annotated-genome trial at signal floor **0.08** and distance **100,000 bp**. No whole-genome completion is claimed until its terminal state, saved counts and full export have been checked. Private source files and derived coordinates remain outside Git and deployment assets.

Browser limitations and safety ceilings remain as documented in [v0.6](persistent-results-v0.6.md): bounded batches and queries, explicit storage budgets/quota reserve, no safe resume, no permanence guarantee, 64 MiB whole-Blob fallback, and a configured 16 GiB direct ZIP ceiling. Firefox/Safari and native save-dialog interaction are not established by Chromium/OPFS-handle tests.
