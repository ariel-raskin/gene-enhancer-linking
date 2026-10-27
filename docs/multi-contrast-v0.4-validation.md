# GEL Web v0.4 validation record

Validation date: 2026-10-27. Scientific baseline: v0.3 merge `9fa6dc18c1eb1fa72b748ed28648b3e00a67a43e`. Implementation branch: `feat/multi-contrast-v04`.

## Local verification

- 37 Vitest tests cover the importer, coordinates, original science definitions, full frozen v0.3 records, grouping, source separation, shared samples, model-versus-track sample references, independent execution, cache identity, deterministic ordering/IDs/exports, malformed metadata, missing features, invalid assemblies, cancellation and failure isolation.
- 11 Playwright tests cover the existing three input paths plus experiment folder selection, manifest application, readiness/exclusion, cross-contrast gene filtering, actual analysis, experiment ZIP contents, corrupted-source failure, cancellation, responsive layout and a larger processed-data workload.
- Python: 15 passed and 1 optional real-pyBigWig integration skipped on native Windows. Seven new checks include independent analytical signal parity across two perturbations × three times and registry structure. Linux CI installs the optional BigWig dependency and also exercises the real-track integration.
- Typecheck, lint and Next.js production build passed locally. No dependency additions were needed for v0.4.

The frozen JSON was also checked once against temporary, unmodified v0.3 scientific source files retrieved directly from commit `9fa6dc1`; all three full-record comparisons passed. Temporary baseline code was removed. The persistent regression test uses the committed golden file, not generated expected results.

## Synthetic experiment outcome

The committed 51-file fixture has eight proposed comparisons, 18 distinct sample IDs including two shared baseline IDs, six complete treatment/time comparisons, one missing enhancer table and one incompatible assembly. The valid subset produces 18 primary statistical candidate rows and 18 separate track-only rows. Three contrasts include BigWigs; one displays individual replicate tracks while retaining both libraries in its differential-model sample references. No empirical inference is claimed from its illustrative table statistics.

The missing and incompatible contrasts remain incomplete unless explicitly excluded. A separate browser test corrupts a normalized gene strand: exactly one contrast fails and the other five valid contrasts complete. Cancellation terminates the experiment worker and labels unfinished comparisons without converting them to successes. A unit test aborts after the first success and confirms that the remaining ready work is not executed; excluded/incomplete states are preserved. Duplicate candidate IDs within a single evidence layer fail that contrast explicitly.

## Regional resource observations

These are local Chromium/Windows measurements, not capacity guarantees:

| Workload | Processing observation | Result/caching observation |
|---|---|---|
| Committed small experiment | About 0.3–0.5 s from run to completion; UI timer continues | 36 retained primary plus track rows; about 0.14 MiB serialized-size estimate; four cache hits; about 2 MiB signal-block cache estimate |
| Generated six-contrast statistics workload | 1,000 genes and 1,000 enhancers per contrast; 739,938 input bytes; about 0.35 s processing in the measured run | 11,994 candidate rows; 36,743,510-byte retained-result estimate; about 64 MB browser main heap after ZIP export in that run |

The small fixture's observed main heap varied roughly 31–50 MB across runs. Browser-reported heap is the main context only and excludes worker heap, decoder/native buffers and total browser process memory. The larger workload is a processed-table scaling check; it does not demonstrate chromosome-wide BigWig performance. Region/file/block/retained-output limits are guards, not validated maximum-throughput claims. Reports exported by the running application include the actual retained counts and cache estimates for that run.

## Scientific and export checks

The browser's genes, feature effects/uncertainties, enhancer intervals, all candidate rows and classifications remain identical to the pinned v0.3 examples. Every valid multi-contrast result matches separate execution. Adding contrasts or reversing file selection order leaves earlier scientific output and candidate IDs unchanged. Candidate tables, BEDPE and interact text are deterministic; elapsed times, file modification times and ZIP archive timestamps are provenance, not deterministic science fields.

Python independently reconstructs the fixture signal and agrees on peak intervals, morphology, pair membership, distances, TSS/strand offsets, direction and tiers; effect tolerance is `1e-6` log2 units to accommodate BigWig float32 storage and Python output rounding. Coordinate conversions and zero-based half-open anchors retain their source-specific rules.

The complete BEDPE has 12 fields, including explicit encoded contrast ID and assembly. UCSC interact has 18 fields. Per-contrast files retain the existing exporter schema. Model and track layers remain separate, source p-values stay attached to exact original features, and no relationship p-value or combined causal score is created.

## Privacy and deployment validation

Playwright request capture during real local-file analysis requires same-origin application asset requests and no POST requests. The experiment and analysis workers have no upload client. Synthetic example loading retrieves only public fixture assets. Source filenames, contents and generated coordinates are not sent to analytics or a processing server.

Desktop matrix and explorer screenshots were visually inspected. A mobile overflow found during review was corrected by constraining the experiment grid and table scroll containers; the browser test asserts that the full page fits a 390-pixel viewport while wide tables scroll internally.

GitHub CI, PR checks, Vercel preview access and post-merge production verification are recorded in the release PR and final release report. A Vercel protected-preview login page does not count as application verification. The same Playwright suite can target an accessible deployment using the documented test-only `GEL_BASE_URL` setting.

## Remaining limits

Validation uses synthetic examples and a generated scaling collection. It does not establish biological enhancer-target accuracy or arbitrary input-schema compatibility. No real whole-genome BigWig screen was attempted. Replicate aggregation and differential-model refitting remain upstream tasks. Annotation and normalization provenance may remain unverified; missing library identities are reported and never converted into extra replication. Statistical sample IDs that contradict available normalized columns or a contrast-specific design fail that contrast.
