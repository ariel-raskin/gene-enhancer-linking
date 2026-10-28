# v0.6 validation record

## Release status

Feature branch `feat/persistent-results-v06`, based on `73921fe66cf8514e97e5cf76ec564ab5616b0850`. Release checks and dense-workload results are recorded here; final CI and production verification are linked from the release pull request. No claim of unrestricted default-density whole-genome capacity is made.

## Established checks

- 69 TypeScript unit tests pass, including all frozen scientific fixtures, generator/collector parity, storage-backpressure failure propagation and ZIP64 CRC/abort tests.
- Windows Python: 17 passed, one optional pyBigWig integration skipped. Linux CI retains the optional integration.
- Typecheck, lint and production build passed on the final implementation. Final-head CI push and PR runs 40620330050 and 40620335256 passed all Python/web jobs (18 Python tests, 68 TypeScript tests, 15 active browser tests and two opt-in private skips).
- Browser experiment tests exercised six successful shared-control contrasts, one incomplete and one excluded comparison, separate model/track layers, corrupt-contrast isolation and cancellation.
- Saved synthetic results reopened after page reload. Filters preserved the saved set; deleting a run removed its candidate rows. An actual browser filesystem handle exercised direct ZIP streaming and CRC validation. The automated test supplies an OPFS handle, not a human-operated native save dialog.

## Storage measurements

Windows 11, Chromium 156.0.8078.4. The host has approximately 8 GB physical RAM and was under heavy memory pressure; measurements are not hardware-independent performance promises.

| Trial | Records | Write time | Query / other evidence |
|---|---:|---:|---|
| Early off-record IndexedDB prototype | 20,000 | 1.67 s | Two 100-row pages: 12 ms; not normal-profile persistence evidence |
| Normal persistent profile, compressed rows and indexes | 20,000 | 11.85 s strict | Two pages: 1.81 s under host pressure; all 20,000 rows traversed by pagination |
| Same normal-profile test, relaxed durability comparison | 20,000 | 14.36 s | No demonstrated speed advantage; strict commits retained |
| OPFS sequential append in normal profile | 19,735,640 bytes | 243 ms | No query index; not comparable to a complete indexed database |

Native tests verified identical retry no-op, conflicting checkpoint rejection, duplicate rejection, transaction rollback containing both a new and duplicate row, configured quota failure, origin-headroom failure, cancelled-run write rejection, exact gene lookup, sorting, coordinate filtering and exact paged counts. SQLite WASM was assessed from official documentation, not benchmarked or installed.

## Private real-data evidence

Only later multiNF direct-coverage averaged tracks were used: four strand tracks totaling 1,103,731,786 bytes, plus the compact explicit gene annotation. No private files, coordinates or locus results are public fixtures.

The completed chromosome trial used the original 0.08 signal floor and 100 kb distance:

- 30,809 candidate links; 84 committed batches.
- Processing 25.12 s; storage-write time 9.69 s; estimated uncompressed payload 79,496,606 bytes.
- Direct TSV: 20,286,717 bytes, 30,809 data rows, 21.49 s.
- Compared with the independent v0.5 Python chromosome oracle: exact candidate membership, coordinates, morphology and classifications; zero mismatches in the compared scientific fields; maximum numeric difference `1.11e-16`.

Early whole-genome attempts were interrupted during test development/resource protection and are **not completed genome screens**. The usual Playwright off-record context was unsuitable as evidence of normal-profile disk persistence. A dedicated normal profile was subsequently used. After interruption, its database reopened with 99,000 committed rows, 354 checkpoints, exact indexed count 99,000 and a 100-row page; origin usage was approximately 209 MB versus 303 MB estimated uncompressed payload. It was explicitly marked partial and deleted through the storage API. No resume or genome completion was claimed.

Concurrent browser suites caused timeouts and one actual browser quota error on the memory-constrained host. Browser tests now run with one worker. An initial large export also exposed repeated decompression from interleaved index traversal; exports now traverse deterministic compressed batches once per file. Final dense and serial regression trials below supersede these development attempts.

## Dense synthetic capacity

A normal-profile, one-contrast processed-data screen generated every pairing between 1,200 synthetic genes and 200 enhancer features within 100 kb:

- **240,000 complete saved candidates**, exceeding the previous 200,000 experiment-retention guard; 484 committed batches at the default 500 records.
- 267.85 s processing, including 262.42 s measured write work on this resource-constrained Windows host.
- 484,834,592 bytes estimated uncompressed payload; 256,434,227 bytes measured origin usage.
- 100-row keyset pagination, exact gene lookup (200 candidates), and discordant filter (100 candidates) passed.
- A direct-file TSV stream wrote **147,036,738 bytes / 240,000 data rows** in 24.62 s without a complete download Blob.
- Observed main JS heap after the screen: approximately 10 MB. This does not measure worker heaps, native buffers, browser caches or complete process peak memory.

This artificial all-to-all local geometry is a storage/execution stress fixture, not a biological benchmark. It contains no HEL measurements or coordinates. Final configurable-batch and release reruns are recorded separately.

## Capacity and unsupported cases

The legacy single-view guards remain. Persistent mode replaces retained pair arrays with bounded database writes, not unlimited storage. IndexedDB overhead, journals, browser quota, source-reader caches and OS pressure remain relevant. Payload estimates, main JS heap, worker memory, native buffers and physical storage are different quantities. Only origin usage and limited main-heap observations were measured; no complete process/worker peak-memory bound is claimed.

Safe restart/resume, cross-tab job coordination, Firefox/Safari validation, native save-dialog interaction and unrestricted archive-size capacity are not established. Ordinary downloads are whole-Blob fallbacks capped at 64 MiB. Direct ZIP64 archives have a 16 GiB configured ceiling, not a benchmark-proven capacity guarantee. The scientific reference, thresholds and negative functional benchmark remain unchanged.


## Default-density genome interruption and independent chromosome-1 parity

A dedicated normal Windows Chromium profile scanned the annotated primary-genome scope at signal floor 0.08, maximum distance 100 kb, 1 Mb query chunks, one analysis worker, 1,000-row write batches and a 4 GiB estimated-payload budget. The four source BigWigs total 1,103,731,786 bytes. This is the later multiNF direct-coverage build, not the legacy HOMER-normalized tracks. The 42,611-locus annotation spans 24 primary contigs / approximately 3.088 Gb. Unselected track-index alternative contigs were recorded explicitly.

The run was interrupted after approximately 47.9 minutes of recorded progress. It did **not** complete the genome and did **not** reach its configured quota. Low-memory host pressure and indexed-write throughput were the observed capacity constraints; no complete process memory measurement was available.

- Reopened and independently counted **956,687 committed candidate rows**, 1,268 checkpoints; run counter and indexed count agreed.
- 2,445,651,912 bytes estimated uncompressed payload; origin estimate 1,368,696,438 bytes against approximately 12.1 GB reported browser quota.
- Completed chromosome partitions: 1, 10, 11, 12, 13, 14 and 15; chromosome 16 was partial. These were lexicographic chromosome order, not a random genome sample.
- State explicitly `cancelled`, `complete: false`. No automatic resume was attempted. All committed records were traversed to a private gzip recovery artifact (90,237,520 bytes); this development recovery harness is separate from the application export benchmark. No data were sent to an application analysis backend.
- Source files, private profiles, full results and exact paths remain outside Git. No private candidate coordinates are published.

The completed chromosome-1 partition contained **3,989 genes, 73,772 enhancer-like regions and 276,369 candidate links**. Independent Python recomputation on HPC used only the existing normalized BigWigs and original reference implementation:

| Job | Purpose | State | Elapsed | MaxRSS |
|---|---|---|---|---|
| 75270 | Full chromosome-1 reference recomputation | COMPLETED / 0 | 1:01 | 3,193,388 KiB |
| 75397 | Field-by-field browser/Python comparison | COMPLETED / 0 | 0:10 | 534,244 KiB |

Both used `normal`, account `biochemistry`, one CPU and 8 GiB, with 30- and 15-minute bounds. The original sequencing/project outputs were read-only; validation artifacts were staged separately. Candidate membership, coordinates, morphology and evidence classes matched exactly. All 17 scientific link fields and the compared gene/enhancer measurements passed; maximum absolute LFC difference was `8.89e-16`, baseline signal sums were identical. No functional accuracy inference follows from implementation parity.

## Failure and recovery scope

A saved run cannot be restarted, even when claimed execution wrote zero rows. Frozen parameter/experiment mismatch and initial source metadata mismatch reject before computation. Checksums reject corrupted decoded scientific payloads. Deletion or mutation during export causes snapshot/count failure and aborts finalization. Feature/row byte packing is tested independently of record-count limits. These are integrity checks, not safe source-validated resume.

The lower-signal repeated private harness initially reused its previous finished UI status after deleting a run; it failed with an undefined run. The harness now waits for the newly created run ID before waiting for completion. This was a test synchronization error, not evidence of successful completion of the second case. Only subsequent measured results are reported as completed.

## Release interpretation

This release supports tested chromosome-scale real data and larger persisted candidate populations than v0.5's retained-result cap. **Dense unrestricted whole-genome completion remains unvalidated.** The largest verified recovered population is 956,687 rows; its source analysis is partial. The largest fully completed synthetic screen is 240,000 pairs. Per-chromosome scientific guards, configurable payload limits and explicit failure states remain. Reducing database index/write amplification and repeating the default-density genome trial on a documented device is the next capacity milestone; adding a new scientific score is not required.


## Final implementation capacity reruns

Commit `5c1aa39` (plus documentation-only release records) completed the same 240,000-row synthetic workload with terminal partition markers and byte-budget validation:

| Environment | Inclusive processing | Write-work metric | Direct TSV export | Measured origin usage |
|---|---:|---:|---:|---:|
| Windows 11 / Chromium 156.0.8078.4, production build | 509.86 s | 496.00 s | 51.59 s | 248,243,213 bytes |
| Ubuntu GitHub runner / Chromium, CI dev server | 113.84 s | 109.23 s | 9.04 s | 265,616,232 bytes |

Both retained 240,000 rows in 485 checkpoints, with 484,834,642 bytes estimated uncompressed payload. Both direct exports were exactly 147,036,738 bytes / 240,000 data rows. The second-run cancellation check stopped after actual row commits and verified that cancelled-run counters equal indexed rows. The approximately 23.1 MB main-heap reading is an endpoint observation, not a worker/native/process peak. Write-work accounting ends when counters are staged and may exclude the final transaction's completion latency; inclusive processing is the appropriate end-to-end timing.

The final-head Linux native-storage suite traversed all 20,000 rows, verified gene/contrast-union counts, coordinate/morphology filtering, rollback, corruption, deletion during export, double-start rejection and oversized field/byte packing. Strict writes took 3.44 s, relaxed 3.85 s; two pages took 376.5 ms. OPFS sequential writes took 48.1 ms for 19,735,640 bytes without an index. Durability remains strict. These measurements are not universal storage benchmarks.


The final Windows production-build browser suite passed **15 tests / two intentional private skips in 12.7 minutes**. The 20,000-row native strict test took 5.46 s versus relaxed 10.07 s; two pages took 989.8 ms. All retry, rollback, quota/headroom, corruption, snapshot deletion, byte-packing, double-start and count assertions passed. Local BigWig, eNRSA, R-DESeq2, folder import, corrections, combined-input incompatibility and privacy assertions also passed. No local failure was hidden by the successful CI run.


## Final lower-signal private chromosome trials

Using the same four real BigWigs / 588 annotated chromosome-21 genes / 46,709,983 bases, 100 kb distance, 1 Mb chunks and 1,000-row write batches:

| Signal floor | Retained peaks | Links | Complete processing | Direct TSV export | TSV size |
|---|---:|---:|---:|---:|---:|
| 0.04 | 12,057 | 36,030 | 29.80 s | 4.97 s | 23,731,699 bytes |
| 0.02 | 14,030 | 40,197 | 41.15 s | 6.19 s | 26,481,092 bytes |

Every streamed TSV row count matched the stored count, both runs were complete, and page timer ticks continued during computation. Origin estimates were 75,592,649 and 112,419,706 bytes; these are point-in-time origin usage, including possible database free pages after the prior run's deletion, not isolated physical payload sizes. Estimated uncompressed payloads were 93,289,510 and 104,574,736 bytes. Captured application requests showed no POSTs or foreign-origin requests. No raw data or candidate coordinates were exported to the public repository. These are chromosome-only sensitivity trials; the lower-threshold whole genome was not established after the default-density genome remained incomplete.


## Final real shared-control contrast trial

A separate chromosome-21 run used six averaged strand BigWigs (1,628,648,435 bytes total), the same 2,197,669-byte annotation, 100 kb distance and 0.08 floor. The experiment registry held six biological sample identities: the same two zero-hour controls referenced by both treatment contrasts, plus two treatment samples per condition. Owner-confirmed A/B biological independence was recorded; no matched-series or technical-batch assertion was added. Averaged tracks remained descriptive, with no fitted statistics or pooled significance.

- Both selected contrasts successful; two unused automatic proposals explicitly excluded.
- **60,981 saved rows**: 30,809 dTAG and 30,172 AGB1; 89 checkpoints.
- Processing 78.44 s; measured write work 64.95 s; 157,433,690 bytes estimated uncompressed payload and 103,952,137 bytes observed origin use.
- Direct TSV: **44,986,591 bytes / 60,981 data rows**, 14.26 s; main-page timer continued for 749 ticks during processing.
- Single-versus-multi dTAG comparison: exact membership / 30,809 rows / all 17 compared scientific fields unchanged (numeric tolerance 1e-12). Both contrasts exported the same control sample identities. No p-values were combined.
- Captured application requests: no POSTs or foreign origins.

The first two-contrast private harness waited for a manual organize button although multi-contrast selection had already opened experiment review. That harness was stopped before analysis; it now accepts either supported entry path and applies bounded action waits. The corrected run above passed. Synthetic CI already tests both folder-driven automatic and manual-organize entry paths.

Private full tables, reports and browser profiles remain under the researcher's separate validation workspace; only aggregate performance and parity findings are public. The remaining release action is public production verification after green final-commit checks and merge; the Vercel preview is account-protected and was not workflow-verified.


Final ordering review added a regression with distinct composed/decomposed Unicode identifiers that compare equal under locale collation. Reversing input initially changed the generator's tie order; locale-independent code-unit tie ordering now passes. No identifiers are normalized or collapsed, and no membership, effect, evidence, coordinate or frozen fixture definition changed. The complete TypeScript suite is now 69 tests; the 68-test capacity measurements above predate this ordering-only correction. Final-commit CI and public production verification are recorded in release PR #9.
