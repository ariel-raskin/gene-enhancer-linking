# GEL — Gene–Enhancer Linking

GEL is an open, training-free research tool for screening enhancer-like nascent transcription near perturbed genes. It makes candidate evidence easier to inspect and export. **Transcriptional concordance is not proof of a direct enhancer–gene regulatory relationship.** The independent K562 CRISPRi evaluation in the earlier research prototype did not establish performance gains over distance-only assignment.

## Try the web demo

The web application includes a browser-side analysis workspace. It reads researcher-selected files locally in Web Workers and does not upload user data or run user analysis in the cloud. It supports an eNRSA differential-table contrast, the separate eRNA_diff/R-DESeq2 enhancer-results branch with supplied gene effects, and a bounded single-region BigWig contrast. Use either synthetic-example button to load small artificial fixtures through the same browser analysis code.

```powershell
cd apps/web
npm ci
npm run dev
```

Open `http://localhost:3000`, choose **Open analysis workspace**, and select **Load synthetic BigWig example** or **Load synthetic eNRSA-table example**. Each fixture is artificial and runs through the real local importer/analysis worker; it is not biological data or hg38. The precomputed **Explore synthetic demo** page remains available as a separate Python-generated reference output.

## Run the Python demonstration

Python 3.9+ and `pyBigWig` are required for BigWig inputs. Use Linux or a configured WSL/Conda environment (native Windows `pyBigWig` installation is not validated):

```bash
uv sync --extra bigwig --extra test
uv run python examples/demo/generate_demo.py
uv run gel --config examples/demo/experiment.json
uv run python scripts/publish_demo_fixture.py
```

The demo generator creates paired plus/minus synthetic BigWigs; the CLI then discovers signal intervals in the configured region, classifies strand geometry, quantifies enhancer and gene-body responses, creates all in-range pairs and writes TSV/CSV/BED/BEDPE/UCSC interact exports plus a ZIP. The final command refreshes the small static web fixture. Or use the already generated demonstration outputs served from `apps/web/public/demo/`.

**Scope limit:** The current Python run is a small declared-region prototype. It is not a genome-wide caller, and the sample-level BigWig fold-change demonstration does not calculate DESeq2 p-values. The browser also accepts audited one-contrast eNRSA and eRNA_diff differential tables; see the browser input contract for exact schemas and provenance requirements.

## Project structure

```text
apps/web/                Next.js/TypeScript public interface (Vercel root)
packages/gel-core/       Experiment-independent Python package
examples/demo/           Tiny synthetic BigWigs, annotations and generated outputs
docs/                    Scientific method, input contract, architecture and deployment
tests/                   Python unit and integration tests
.github/workflows/       Python and web CI
```

## Input modes

| Mode | Status |
|---|---|
| Four strand-specific BigWigs for one contrast, annotation, explicit normalization, bounded interval | Functional in browser Web Worker; descriptive signal ratios only, no p-values; maximum interval and block budgets enforced |
| eNRSA gene-body and enhancer differential tables plus exact coordinate table | Functional in browser Web Worker; one contrast per run; model p-values remain feature-level evidence and are never pair p-values |
| eRNA_diff R-DESeq2 enhancer table plus supplied gene-body results and annotation | Functional adapter; SAF starts are converted from 1-based inclusive; separate catalog/model from eNRSA |
| Combined BigWigs and differential tables | Both inputs run, but evidence stays separate and compatibility is currently unverified by default |
| Multiple individual replicate BigWigs, genome-wide BigWig scan, BAM, FASTQ | Not supported by the browser workflow; use the Python prototype/upstream workflow where appropriate |
| Hosted arbitrary uploads/analysis | Disabled; no upload endpoint, public worker, or storage integration |

See [browser analysis and input contract](docs/browser-analysis-v0.2.md) for the accepted headers, coordinate conversions, compatibility rules, resource caps and historical SAF/BED offset audit.

See [browser input formats](docs/browser-analysis-v0.2.md), [Python input formats](docs/input-formats.md), [scientific method](docs/scientific-method.md), [architecture](docs/architecture.md), and [deployment](docs/deployment.md). The HEL processed-data audit remains documented in [BigWig provenance](docs/proseq-bigwig-provenance.md) and [eNRSA/DESeq2 compatibility](docs/enrsa-deseq2-compatibility.md).

## Development

```bash
uv sync --extra bigwig --extra test
uv run pytest
cd apps/web && npm ci && npm test && npm run lint && npm run typecheck && npm run build
```

GitHub Actions runs Python checks and web lint, typecheck, unit tests, Playwright end-to-end tests, and the production build. Run the local browser suite with `npm run test:e2e` after installing the Playwright Chromium browser (`npx playwright install chromium`). Vercel should use `apps/web` as the project root. The app has no HPC credentials, private lab files, or cloud analysis endpoint.

## Research-prototype provenance

The original HEL RUNX1/BCOR analysis remains in its separate HPC and Dropbox workspaces. Its evidence tiers, coordinate decisions, and limitations informed this migration, but no HEL sequencing data or private annotations are committed here. Earlier prototype versions and the negative K562 benchmark result remain preserved in the lab workspace. This repository is a clean public implementation baseline, not a wholesale copy of private research outputs.
