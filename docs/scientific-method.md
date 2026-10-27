# Scientific method and interpretation

## Intended use

GEL automates a gene-centered screening step: find genes with nascent transcription changes after a perturbation, enumerate nearby enhancer-like transcribed loci, compare responses, and export the evidence for genome-browser review. It allows many enhancers per gene and many nearby genes per enhancer.

It is a candidate-discovery aid, not a machine-learning predictor or causal-inference procedure. Shared transcriptional responses can reflect global perturbation effects, local co-regulation, read-through, overlapping measurement intervals, or a direct regulatory relationship. The output does not distinguish those explanations on its own.

The earlier independent K562 CRISPRi benchmark did not show response-concordance ranking outperforming distance-only assignment. This limitation is carried into the public app and must remain part of evaluation claims.

## Current bounded demo

The Python core reads paired plus/minus BigWigs for explicitly assigned samples, a 0-based half-open gene table and a declared chromosomal region. It scans fixed-width signal bins in control tracks, merges adjacent active bins, uses strand signal in flanks around each interval to describe outward/divergent versus inward/convergent geometry, and flags promoter/gene-body overlap. It measures interval and gene-body signal for each sample, then reports control-referenced log2 fold changes, an approximate Welch standard error when both groups have at least two samples, and direction/effect-size evidence tiers.

The demo is intentionally modest. BigWig-derived effects have no DESeq2 p-values or adjusted p-values; therefore the high/statistical evidence tier is reserved and never assigned by the BigWig-only path. An effect threshold is descriptive, not a statistical significance test. The displayed log2FC standard error is a delta-method summary conditional on independent sample-level signal measurements, not a p-value or a full count-model uncertainty. BigWig summaries do not model replicate pairing, shared controls across multiple time points, batch effects or cross-feature covariance. The source pipeline's HEL v1–v7 results and statistical methods remain separate.

## Coordinates and candidate pairs

Internal inputs and BED-family outputs use 0-based, half-open intervals. Gene TSS is the first base of the plus-strand feature or the final included base of the minus-strand feature. Pair generation retains every gene within `max_distance_bp`; it does not choose a winner. Distances use minimum interval-to-TSS distance; signed transcription-oriented midpoint offset is also retained.

Peak morphology labels describe local strand geometry, not enhancer function. Promoter overlap and gene-body overlap are flags; intragenic candidates are not silently equated with nonfunctional elements. Red/discordant means measured response directions disagree, not that an enhancer has been disproven.

## Frozen external benchmark context

The former HEL research prototype evaluated a frozen training-free ranking against K562 CRISPRi functional labels. That analysis did not support accuracy improvement over a distance baseline. Public GEL must not use benchmark labels to tune its default scoring parameters. Future evaluation should compare methods on the same experimentally tested candidate universe and account for clustering by enhancer, gene and genomic neighborhood.
