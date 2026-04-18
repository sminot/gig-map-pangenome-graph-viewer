"""Build a bipartite bin<->genome graph from gig-map tables."""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from .read import (
    FIXED_GENE_BINS_COLS,
    FIXED_GENOME_CONTENT_COLS,
    GigMapTables,
)

BIN_PREFIX = "bin::"
GENOME_PREFIX = "genome::"


@dataclass
class Graph:
    """Bipartite graph ready for layout + serialization.

    nodes: DataFrame with columns id, kind, + arbitrary attribute columns.
    edges: DataFrame with source, target, weight.
    bin_attr_cols, genome_attr_cols: attribute columns specific to each kind
        (used by the viewer to drive color/size selectors).
    """

    nodes: pd.DataFrame
    edges: pd.DataFrame
    bin_attr_cols: list[str]
    genome_attr_cols: list[str]


def build_graph(tables: GigMapTables, min_prop_detected: float = 0.5) -> Graph:
    """Turn gig-map CSVs into a bipartite graph.

    Edges are drawn for (bin, genome) pairs where prop_genes_detected >= min_prop_detected.
    """
    edges_df = tables.genome_content
    gene_bins = tables.gene_bins

    edges_df = edges_df[edges_df["prop_genes_detected"] >= min_prop_detected]

    genome_attr_cols = [
        c for c in edges_df.columns if c not in FIXED_GENOME_CONTENT_COLS
    ]
    genome_meta = (
        edges_df[["genome", *genome_attr_cols]]
        .drop_duplicates(subset=["genome"])
        .reset_index(drop=True)
    )

    bin_agg = (
        gene_bins.groupby("bin")
        .agg(n_genes=("combined_name", "count"), n_genomes=("n_genomes", "max"))
        .reset_index()
    )
    extra_bin_cols = [
        c for c in gene_bins.columns if c not in FIXED_GENE_BINS_COLS
    ]
    if extra_bin_cols:
        extras = gene_bins.groupby("bin")[extra_bin_cols].first().reset_index()
        bin_agg = bin_agg.merge(extras, on="bin", how="left")

    prevalence = (
        edges_df.groupby("bin")["genome"].nunique().rename("prevalence").reset_index()
    )
    bin_meta = bin_agg.merge(prevalence, on="bin", how="left")
    bin_meta["prevalence"] = bin_meta["prevalence"].fillna(0).astype(int)

    bin_attr_cols = [c for c in bin_meta.columns if c != "bin"]
    bin_nodes = bin_meta.rename(columns={"bin": "label"})
    bin_nodes.insert(0, "id", BIN_PREFIX + bin_nodes["label"].astype(str))
    bin_nodes.insert(1, "kind", "bin")

    genome_nodes = genome_meta.rename(columns={"genome": "label"})
    genome_nodes.insert(0, "id", GENOME_PREFIX + genome_nodes["label"].astype(str))
    genome_nodes.insert(1, "kind", "genome")

    nodes = pd.concat([bin_nodes, genome_nodes], ignore_index=True, sort=False)

    edges = pd.DataFrame(
        {
            "source": BIN_PREFIX + edges_df["bin"].astype(str).values,
            "target": GENOME_PREFIX + edges_df["genome"].astype(str).values,
            "weight": edges_df["prop_genes_detected"].astype(float).values,
        }
    )

    return Graph(
        nodes=nodes,
        edges=edges,
        bin_attr_cols=bin_attr_cols,
        genome_attr_cols=genome_attr_cols,
    )
