import type Graph from "graphology";
import { TSNE } from "@keckelt/tsne";

/**
 * Co-embed bins and genomes into 2D using the bipartite-aware distances:
 *
 *   bin <-> bin       : 1 - WeightedJaccard(genome -> edge_weight)
 *   genome <-> genome : 1 - WeightedJaccard(bin -> edge_weight)
 *   bin <-> genome    : 0 if an edge exists, 1 otherwise
 *
 * Weighted Jaccard treats each edge weight as a "membership strength":
 *   numerator   = sum over shared neighbors of min(w_a, w_b)
 *   denominator = sum over the union of neighbors of max(w_a, w_b)
 * so high-weight overlap counts more than low-weight overlap, and unweighted
 * Jaccard is the special case of binary weights.
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

  // Per-node neighbor table sorted by neighbor index, paired with the edge
  // weight to that neighbor. Sorted parallel arrays let us do weighted
  // Jaccard via a merge in O(|A| + |B|).
  const neighborIdsSorted: Int32Array[] = new Array(N);
  const neighborWeights: Float32Array[] = new Array(N);
  const neighborWeightByIdx: Map<number, number>[] = new Array(N);
  const kinds: string[] = new Array(N);

  for (let i = 0; i < N; i++) {
    const id = ids[i];
    kinds[i] = String(graph.getNodeAttribute(id, "kind") ?? "");
    const pairs: [number, number][] = [];
    graph.forEachNeighbor(id, (nbr) => {
      const j = idx.get(nbr);
      if (j === undefined) return;
      const eid = graph.edge(id, nbr);
      let w = 1;
      if (eid !== undefined) {
        const raw = Number(graph.getEdgeAttribute(eid, "weight"));
        if (Number.isFinite(raw) && raw > 0) w = raw;
      }
      pairs.push([j, w]);
    });
    pairs.sort((a, b) => a[0] - b[0]);
    const idsArr = new Int32Array(pairs.length);
    const wArr = new Float32Array(pairs.length);
    const map = new Map<number, number>();
    for (let k = 0; k < pairs.length; k++) {
      idsArr[k] = pairs[k][0];
      wArr[k] = pairs[k][1];
      map.set(pairs[k][0], pairs[k][1]);
    }
    neighborIdsSorted[i] = idsArr;
    neighborWeights[i] = wArr;
    neighborWeightByIdx[i] = map;
  }

  const D: number[][] = new Array(N);
  for (let i = 0; i < N; i++) D[i] = new Array(N).fill(0);

  for (let i = 0; i < N; i++) {
    const ki = kinds[i];
    const ai = neighborIdsSorted[i];
    const aw = neighborWeights[i];
    const wi = neighborWeightByIdx[i];
    for (let j = i + 1; j < N; j++) {
      let d: number;
      if (kinds[j] === ki) {
        d = 1 - weightedJaccardSorted(ai, aw, neighborIdsSorted[j], neighborWeights[j]);
      } else {
        d = wi.has(j) ? 0 : 1;
      }
      D[i][j] = d;
      D[j][i] = d;
    }
  }
  return D;
}

function weightedJaccardSorted(
  aIds: Int32Array,
  aW: Float32Array,
  bIds: Int32Array,
  bW: Float32Array,
): number {
  const an = aIds.length;
  const bn = bIds.length;
  if (an === 0 && bn === 0) return 0;
  let i = 0;
  let j = 0;
  let inter = 0;
  let uni = 0;
  while (i < an && j < bn) {
    const av = aIds[i];
    const bv = bIds[j];
    if (av === bv) {
      const wa = aW[i];
      const wb = bW[j];
      inter += wa < wb ? wa : wb;
      uni += wa > wb ? wa : wb;
      i++;
      j++;
    } else if (av < bv) {
      uni += aW[i];
      i++;
    } else {
      uni += bW[j];
      j++;
    }
  }
  while (i < an) uni += aW[i++];
  while (j < bn) uni += bW[j++];
  return uni === 0 ? 0 : inter / uni;
}
