# GEL — Gene–Enhancer Linking

GEL is an open, training-free research tool for screening enhancer-like nascent transcription near perturbed genes. It makes candidate evidence easier to inspect and export. **Transcriptional concordance is not proof of a direct enhancer–gene regulatory relationship.** The independent K562 CRISPRi evaluation in the earlier research prototype did not establish performance gains over distance-only assignment.

## Try the web demo

The web application is a static Next.js frontend with a compact synthetic result fixture produced by the Python core. It does not upload files or run user analysis in the cloud.

```powershell
cd apps/web
npm ci
npm run dev
```

Open `http://localhost:3000`, then select **Explore synthetic demo**. The demo is a 10 kb artificial chromosome with two sample groups and two replicates per group. It is not biological data or hg38.

## Run the Python demonstration

Python 3.9+ and `pyBigWig` are required for BigWig inputs. Use Linux or a configured WSL/Conda environment (native Windows `pyBigWig` installation is not validated):

```bash
uv sync --extra bigwig --extra test
uv run python examples/demo/generate_demo.py
uv run gel --config examples/demo/experiment.json
uv run python scripts/publish_demo_fixture.py
```

The demo generator creates paired plus/minus synthetic BigWigs; the CLI then discovers signal intervals in the configured region, classifies strand geometry, quantifies enhancer and gene-body responses, creates all in-range pairs and writes TSV/CSV/BED/BEDPE/UCSC interact exports plus a ZIP. The final command refreshes the small static web fixture. Or use the already generated demonstration outputs served from `apps/web/public/demo/`.

**Scope limit:** The current Python run is a small declared-region prototype. It is not a genome-wide caller, and the sample-level BigWig fold-change demonstration does not calculate DESeq2 p-values. For statistical differential transcription, use appropriately processed count-based results; the general processed eNRSA/DESeq2 adapter is planned but not yet part of this public package.

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
| Explicit paired strand BigWigs, annotations and sample metadata, bounded region | Executable Python prototype; synthetic fixture exercised |
| Averaged or individual-replicate BigWigs | Explicit sample records supported by the CLI; simple group fold changes only |
| Processed eNRSA/eRNA/DESeq2 tables | Extension point only; not implemented in this public package |
| BAM | Planned adapter; not validated |
| FASTQ | Planned wrapper around an established upstream pipeline; not implemented |
| Hosted arbitrary uploads/analysis | Disabled; no public compute endpoint or storage integration |

See [input formats](docs/input-formats.md), [scientific method](docs/scientific-method.md), [architecture](docs/architecture.md), and [deployment](docs/deployment.md). The HEL processed-data compatibility audit is documented in [BigWig provenance](docs/proseq-bigwig-provenance.md) and [eNRSA/DESeq2 compatibility](docs/enrsa-deseq2-compatibility.md). Those files specify proposed import rules; they do not imply that the public processed-data adapter is implemented.

## Development

```bash
uv sync --extra bigwig --extra test
uv run pytest
cd apps/web && npm ci && npm run lint && npm run typecheck && npm run build
```

GitHub Actions runs the Python checks and the web lint/typecheck/build. Vercel should use `apps/web` as the project root. The app has no HPC credentials, private lab files, or cloud analysis endpoint.

## Research-prototype provenance

The original HEL RUNX1/BCOR analysis remains in its separate HPC and Dropbox workspaces. Its evidence tiers, coordinate decisions, and limitations informed this migration, but no HEL sequencing data or private annotations are committed here. Earlier prototype versions and the negative K562 benchmark result remain preserved in the lab workspace. This repository is a clean public implementation baseline, not a wholesale copy of private research outputs.
