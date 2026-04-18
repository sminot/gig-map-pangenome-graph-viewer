"""Read gig-map Nextflow output from a single directory."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import pandas as pd

GENOME_CONTENT_REL = Path("bin_pangenome") / "genome_content.long.csv"
GENE_BINS_REL = Path("bin_pangenome") / "gene_bins.csv"

FIXED_GENOME_CONTENT_COLS = ("bin", "genome", "n_genes_detected", "prop_genes_detected")
FIXED_GENE_BINS_COLS = ("combined_name", "bin", "n_genomes")


@dataclass
class GigMapTables:
    genome_content: pd.DataFrame
    gene_bins: pd.DataFrame


def read_gigmap(input_dir: Path) -> GigMapTables:
    """Load gig-map output tables from a directory, using fixed relative paths."""
    input_dir = Path(input_dir)
    if not input_dir.is_dir():
        raise FileNotFoundError(f"Input is not a directory: {input_dir}")

    genome_content_path = input_dir / GENOME_CONTENT_REL
    gene_bins_path = input_dir / GENE_BINS_REL

    missing = [p for p in (genome_content_path, gene_bins_path) if not p.is_file()]
    if missing:
        listing = "\n  ".join(str(p) for p in missing)
        raise FileNotFoundError(
            f"Missing expected gig-map output file(s) under {input_dir}:\n  {listing}\n"
            "The preprocessor expects a gig-map output directory containing "
            "bin_pangenome/genome_content.long.csv and bin_pangenome/gene_bins.csv."
        )

    genome_content = pd.read_csv(genome_content_path)
    gene_bins = pd.read_csv(gene_bins_path)

    _require_columns(genome_content, FIXED_GENOME_CONTENT_COLS, genome_content_path)
    _require_columns(gene_bins, FIXED_GENE_BINS_COLS, gene_bins_path)

    return GigMapTables(genome_content=genome_content, gene_bins=gene_bins)


def _require_columns(df: pd.DataFrame, required: tuple[str, ...], path: Path) -> None:
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(
            f"{path} is missing required column(s): {missing}. "
            f"Found columns: {list(df.columns)}"
        )
