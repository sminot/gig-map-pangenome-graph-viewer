"""Generate a synthetic gig-map-style output directory for the bundled demo.

Produces demo-data/bin_pangenome/{gene_bins.csv, genome_content.long.csv} with
realistic structure: a small pangenome with a common core, clade-specific
shell blocks (so clades actually cluster in the embedding), and rare cloud
bins scattered across individual genomes.
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
    parser.add_argument("--genomes", type=int, default=120)
    parser.add_argument("--bins", type=int, default=300)
    parser.add_argument("--clades", type=int, default=5)
    parser.add_argument("--seed", type=int, default=7)
    args = parser.parse_args()

    rng = random.Random(args.seed)
    out_dir = args.out / "bin_pangenome"
    out_dir.mkdir(parents=True, exist_ok=True)

    clade_ids = [f"clade_{c}" for c in range(args.clades)]

    genomes = []
    for i in range(args.genomes):
        genus, species = TAXA[i % len(TAXA)]
        genomes.append(
            {
                "genome": f"GCF_{i:07d}",
                "genus": genus,
                "species": f"{genus} {species}",
                "clade": clade_ids[i % args.clades],
            }
        )

    # 15% core (ubiquitous), 60% shell (tagged to 1-2 clades), 25% cloud (rare).
    bins = []
    for b in range(args.bins):
        r = b / args.bins
        if r < 0.15:
            partition = "core"
            n_genes = rng.randint(10, 40)
            tags: list[str] | None = None
        elif r < 0.75:
            partition = "shell"
            n_genes = rng.randint(4, 15)
            n_tags = 1 if rng.random() < 0.8 else 2
            tags = rng.sample(clade_ids, n_tags)
        else:
            partition = "cloud"
            n_genes = rng.randint(1, 6)
            tags = None
        bins.append(
            {
                "bin": f"bin_{b:04d}",
                "partition": partition,
                "n_genes": n_genes,
                "clade_tags": tags,
            }
        )

    gene_bins_rows = []
    content_rows = []
    for bin_row in bins:
        bin_id = bin_row["bin"]
        partition = bin_row["partition"]
        tags = bin_row["clade_tags"]

        present_genomes = []
        for g in genomes:
            if partition == "core":
                p = 0.95
            elif partition == "shell":
                # Strong clade signal: in-clade genomes almost always carry the
                # bin; out-of-clade genomes rarely do. This is what makes clades
                # cluster in the embedding.
                p = 0.85 if g["clade"] in tags else 0.03
            else:  # cloud
                p = 0.04
            if rng.random() < p:
                present_genomes.append(g)

        n_genomes = len(present_genomes)

        for gi in range(bin_row["n_genes"]):
            gene_bins_rows.append(
                {
                    "combined_name": f"{bin_id}_gene_{gi:03d}",
                    "bin": bin_id,
                    "n_genomes": n_genomes,
                    "partition": partition,
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
