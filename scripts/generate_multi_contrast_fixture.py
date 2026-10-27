"""Publish a small redistributable experiment; no biological data or fitted p-values.

Identical synthetic A/B replicate tracks are deliberate. Their literal mean equals
the copied average track. Source BigWigs are the existing chrDemo A fixture.
"""
from pathlib import Path
import json
import shutil

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "examples" / "synthetic_experiment"
PUBLIC = ROOT / "apps" / "web" / "public" / "demo" / "experiment"


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    files = []

    def write(path, content):
        target = OUT / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8", newline="\n")
        files.append(path)

    def track(path, source):
        target = OUT / path
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / "examples" / "demo" / "data" / source, target)
        files.append(path)

    prefix = "synthetic_experiment/"
    write("genes.tsv", (ROOT / "examples" / "demo" / "genes.tsv").read_text(encoding="utf-8"))
    samples = []
    for condition in ["control"] + [f"Drug{x}_{t}h" for x in "AB" for t in (1, 2, 4, 8)]:
        for replicate in "AB":
            samples.append(dict(id=f"{condition}_{replicate}", condition=condition, timePoint="0h" if condition == "control" else condition.split("_")[1], biologicalReplicate=replicate, batch="", matchedBlock="", provenance="Synthetic independently labeled biological replicate; matching not established"))
    write("samples.tsv", "sample_id\tcondition\ttime_point\treplicate\tbatch\tmatched_block\n" + "\n".join("\t".join(s[k] or '""' for k in ["id", "condition", "timePoint", "biologicalReplicate", "batch", "matchedBlock"]) for s in samples) + "\n")
    for condition in ("control", "DrugA_1h", "DrugA_2h", "DrugB_1h"):
        for rep in ("A", "B", "avg"):
            for strand in ("plus", "minus"):
                track(f"tracks/{condition}_{rep}.{strand}.bw", f"{'ctrl' if condition == 'control' else 'treat'}_A_{strand}.bw")
    contrasts = []
    for drug in "AB":
        for t in (1, 2, 4, 8):
            condition = f"Drug{drug}_{t}h"
            folder = f"{condition}_vs_control"
            c_id = prefix + folder
            gene_effect = (1 if drug == "A" else -1) * {1: .91, 2: 1.4, 4: .2, 8: 1.1}[t]
            enhancer_effects = (gene_effect + .1, -gene_effect * 1.5, .1 if t == 4 else gene_effect)
            write(f"{folder}/known_gene/gb_change.txt", "Transcript\tGene\tbaseMean\tlog2FoldChange\tlfcSE\tstat\tpvalue\tpadj\n" + f"TX_DEMO1\tGENE_CONC\t120\t{gene_effect}\t.2\t4\t.001\t.01\n")
            columns = ["Transcript", "Gene", "chr", "start", "end", "strand", "ppc_control_A", "ppc_control_B", "gbc_control_A", "gbc_control_B", f"gbc_{condition}_A", f"gbc_{condition}_B"]
            write(f"{folder}/known_gene/normalized_pp_gb.txt", "\t".join(columns) + "\nTX_DEMO1\tGENE_CONC\tchrDemo\t6001\t7500\t+\t15\t16\t200\t210\t380\t390\n")
            if not (drug == "A" and t == 8):
                rows = "Enhancer_ID\tchr\tstart\tend\tbaseMean\tlog2FoldChange\tlfcSE\tstat\tpvalue\tpadj\n"
                for name, start, end, effect in zip(("concordant", "discordant", "overlap"), (1900, 3900, 6000), (2100, 4100, 7500), enhancer_effects):
                    rows += f"Peak_{name}\tchrDemo\t{start}\t{end}\t80\t{effect}\t.2\t4\t.001\t{.01 if t != 4 else .4}\n"
                write(f"{folder}/eRNA/Enhancer_change.txt", rows)
            bindings = {"gbChange": prefix + f"{folder}/known_gene/gb_change.txt", "normalizedPpGb": prefix + f"{folder}/known_gene/normalized_pp_gb.txt"}
            if not (drug == "A" and t == 8):
                bindings["enhancerChange"] = prefix + f"{folder}/eRNA/Enhancer_change.txt"
            has_tracks = (drug == "A" and t in (1, 2)) or (drug == "B" and t == 1)
            source = "replicate" if drug == "B" else "averaged"
            if has_tracks:
                bindings["annotation"] = prefix + "genes.tsv"
                for side, cond in (("control", "control"), ("treatment", condition)):
                    for strand in ("plus", "minus"):
                        bindings[side + strand.title()] = prefix + f"tracks/{cond}_{'A' if source == 'replicate' else 'avg'}.{strand}.bw"
            contrasts.append(dict(id=c_id, label=folder, control="control", treatment=condition, perturbation=f"Drug{drug}", timePoint=f"{t}h", assembly="incompatible-build" if drug == "B" and t == 8 else "", controlSampleIds=["control_A", "control_B"], treatmentSampleIds=[condition + "_A", condition + "_B"], controlTrackSampleIds=(["control_A"] if source == "replicate" else ["control_A", "control_B"]) if has_tracks else [], treatmentTrackSampleIds=([condition + "_A"] if source == "replicate" else [condition + "_A", condition + "_B"]) if has_tracks else [], controlTrackSource=source, treatmentTrackSource=source, bindings=bindings, mode="combined" if has_tracks else "enrsa", geneFormat="tsv", geneCoordinates="zero_based_half_open"))
    manifest = dict(schema_version=2, product="GEL Web", experimentId="synthetic-multi-v1", assembly="synthetic-demo-v1", annotationProvenance="Synthetic chrDemo genes, 0-based half-open; eNRSA coordinates remain 1-based inclusive", model="Synthetic eNRSA-schema statistics; illustrative p-values, not a fitted model", normalization="Synthetic common signal scale; identical A/B signals have the literal average supplied", scope=dict(chrom="chrDemo", start=0, end=10000), regionalStatistics=True, samples=samples, contrasts=contrasts)
    write("experiment_manifest.json", json.dumps(manifest, indent=2) + "\n")
    write("README.txt", "SYNTHETIC experiment. Six complete contrasts across two perturbations and 1/2/4 h, one missing enhancer table, one incompatible assembly. A/B are separately labeled synthetic biological samples; matched series are not asserted. The track signals for A and B are deliberately identical, so their copied average is exact. Tables are synthetic examples, not fitted differential results. Tracks and tables can disagree and remain separate evidence layers.\n")
    PUBLIC.mkdir(parents=True, exist_ok=True)
    for path in files:
        dest = PUBLIC / path
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(OUT / path, dest)
    (PUBLIC / "files.json").write_text(json.dumps(sorted(files), indent=2) + "\n", encoding="utf-8")
    print(f"Published {len(files)} small synthetic files; {len(contrasts)} contrasts.")


if __name__ == "__main__":
    main()
