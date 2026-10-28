# v0.6 validation record

## Release status

Feature branch `feat/persistent-results-v06`, based on `73921fe66cf8514e97e5cf76ec564ab5616b0850`. Release checks and dense-workload results are being recorded here before merge. No claim of unrestricted default-density whole-genome capacity is made.

## Established checks

- 65 TypeScript unit tests pass, including all frozen scientific fixtures, generator/collector parity, storage-backpressure failure propagation and ZIP64 CRC/abort tests.
- Windows Python: 17 passed, one optional pyBigWig integration skipped. Linux CI retains the optional integration.
- Typecheck, lint and production build passed during development; final release reruns are required.
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
