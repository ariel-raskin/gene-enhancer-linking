# GEL — Gene–Enhancer Linking

GEL is an open, training-free research tool for screening enhancer-like nascent transcription near perturbed genes. It makes candidate evidence easier to inspect and export. **Transcriptional concordance is not proof of a direct enhancer–gene regulatory relationship.** The independent K562 CRISPRi evaluation in the earlier research prototype did not establish performance gains over distance-only assignment.

## Try the web demo

The web application includes a browser-side analysis workspace with a universal local file importer. Select multiple files or a processed-analysis folder; GEL inspects file signatures and table schemas, proposes roles, preserves relative paths, shows readiness, and lets you correct, add, replace, or remove files. Analysis still runs in local Web Workers, with no user-data upload or cloud processing. Supported analysis paths include eNRSA differential tables, the separate eRNA_diff/R-DESeq2 branch, and multiple BigWig contrasts over bounded intervals, selected chromosomes or capacity-limited annotated-genome scopes. The contrast matrix groups a processed experiment, preserves shared controls, runs ready comparisons independently, and provides a gene explorer and experiment ZIP. Use the synthetic-example buttons to run small artificial fixtures through the same detector and analysis code.

```powershell
cd apps/web
npm ci
npm run dev
```

Open `http://localhost:3000`, choose **Open analysis workspace**, then select the synthetic example or add your own files/folder. Each demo fixture is artificial and runs through the real local detector and analysis worker; it is not biological data or hg38. Save `gel_experiment_manifest.json` after reviewing assignments to record the selected inputs and declarations. The precomputed **Explore synthetic demo** page remains available as a separate Python-generated reference output.

## Run the Python demonstration

Python 3.9+ and `pyBigWig` are required for BigWig inputs. Use Linux or a configured WSL/Conda environment (native Windows `pyBigWig` installation is not validated):

```bash
uv sync --extra bigwig --extra test
uv run python examples/demo/generate_demo.py
uv run gel --config examples/demo/experiment.json
uv run python scripts/publish_demo_fixture.py
```

The demo generator creates paired plus/minus synthetic BigWigs; the CLI then discovers signal intervals in the configured region, classifies strand geometry, quantifies enhancer and gene-body responses, creates all in-range pairs and writes TSV/CSV/BED/BEDPE/UCSC interact exports plus a ZIP. The final command refreshes the small static web fixture. Or use the already generated demonstration outputs served from `apps/web/public/demo/`.

**Scope limit:** The current Python run is a small declared-region prototype. It is not a genome-wide caller, and the sample-level BigWig fold-change demonstration does not calculate DESeq2 p-values. The browser also accepts audited eNRSA and eRNA_diff differential tables in independent contrast groups; see the browser input contract for exact schemas and provenance requirements.

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
| eNRSA gene-body and enhancer differential tables plus exact coordinate table | Functional in browser Web Worker; multiple contrasts run independently; model p-values remain feature-level evidence and are never pair p-values |
| eRNA_diff R-DESeq2 enhancer table plus supplied gene-body results and annotation | Functional adapter; SAF starts are converted from 1-based inclusive; separate catalog/model from eNRSA |
| Combined BigWigs and differential tables | Both inputs run, but evidence stays separate and compatibility is currently unverified by default |
| Universal file detection and folder import | Functional for recognized local signatures/schemas; roles can be corrected and manifest exported; multi-contrast experiment review and independent execution are functional |
| Individual replicate BigWigs | Explicitly select one plus/minus pair per condition and reference one sample per side; descriptive only, no implicit replicate averaging |
| Chromosome / annotated-genome BigWig scope | Functional bounded chunking; validated capacity depends on recorded thresholds and output limits; default-density whole-genome screens may stop explicitly |
| BAM, FASTQ | Not supported |
| Hosted arbitrary uploads/analysis | Disabled; no upload endpoint, public worker, or storage integration |

See [browser analysis and input contract](docs/browser-analysis-v0.2.md) for the accepted headers, coordinate conversions, compatibility rules, resource caps and historical SAF/BED offset audit.

See [Universal Smart Importer v0.3](docs/smart-importer-v0.3.md) for detectors, role/readiness logic, relative-path behavior, gzip support, manifest schema and remaining input limitations.

See [browser input formats](docs/browser-analysis-v0.2.md), [Python input formats](docs/input-formats.md), [scientific method](docs/scientific-method.md), [architecture](docs/architecture.md), and [deployment](docs/deployment.md). The HEL processed-data audit remains documented in [BigWig provenance](docs/proseq-bigwig-provenance.md) and [eNRSA/DESeq2 compatibility](docs/enrsa-deseq2-compatibility.md).

See [Multi-contrast workflow v0.4](docs/multi-contrast-v0.4.md) and [v0.4 validation](docs/multi-contrast-v0.4-validation.md) for the manifest schema, readiness, shared-control semantics, supported regional scope, exports and measured limits. Select **Load synthetic multi-contrast experiment**, apply its manifest, review and confirm metadata, then **Analyze ready contrasts**.

## Chromosome screening (v0.5)

Choose **Organize as experiment**, confirm your track/annotation metadata, set **Genomic scope**, and inspect the contig/resource plan before running. Single/multiple chromosomes and the annotated genome use two bounded passes with complete boundary-crossing peaks. No selected data leave the browser. The gene explorer and complete experiment exports retain each contrast separately.

Read [v0.5 methodology and limits](docs/chunked-bigwig-v0.5.md) and [validation](docs/chunked-bigwig-v0.5-validation.md). A real chromosome and a more restrictive whole-annotation workload completed; default whole-genome outputs exceeded the explicit retention budget. This is not unrestricted genome-wide capacity. Resource estimates exclude native/parser memory. The old Python demo CLI has distinct discovery definitions; the independent Web-contract Python oracle is documented separately.

## Development

```bash
uv sync --extra bigwig --extra test
uv run pytest
cd apps/web && npm ci && npm test && npm run lint && npm run typecheck && npm run build
```

GitHub Actions runs Python checks and web lint, typecheck, unit tests, Playwright end-to-end tests, and the production build. Run the local browser suite with `npm run test:e2e` after installing the Playwright Chromium browser (`npx playwright install chromium`). Vercel should use `apps/web` as the project root. The app has no HPC credentials, private lab files, or cloud analysis endpoint.

## Research-prototype provenance

The original HEL RUNX1/BCOR analysis remains in its separate HPC and Dropbox workspaces. Its evidence tiers, coordinate decisions, and limitations informed this migration, but no HEL sequencing data or private annotations are committed here. Earlier prototype versions and the negative K562 benchmark result remain preserved in the lab workspace. This repository is a clean public implementation baseline, not a wholesale copy of private research outputs.
