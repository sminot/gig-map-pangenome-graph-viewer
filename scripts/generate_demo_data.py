"""Generate a synthetic gig-map-style output directory for the bundled demo.

Produces demo-data/bin_pangenome/{gene_bins.csv, genome_content.long.csv} with
realistic structure: a small pangenome with core / shell / cloud bins across
several simulated taxa.
"""

from __future__ import annotations

import argparse
import random
from pathlib import Path

import pandas as pd

TAXA = [
    ("Bacteroides", "fragilis"),
    ("Bacteroides", "thetaiotaomicron"),
    ("Escherichia", "coli"),
    ("Klebsiella", "pneumoniae"),
    ("Enterococcus", "faecalis"),
    ("Lactobacillus", "rhamnosus"),
    ("Streptococcus", "pyogenes"),
    ("Staphylococcus", "aureus"),
    ("Bifidobacterium", "longum"),
    ("Clostridium", "difficile"),
]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=Path("demo-data"))
    parser.add_argument("--genomes", type=int, default=80)
    parser.add_argument("--bins", type=int, default=200)
    parser.add_argument("--seed", type=int, default=7)
    args = parser.parse_args()

    rng = random.Random(args.seed)
    out_dir = args.out / "bin_pangenome"
    out_dir.mkdir(parents=True, exist_ok=True)

    genomes = []
    for i in range(args.genomes):
        genus, species = TAXA[i % len(TAXA)]
        genomes.append(
            {
                "genome": f"GCF_{i:07d}",
                "genus": genus,
                "species": f"{genus} {species}",
                "clade": f"clade_{i % 4}",
            }
        )

    bins = []
    for b in range(args.bins):
        if b < args.bins * 0.15:
            partition, n_genes = "core", rng.randint(10, 40)
        elif b < args.bins * 0.55:
            partition, n_genes = "shell", rng.randint(4, 15)
        else:
            partition, n_genes = "cloud", rng.randint(1, 6)
        bins.append({"bin": f"bin_{b:04d}", "partition": partition, "n_genes": n_genes})

    gene_bins_rows = []
    content_rows = []
    for bin_row in bins:
        bin_id = bin_row["bin"]
        if bin_row["partition"] == "core":
            present_prob = 0.95
        elif bin_row["partition"] == "shell":
            present_prob = 0.4
        else:
            present_prob = 0.08

        present_genomes = [g for g in genomes if rng.random() < present_prob]
        n_genomes = len(present_genomes)

        for gi in range(bin_row["n_genes"]):
            gene_bins_rows.append(
                {
                    "combined_name": f"{bin_id}_gene_{gi:03d}",
                    "bin": bin_id,
                    "n_genomes": n_genomes,
                    "partition": bin_row["partition"],
                }
            )

        for g in present_genomes:
            detected = rng.randint(
                max(1, int(bin_row["n_genes"] * 0.6)), bin_row["n_genes"]
            )
            content_rows.append(
                {
                    "bin": bin_id,
                    "genome": g["genome"],
                    "n_genes_detected": detected,
                    "prop_genes_detected": round(detected / bin_row["n_genes"], 3),
                    "genus": g["genus"],
                    "species": g["species"],
                    "clade": g["clade"],
                }
            )

    pd.DataFrame(gene_bins_rows).to_csv(out_dir / "gene_bins.csv", index=False)
    pd.DataFrame(content_rows).to_csv(out_dir / "genome_content.long.csv", index=False)
    print(
        f"Wrote {len(gene_bins_rows)} gene rows and {len(content_rows)} "
        f"content rows to {out_dir}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
