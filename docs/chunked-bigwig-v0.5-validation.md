# GEL Web v0.5 validation

Date: 2026-10-27. Baseline: v0.4 merge `da074c1046e51295edff9fc68824b76ba54540bb`. Implementation: `feat/chromosome-browser-v05`.

## Release scope

Bounded chromosome execution, selected chromosome sets and capacity-limited whole-annotation execution are implemented. This is not unrestricted default-density whole-genome capacity. The regional engine, frozen scientific fixtures and v0.4 multi-contrast workflow remain regression targets. New scopes use the same peak, integral, pairing and evidence definitions; see [methodology](chunked-bigwig-v0.5.md).

## Automated verification

- **61 Vitest tests**: frozen records; exact absolute-strand sums; shifted bin origins; partial terminal bins; long peaks crossing multiple chunks; gap stitching; negative minus values; divergent/asymmetric/mixed geometry; overlapping genes; TSS distances; chromosome endpoints; contig compatibility/exclusions; missing/corrupt inputs; role/file/contig ordering; shared controls; independent contrasts; cancellation; output limits; metadata duplicates; scoped statistical filtering; and 500-row export boundaries.
- **12 public Playwright tests**, plus an opt-in private-data test skipped in ordinary CI: real local file/folder selection, the existing BigWig/eNRSA/R-DESeq2 paths, experiment review and export, chromosome scope inspection/execution, local negative-minus tracks, cancellation after chunk progress and subsequent recovery, synthetic experiment gene search, ZIP integrity, privacy request capture and mobile overflow.
- **Python on Windows: 17 passed, 1 skipped**. The skipped integration requires the optional pyBigWig package; Linux CI installs it. Existing Python fixtures remain unchanged. The new analytical boundary oracle uses float32 fixture signal and the existing Python geometry classifier.
- Typecheck, lint and optimized Next.js build pass locally. No new runtime dependencies were installed.

Numeric tolerance is `1e-9` log2 units for the new independent-oracle checks and chunk-versus-region tests; coordinates, membership, morphology, tiers and ordinary anchors are exact. The older demo's existing `1e-6` tolerance remains unchanged. Invalid chromosome-end promoter anchors are now clipped when lengths are known; this intentional export correction is separately tested, without changing feature intervals or scores.

The boundary fixture is wholly synthetic: four tiny indexed tracks including negative minus scores, seven gene features across three annotated contigs, one additional unannotated contig, and a partial final base/bin. Its chrA Python oracle has five peaks, five genes and ten positional pairs. Multiple chunk widths, including widths not divisible by the requested bin size, recover the same result. A lazy planner test obtains the first cores of a billion-base scope without allocating the full plan; tiny-chunk plans above the pass budget fail before signal reads.

## Private processed-track validation

No private HEL tracks, derived candidate coordinates, gene-specific findings, locus plots or biological result counts are committed. Complete counts, provenance, example records, ZIPs, comparisons and figures are retained in the private validation workspace and reported to the owner separately.

The verified track build is the **later multiNF direct-coverage** condition-average build. No legacy/HOMER tracks were mixed in. Four local BigWigs total about 1.10 GB (decimal); gene features come from the pre-existing, explicitly converted prototype locus annotation. The original HPC project and source tracks were read-only. No sequencing processing or differential fitting was run.

Measurements were made on Windows 11 Pro 10.0.26300, Playwright Chromium 156.0.8078.4, one contrast, one analysis worker and query concurrency 1. Times below include browser control/measurement and ZIP export, not just the numerical kernel. They are single-machine observations rather than throughput guarantees.

| Scope | Core size | Observation |
|---|---:|---|
| Real locus, 0.4 Mb | 250 kb | Completed, about 1–2 s |
| Real chromosome interval, 10 Mb | 250 kb | Completed, about 2 s |
| One complete chromosome, 46.71 Mb | 250 kb | Completed, about 8–9 s; 374 chunk passes |
| Two complete chromosomes, 97.53 Mb | 250 kb | Completed, about 11 s with an explicitly shorter distance window; 782 passes |
| All annotated chromosomes, 3.088 Gb | 1 Mb | Completed, about 89 s; 6,204 passes; explicitly higher signal floor and shorter distance window |

The completed whole-annotation trial used `minMeanSignal=100` and `maxDistanceBp=10000`. These are **capacity-test settings**, not recommended biological cutoffs or an optimized score. The annotation represented 24 primary chromosomes; other BigWig contigs were listed as unselected, not silently renamed or discarded. A default-density 100 kb-distance attempt exceeded the output budget. A less restrictive signal-floor trial also exceeded the result-summary budget. Those attempts were recorded as failed, with no truncated screen labeled complete. This limits the release claim: chromosome-scale screening and whole-annotation screening that fits the declared budgets work; arbitrary default-density whole-genome retention does not.

Observed conservative in-flight signal-array estimates were about 2.4 MB for the chromosome trial and 4.2 MB for the completed whole-annotation trial. Main-context heap estimates were roughly 26 MB in that private run and about 68 MB in the old regional comparison. **Neither is peak browser memory**: Chromium heap reporting is coarse, does not include the analysis worker, native decoder buffers or Blob storage, and cannot establish a worker-RSS improvement. The whole-annotation UI timer advanced 1,697 times at a requested 50 ms interval, showing that the main UI remained active. Cancellation/recovery was exercised with the synthetic chunk workflow. Constrained mobile-device whole-genome throughput remains untested.

### Independent numerical comparison

- The real locus, 10 Mb interval and complete chromosome matched the independent Web-contract Python oracle in all candidate membership/coordinates, morphology and tiers; maximum observed log2FC difference was about `1.1e-16`.
- The original unchunked regional browser engine also completed the full chromosome and matched that oracle. It took about 6.5 s in its separate run; the chunked path is designed for bounded signal memory, not a claimed speed improvement on this small chromosome.
- The completed whole-annotation run matched **every gene effect**, retained peak coordinate and candidate pair against the independent Python oracle; maximum log2FC difference was below `1e-15`.
- Private strand-specific review plots include an intergenic divergent candidate, asymmetric signal, gene-body/read-through risk, weak response and discordance. Selection is reproducible and automatic. Visual inspection is not experimental or researcher-confirmed functional validation.

The original Python demo CLI is not a general numerical oracle for Web discovery: it uses control-only peak discovery and different central flanks. Its implementation/results were preserved. The separate `browser_reference.py` makes the frozen Web contract explicit and independently testable; no scientific equivalence to that older CLI is claimed for arbitrary signals.

### HPC execution

The `normal` partition was verified up before submission. Existing `biochemistry` account conventions and the existing `bwtools` Python/pyBigWig environment were used. Reference scans ran in separate validation storage, not in source pipeline directories.

| Job | Purpose | State | Elapsed | MaxRSS |
|---|---|---|---:|---:|
| 72555 | Initial regional oracle | COMPLETED, exit 0 | 11 s | 588,844 KB |
| 72589 | Regional/chromosome oracle with matching morphology selection | COMPLETED, exit 0 | 8 s | 577,712 KB |
| 72757 | Whole-annotation oracle | COMPLETED, exit 0 | 5 min 17 s | 3,049,176 KB |

The initial submission was rejected for Windows line endings; it was converted to LF before submission. The first regional oracle included a morphology class excluded by the browser defaults; that configuration mismatch was corrected and rerun, without changing either scoring definition. These were validation/setup failures, not hidden successful comparisons. The helper scripts `compare_browser_tracks.py` and `validate_browser_oracle.py` make subsequent comparisons reproducible.

## Privacy, review and release gates

Public E2E request capture permits same-origin application assets and requires no analysis POST or third-party requests. The private test also records request findings locally. No new upload endpoint, analytics client or hosted compute service was introduced. Exported archives contain complete successful comparisons plus explicit failed/excluded/cancelled/incomplete statuses.

Desktop and 390-pixel mobile scope/review layouts were visually inspected; the inspected mobile page width was 390 pixels. Wide tables and metadata reports scroll/wrap within the workspace. Browser formats are structurally validated; this milestone does not claim a new live IGV rendering validation.

GitHub checks, protected-preview accessibility and post-merge production checks are recorded in the release PR. A Vercel login page does not count as preview verification. Only public synthetic fixtures may be used in public deployment artifacts. Real data are selected as browser-local files for opt-in checks and are never published.

## Remaining work

Persistent paged result storage and streaming-to-disk export are required before promising default-density whole-genome output at arbitrary distances/contrast counts. Current feature/result guards remain deliberate. Improve parser-side allocation bounds and measure constrained devices. Extend whole-genome multi-contrast performance studies; current cross-contrast scientific parity is established on synthetic regional/chromosome fixtures. The completed real whole-annotation trial is one contrast. None of these checks establish causal enhancer regulation or independent functional prediction accuracy.
