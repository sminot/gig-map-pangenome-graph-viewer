"""Precompute 2D node positions for the viewer."""

from __future__ import annotations

import random

import igraph as ig
import numpy as np
import pandas as pd

from .build import Graph


def compute_layout(
    graph: Graph, algorithm: str = "co-embed", seed: int = 1
) -> pd.DataFrame:
    """Compute x/y positions for every node in `graph`.

    Default: ``co-embed`` — truncated SVD of a TF-IDF-weighted
    genome×bin presence matrix, followed by a t-SNE projection to 2D of
    the joint (genome + bin) embedding. Genomes that share accessory
    content cluster visibly; bins land near the genomes that carry them
    (core bins near the middle since they belong to everyone, shell bins
    with their clade, cloud bins scattered). The output is roughly
    uniformly filling a 2D square, which is what you want when the goal
    is to see similarity groups rather than radial / hierarchical
    structure.

    Other algorithms (``radial-spectral``, ``drl``, ``fr``, ``kk``) are
    preserved for comparison. Positions are normalized to [-1, 1].
    Returns a DataFrame with columns: id, x, y.
    """
    if algorithm == "co-embed":
        return _co_embed_tsne_layout(graph, seed=seed)
    if algorithm == "radial-spectral":
        return _radial_spectral_layout(graph, seed=seed)
    return _igraph_layout(graph, algorithm=algorithm, seed=seed)


def _co_embed_tsne_layout(graph: Graph, seed: int) -> pd.DataFrame:
    """Joint SVD + t-SNE embedding of genomes and bins in the same 2D plane.

    Pipeline
    --------
    1. Build the bipartite genome × bin presence / weight matrix M
       (rows = genomes, cols = bins, values = edge weight, i.e.
       prop_genes_detected).
    2. TF-IDF normalize over bins. Inverse-document-frequency makes rare
       shell bins the drivers of similarity; without it, ubiquitous core
       bins dominate every genome's signature and everything looks alike.
    3. Truncated SVD of the centered matrix gives a shared k-dim latent
       space for genomes (U · Σ) *and* bins (V · Σ). They live in the
       same coordinate system.
    4. t-SNE reduces that joint latent space to 2D, producing well-
       separated clusters uniformly spread across the plane.
    5. Fall back to the first two SVD components if t-SNE is unavailable
       (e.g. scikit-learn not installed) or the graph is too small for
       t-SNE to be meaningful.
    """
    try:
        from sklearn.manifold import TSNE  # type: ignore

        _HAS_TSNE = True
    except Exception:
        _HAS_TSNE = False

    nodes = graph.nodes
    edges = graph.edges
    n = len(nodes)
    if n == 0:
        return pd.DataFrame({"id": [], "x": [], "y": []})

    id_to_idx = {nid: i for i, nid in enumerate(nodes["id"].tolist())}
    kind = nodes["kind"].to_numpy()
    bin_mask = kind == "bin"
    genome_mask = kind == "genome"
    bin_ids = np.where(bin_mask)[0]
    genome_ids = np.where(genome_mask)[0]
    n_bins = bin_ids.size
    n_genomes = genome_ids.size

    if n_bins == 0 or n_genomes == 0 or len(edges) == 0:
        # Degenerate: nothing to co-embed. Fall back to radial-spectral so we
        # still return *some* reasonable coordinates for downstream code.
        return _radial_spectral_layout(graph, seed=seed)

    # Build dense (n_genomes, n_bins) weighted matrix. We use a local index
    # for each side so SVD/t-SNE see compact matrices.
    g_local = {gid: i for i, gid in enumerate(genome_ids.tolist())}
    b_local = {bid: i for i, bid in enumerate(bin_ids.tolist())}
    src = edges["source"].map(id_to_idx).to_numpy()
    tgt = edges["target"].map(id_to_idx).to_numpy()
    w = edges["weight"].to_numpy(dtype=np.float64)
    src_is_bin = bin_mask[src]
    bin_side = np.where(src_is_bin, src, tgt)
    genome_side = np.where(src_is_bin, tgt, src)

    M = np.zeros((n_genomes, n_bins), dtype=np.float64)
    for b_idx, g_idx, weight in zip(bin_side, genome_side, w):
        gi = g_local.get(int(g_idx))
        bi = b_local.get(int(b_idx))
        if gi is None or bi is None:
            continue
        # max() handles the case of repeated (bin, genome) pairs in input.
        if weight > M[gi, bi]:
            M[gi, bi] = weight

    # TF-IDF-like weighting: downweight bins that appear in most genomes so
    # similarity is driven by shared accessory content.
    df_per_bin = (M > 0).sum(axis=0).astype(np.float64)
    idf = np.log((n_genomes + 1.0) / (df_per_bin + 1.0)) + 1.0
    W = M * idf

    # Center and SVD. Graphs too tiny for a 2D embedding fall back to the
    # radial layout so the caller always gets coordinates.
    if n_genomes < 2 or n_bins < 2:
        return _radial_spectral_layout(graph, seed=seed)
    k = int(min(30, n_genomes, n_bins))
    W_centered = W - W.mean(axis=0, keepdims=True)
    try:
        U, S, Vt = np.linalg.svd(W_centered, full_matrices=False)
    except np.linalg.LinAlgError:
        return _radial_spectral_layout(graph, seed=seed)
    U_k = U[:, :k] * S[:k]
    V_k = Vt[:k, :].T * S[:k]
    joint = np.vstack([U_k, V_k])  # (n_genomes + n_bins, k)
    if joint.shape[1] < 2:
        pad = np.zeros((joint.shape[0], 2 - joint.shape[1]))
        joint = np.hstack([joint, pad])

    # t-SNE to 2D on the joint latent space. Falls back to (SVD1, SVD2) if
    # t-SNE is not available or if the input is too small for a stable
    # perplexity.
    n_joint = joint.shape[0]
    if _HAS_TSNE and n_joint >= 6:
        perplexity = float(min(30, max(5, (n_joint - 1) // 3)))
        try:
            tsne = TSNE(
                n_components=2,
                perplexity=perplexity,
                random_state=seed,
                init="pca",
                learning_rate="auto",
                metric="euclidean",
            )
            coords = tsne.fit_transform(joint)
        except Exception:
            coords = joint[:, :2]
    else:
        coords = joint[:, :2]

    # Scatter back into node-order x/y.
    x = np.zeros(n, dtype=np.float64)
    y = np.zeros(n, dtype=np.float64)
    for gi, node_idx in enumerate(genome_ids):
        x[node_idx] = coords[gi, 0]
        y[node_idx] = coords[gi, 1]
    for bi, node_idx in enumerate(bin_ids):
        x[node_idx] = coords[n_genomes + bi, 0]
        y[node_idx] = coords[n_genomes + bi, 1]

    return _normalize_unit_square(
        nodes["id"].tolist(), np.stack([x, y], axis=1)
    )


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
    """Radial by prevalence, angular by Fiedler vector — kept as a fallback."""
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
    r[is_bin] = 0.10 + 0.60 * (1.0 - bin_prev / max_prev)

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

        R = np.zeros(len(genome_idx), dtype=np.float64)
        denom = w_accum[genome_idx]
        mag = np.sqrt(cos_accum[genome_idx] ** 2 + sin_accum[genome_idx] ** 2)
        R[has_edges] = mag[has_edges] / denom[has_edges]
        diffuse = 1.0 - R
        r[genome_idx] = 0.80 + 0.20 * diffuse
    else:
        r[is_genome] = 0.90

    x = r * np.cos(theta)
    y = r * np.sin(theta)
    return _normalize_unit_square(nodes["id"].tolist(), np.stack([x, y], axis=1))


def _fiedler_angles(
    n: int,
    edges: pd.DataFrame,
    id_to_idx: dict[str, int],
    seed: int,
) -> np.ndarray:
    rng = np.random.default_rng(seed)
    if n <= 1:
        return np.zeros(n, dtype=np.float64)

    fiedler = _try_compute_fiedler(n, edges, id_to_idx)
    if fiedler is None:
        fiedler = rng.standard_normal(n)

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
