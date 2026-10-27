# Architecture

## Components

- `apps/web`: Next.js App Router, TypeScript, static demo results and gene-centric review UI. Vercel root directory is `apps/web`.
- `packages/gel-core`: Python package with interval utilities, strand geometry, bounded BigWig reading, pair generation and BED/BEDPE/UCSC interact export.
- `examples/demo`: generated synthetic tracks, reference intervals, config and output fixture; never biological data.
- `tests`: Python tests for coordinates, morphology, merging, uncertainty absence and pair retention.

## Research-prototype reference

The public core is a small, dependency-light reimplementation informed by HEL v6/v7 functions including `classify_response_pair`, `build_gene_centric_tables`, the v6 BEDPE/interact exporter, and v7 `classify_divergent_geometry`. It does not import the lab prototype package or its private data; the bounded BigWig path and exported schema are independently testable in this repository.

## Extension boundaries

The core accepts a standardized experiment description and should remain independent of any specific upstream pipeline. Input adapters should normalize counts, coordinates, assembly, strandedness, sample metadata and contrast definitions before calling the linking functions. Differential tables should preserve the original estimate, uncertainty and adjusted p-value rather than converting missing values to zero.

Future BigWig quantification should be separated from peak discovery and from differential modeling. Count-based statistical inference belongs in a sample-level model or a validated upstream processed-result adapter; the current small demo uses descriptive fold changes only.

## Hosted compute boundary

Vercel serves the frontend and checked-in synthetic fixture only. It has no HPC credentials or access to lab files and does not accept or store uploads. Future large analysis should use a separately deployed authenticated worker, private object storage with expiring scoped uploads, strict file/region/resource limits, provenance records and explicit cleanup policies. This repository does not yet implement that worker or storage layer.
