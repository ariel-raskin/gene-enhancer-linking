# Development and deployment

## Local web app

```powershell
cd apps/web
npm ci
npm run dev
```

Visit `http://localhost:3000`. The reference demo page reads Python-generated static results. The workspace reads local File objects and runs actual single/multi-contrast analyses in browser Web Workers; selected inputs and generated genomic results are not sent to a server.

## Python demonstration

```bash
uv sync --extra bigwig --extra test
uv run python examples/demo/generate_demo.py
uv run gel --config examples/demo/experiment.json
uv run python scripts/publish_demo_fixture.py
```

The fixture generator writes synthetic BigWigs; the CLI produces the analysis outputs, and the publisher stages those generated outputs for the web demo. Use Linux or a configured WSL/Conda environment for `pyBigWig`; the tracked Python package does not currently provide a tested native Windows installation. The runnable region is 10 kb; genome-wide use has not been validated.

## GitHub Actions

CI runs Python regression/parity checks plus web lint, typecheck, unit tests, Playwright local-import E2E tests and production build. Python CI also regenerates the bounded demo from the checked-in synthetic BigWigs and validates the interact export structure.

## Vercel

Import `ariel-raskin/gene-enhancer-linking` in Vercel and set **Root Directory** to `apps/web`; leave the Next.js build preset and install/build defaults detected by Vercel. No environment variables are required. The frontend is static in behavior and the demo fixture is public synthetic data only. Do not configure HPC credentials or a public compute API in this project.

## Live smoke tests

`GEL_BASE_URL` is a test-runner setting only; it is not a Vercel environment variable. It disables the local Playwright web server and runs the same synthetic file-selection, analysis, export, failure and cancellation checks against a deployment:

```powershell
cd apps/web
$env:GEL_BASE_URL="https://gene-enhancer-linking.vercel.app"
npm run test:e2e
Remove-Item Env:GEL_BASE_URL
```

Preview deployments may be behind Vercel deployment protection. A successful build or HTTP 200 login page does not establish that the app was tested. Use an authorized preview session or report the access restriction; verify the public production UI after merge. No Vercel settings need to change for this release.
