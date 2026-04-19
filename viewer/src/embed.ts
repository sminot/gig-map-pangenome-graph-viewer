import type Graph from "graphology";
import { TSNE } from "@keckelt/tsne";

/**
 * Co-embed bins and genomes into 2D using the bipartite-aware distances:
 *
 *   bin <-> bin       : 1 - Jaccard(genomes containing each)
 *   genome <-> genome : 1 - Jaccard(bins each contains)
 *   bin <-> genome    : 0 if an edge exists, 1 otherwise
 *
 * t-SNE is then run on the resulting NxN distance matrix (Karpathy-style
 * O(N^2) per iteration). Ids are returned in the same order as the rows of
 * the embedding so callers can map back to nodes.
 */

export interface Embedding {
  ids: string[];
  positions: { x: number; y: number }[];
}

export interface EmbedOptions {
  iterations?: number;
  perplexity?: number;
  /** Optional callback to report progress (0..1) for long runs. */
  onProgress?: (fraction: number) => void;
}

export function embedNodes(graph: Graph, options: EmbedOptions = {}): Embedding {
  const ids = graph.nodes();
  const N = ids.length;
  if (N === 0) return { ids, positions: [] };
  if (N === 1) return { ids, positions: [{ x: 0, y: 0 }] };

  const distances = computeDistanceMatrix(graph, ids);

  const perplexity =
    options.perplexity ??
    Math.max(5, Math.min(50, Math.round(Math.sqrt(N))));
  const iterations = options.iterations ?? defaultIterations(N);

  const tsne = new TSNE({
    perplexity,
    epsilon: 10,
    dim: 2,
  });
  tsne.initDataDist(distances);

  const reportEvery = Math.max(1, Math.floor(iterations / 50));
  for (let i = 0; i < iterations; i++) {
    tsne.step();
    if (options.onProgress && i % reportEvery === 0) {
      options.onProgress((i + 1) / iterations);
    }
  }
  options.onProgress?.(1);

  const raw = tsne.getSolution() as number[][];
  const positions = raw.map((p) => ({ x: p[0], y: p[1] }));
  return { ids, positions };
}

function defaultIterations(n: number): number {
  if (n < 200) return 600;
  if (n < 800) return 500;
  if (n < 2000) return 400;
  if (n < 5000) return 300;
  return 200;
}

function computeDistanceMatrix(graph: Graph, ids: string[]): number[][] {
  const N = ids.length;
  const idx = new Map<string, number>();
  for (let i = 0; i < N; i++) idx.set(ids[i], i);

  // Per-node neighbor index sets — used both for Jaccard and for the
  // edge-existence check on bipartite pairs.
  const neighborIdx: Set<number>[] = new Array(N);
  const kinds: string[] = new Array(N);
  for (let i = 0; i < N; i++) {
    const id = ids[i];
    kinds[i] = String(graph.getNodeAttribute(id, "kind") ?? "");
    const set = new Set<number>();
    graph.forEachNeighbor(id, (nbr) => {
      const j = idx.get(nbr);
      if (j !== undefined) set.add(j);
    });
    neighborIdx[i] = set;
  }

  // Sort each neighbor set into a sorted typed array — Jaccard via merge is
  // O(|A| + |B|) and avoids hashing overhead in the inner loop.
  const sortedNeighbors: Int32Array[] = neighborIdx.map((s) => {
    const arr = new Int32Array(s.size);
    let k = 0;
    for (const v of s) arr[k++] = v;
    arr.sort();
    return arr;
  });

  const D: number[][] = new Array(N);
  for (let i = 0; i < N; i++) D[i] = new Array(N).fill(0);

  for (let i = 0; i < N; i++) {
    const ki = kinds[i];
    const ai = sortedNeighbors[i];
    const ni = neighborIdx[i];
    for (let j = i + 1; j < N; j++) {
      let d: number;
      if (kinds[j] === ki) {
        d = 1 - jaccardSorted(ai, sortedNeighbors[j]);
      } else {
        d = ni.has(j) ? 0 : 1;
      }
      D[i][j] = d;
      D[j][i] = d;
    }
  }
  return D;
}

function jaccardSorted(a: Int32Array, b: Int32Array): number {
  const an = a.length;
  const bn = b.length;
  if (an === 0 && bn === 0) return 0;
  let i = 0;
  let j = 0;
  let intersection = 0;
  while (i < an && j < bn) {
    const av = a[i];
    const bv = b[j];
    if (av === bv) {
      intersection++;
      i++;
      j++;
    } else if (av < bv) {
      i++;
    } else {
      j++;
    }
  }
  const union = an + bn - intersection;
  return union === 0 ? 0 : intersection / union;
}
