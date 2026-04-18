"""Precompute 2D node positions for the viewer."""

from __future__ import annotations

import random

import igraph as ig
import numpy as np
import pandas as pd

from .build import Graph


def compute_layout(graph: Graph, algorithm: str = "drl", seed: int = 1) -> pd.DataFrame:
    """Compute x/y positions for every node in `graph`.

    Uses python-igraph's C backend. `drl` (distributed recursive layout) scales
    to tens of thousands of nodes and produces clearer cluster separation than
    Fruchterman-Reingold for pangenome-style graphs; fall back to `fr` if drl
    is unavailable for the build.

    Positions are normalized to the unit square [-1, 1].
    Returns a DataFrame with columns: id, x, y.
    """
    id_to_idx = {nid: i for i, nid in enumerate(graph.nodes["id"].tolist())}
    g = ig.Graph(n=len(id_to_idx), directed=False)
    if len(graph.edges):
        edge_pairs = [
            (id_to_idx[s], id_to_idx[t])
            for s, t in zip(graph.edges["source"], graph.edges["target"])
            if s in id_to_idx and t in id_to_idx
        ]
        g.add_edges(edge_pairs)

    ig.set_random_number_generator(random.Random(seed))

    try:
        coords = g.layout(algorithm).coords
    except Exception:
        coords = g.layout("fr").coords

    coords_arr = np.asarray(coords, dtype=np.float64)
    if coords_arr.size == 0:
        coords_arr = np.zeros((len(id_to_idx), 2), dtype=np.float64)

    span = coords_arr.max(axis=0) - coords_arr.min(axis=0)
    span[span == 0] = 1.0
    center = (coords_arr.max(axis=0) + coords_arr.min(axis=0)) / 2.0
    normalized = 2.0 * (coords_arr - center) / span

    return pd.DataFrame(
        {
            "id": graph.nodes["id"].tolist(),
            "x": normalized[:, 0].astype(np.float32),
            "y": normalized[:, 1].astype(np.float32),
        }
    )
