"""Precompute 2D node positions for the viewer."""

from __future__ import annotations

import random

import igraph as ig
import numpy as np
import pandas as pd

from .build import Graph


def compute_layout(
    graph: Graph, algorithm: str = "radial-spectral", seed: int = 1
) -> pd.DataFrame:
    """Compute x/y positions for every node in `graph`.

    Default: ``radial-spectral`` — a structure-aware layout for bipartite
    pangenome graphs that encodes prevalence radially (core bins at the
    center, rare bins on an outer bin-ring, genomes in an outer genome-band)
    and co-occurrence angularly (via the Fiedler vector of the weighted
    normalized Laplacian). This avoids the "hairball" that a generic
    force-directed layout produces on high-hub bipartite graphs.

    Other algorithms (``drl``, ``fr``, ``kk``) fall through to python-igraph.
    Positions are normalized to the unit square [-1, 1].
    Returns a DataFrame with columns: id, x, y.
    """
    if algorithm == "radial-spectral":
        return _radial_spectral_layout(graph, seed=seed)
    return _igraph_layout(graph, algorithm=algorithm, seed=seed)


def _igraph_layout(graph: Graph, algorithm: str, seed: int) -> pd.DataFrame:
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

    return _normalize_unit_square(graph.nodes["id"].tolist(), coords_arr)


def _radial_spectral_layout(graph: Graph, seed: int) -> pd.DataFrame:
    """Layout bins on concentric shells by prevalence; angles from Fiedler vector.

    Bins:
        r   grows with (1 - prevalence / max_prevalence), so core bins sit
            near the center and cloud bins on an outer bin-ring.
        θ   comes from the rank of the Fiedler vector of the weighted
            normalized Laplacian, so bins that co-occur in the same genomes
            land in the same angular wedge.

    Genomes (option b: free in the outer band):
        θ   circular weighted mean of connected bins' angles, weighted by
            edge weight — a genome drifts toward the wedge its accessory
            content comes from.
        r   outer band, pushed further out the more diffuse the genome's
            bin signature is (1 − circular concentration), so content-wise
            outliers visibly escape the ring.
    """
    nodes = graph.nodes
    edges = graph.edges
    n = len(nodes)
    if n == 0:
        return pd.DataFrame({"id": [], "x": [], "y": []})

    id_to_idx = {nid: i for i, nid in enumerate(nodes["id"].tolist())}
    kind = nodes["kind"].to_numpy()
    is_bin = kind == "bin"
    is_genome = kind == "genome"

    theta = _fiedler_angles(n, edges, id_to_idx, seed=seed)

    prevalence = (
        nodes["prevalence"].fillna(0).to_numpy(dtype=np.float64)
        if "prevalence" in nodes.columns
        else np.zeros(n, dtype=np.float64)
    )
    bin_prev = prevalence[is_bin]
    max_prev = float(bin_prev.max()) if bin_prev.size else 1.0
    if max_prev <= 0:
        max_prev = 1.0

    r = np.zeros(n, dtype=np.float64)
    # bins: core (r≈0.10) → cloud (r≈0.70)
    r[is_bin] = 0.10 + 0.60 * (1.0 - bin_prev / max_prev)

    # genomes: option (b) — θ = circular mean of incident bins' θ;
    # r pushed out by diffuseness of the genome's bin-angle distribution.
    if edges is not None and len(edges):
        src = edges["source"].map(id_to_idx).to_numpy()
        tgt = edges["target"].map(id_to_idx).to_numpy()
        w = edges["weight"].to_numpy(dtype=np.float64)
        w = np.clip(w, 1e-6, None)

        src_is_bin = is_bin[src]
        bin_side = np.where(src_is_bin, src, tgt)
        genome_side = np.where(src_is_bin, tgt, src)

        cos_accum = np.zeros(n, dtype=np.float64)
        sin_accum = np.zeros(n, dtype=np.float64)
        w_accum = np.zeros(n, dtype=np.float64)
        np.add.at(cos_accum, genome_side, w * np.cos(theta[bin_side]))
        np.add.at(sin_accum, genome_side, w * np.sin(theta[bin_side]))
        np.add.at(w_accum, genome_side, w)

        genome_idx = np.where(is_genome)[0]
        has_edges = w_accum[genome_idx] > 0
        theta_g = np.zeros(len(genome_idx), dtype=np.float64)
        theta_g[has_edges] = np.arctan2(
            sin_accum[genome_idx][has_edges],
            cos_accum[genome_idx][has_edges],
        )
        rng = np.random.default_rng(seed)
        theta_g[~has_edges] = rng.uniform(-np.pi, np.pi, size=int((~has_edges).sum()))
        theta[genome_idx] = theta_g

        # circular concentration R ∈ [0, 1]; R=1 means all bin-angles aligned,
        # R=0 means uniform spread. Diffuseness = 1 - R.
        R = np.zeros(len(genome_idx), dtype=np.float64)
        denom = w_accum[genome_idx]
        mag = np.sqrt(
            cos_accum[genome_idx] ** 2 + sin_accum[genome_idx] ** 2
        )
        R[has_edges] = mag[has_edges] / denom[has_edges]
        diffuse = 1.0 - R
        # outer band [0.80, 1.00]: tight-signature genomes inner, diffuse outer
        r_g = 0.80 + 0.20 * diffuse
        r[genome_idx] = r_g
    else:
        r[is_genome] = 0.90

    x = r * np.cos(theta)
    y = r * np.sin(theta)
    coords = np.stack([x, y], axis=1)
    return _normalize_unit_square(nodes["id"].tolist(), coords)


def _fiedler_angles(
    n: int,
    edges: pd.DataFrame,
    id_to_idx: dict[str, int],
    seed: int,
) -> np.ndarray:
    """Map the Fiedler vector of the weighted normalized Laplacian to angles.

    Uses the rank of the Fiedler entries mapped uniformly to [-π, π) — rank
    order is more stable than raw values when the spectrum has clustered
    eigenvalues, and it guarantees good angular spacing on small graphs.
    Falls back to a random order if the eigensolver fails or the graph is
    trivially small.
    """
    rng = np.random.default_rng(seed)
    if n <= 1:
        return np.zeros(n, dtype=np.float64)

    fiedler = _try_compute_fiedler(n, edges, id_to_idx)
    if fiedler is None:
        fiedler = rng.standard_normal(n)

    # Break ties deterministically with tiny seeded jitter so argsort is stable.
    jitter = rng.standard_normal(n) * 1e-9
    order = np.argsort(fiedler + jitter)
    ranks = np.empty(n, dtype=np.int64)
    ranks[order] = np.arange(n)
    return -np.pi + 2.0 * np.pi * ranks / n


def _try_compute_fiedler(
    n: int,
    edges: pd.DataFrame,
    id_to_idx: dict[str, int],
) -> np.ndarray | None:
    if edges is None or len(edges) == 0:
        return None
    try:
        import scipy.sparse as sp
        from scipy.sparse.linalg import eigsh
    except Exception:
        return None

    src = edges["source"].map(id_to_idx).to_numpy()
    tgt = edges["target"].map(id_to_idx).to_numpy()
    valid = (~pd.isna(src)) & (~pd.isna(tgt))
    if not valid.all():
        src = src[valid]
        tgt = tgt[valid]
    src = src.astype(np.int64)
    tgt = tgt.astype(np.int64)
    w = edges["weight"].to_numpy(dtype=np.float64)
    if not valid.all():
        w = w[valid]
    w = np.clip(w, 1e-6, None)

    rows = np.concatenate([src, tgt])
    cols = np.concatenate([tgt, src])
    data = np.concatenate([w, w])
    A = sp.csr_matrix((data, (rows, cols)), shape=(n, n))
    d = np.asarray(A.sum(axis=1)).ravel()
    isolated = d <= 0
    d_safe = np.where(isolated, 1.0, d)
    d_inv_sqrt = 1.0 / np.sqrt(d_safe)
    D_inv_sqrt = sp.diags(d_inv_sqrt)
    L = sp.eye(n, format="csr") - D_inv_sqrt @ A @ D_inv_sqrt

    # Ask for the 2 smallest eigenvalues; shift-invert at sigma=0 is much
    # more reliable than which='SM' for normalized Laplacians.
    k = 2 if n > 2 else 1
    try:
        vals, vecs = eigsh(L, k=k, sigma=0.0, which="LM")
    except Exception:
        try:
            vals, vecs = eigsh(L, k=k, which="SM", tol=1e-6, maxiter=5000)
        except Exception:
            try:
                L_dense = L.toarray()
                vals, vecs = np.linalg.eigh(L_dense)
            except Exception:
                return None

    order = np.argsort(vals)
    if len(order) < 2:
        fiedler = vecs[:, order[0]]
    else:
        fiedler = vecs[:, order[1]]

    # Isolated nodes have an undefined Laplacian entry; place them deterministically
    # at the extremes so they don't all stack at 0.
    if isolated.any():
        fiedler = fiedler.copy()
        fiedler[isolated] = np.linspace(-1.0, 1.0, int(isolated.sum()))
    return fiedler.astype(np.float64)


def _normalize_unit_square(ids: list[str], coords: np.ndarray) -> pd.DataFrame:
    coords = np.asarray(coords, dtype=np.float64)
    if coords.size == 0:
        coords = np.zeros((len(ids), 2), dtype=np.float64)
    span = coords.max(axis=0) - coords.min(axis=0)
    span[span == 0] = 1.0
    center = (coords.max(axis=0) + coords.min(axis=0)) / 2.0
    normalized = 2.0 * (coords - center) / span
    return pd.DataFrame(
        {
            "id": ids,
            "x": normalized[:, 0].astype(np.float32),
            "y": normalized[:, 1].astype(np.float32),
        }
    )
