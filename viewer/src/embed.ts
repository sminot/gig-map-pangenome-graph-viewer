import type Graph from "graphology";
import { TSNE } from "@keckelt/tsne";

/**
 * Co-embed bins and genomes into 2D using the bipartite-aware distances:
 *
 *   bin <-> bin       : 1 - Jaccard(genomes containing each)        (unweighted)
 *   genome <-> genome : 1 - sum(n_genes for shared bins)
 *                            / sum(n_genes for the union of bins)
 *   bin <-> genome    : 0 if an edge exists, 1 otherwise
 *
 * Genome similarity is weighted by bin gene count: sharing a 100-gene bin
 * makes two genomes much more similar than sharing a 5-gene bin. The two
 * sums collapse to ordinary Jaccard if every bin has the same n_genes.
 * Bin-bin distance stays unweighted because genomes don't have an analogous
 * "size" attribute.
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

  // Per-node "size" used to weight overlap. Bins contribute n_genes; genomes
  // contribute 1, which makes bin-bin Jaccard collapse to the unweighted form
  // (since each shared genome counts the same).
  const kinds: string[] = new Array(N);
  const nodeWeight = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const id = ids[i];
    const kind = String(graph.getNodeAttribute(id, "kind") ?? "");
    kinds[i] = kind;
    if (kind === "bin") {
      const attrs = graph.getNodeAttribute(id, "attrs") as
        | Record<string, unknown>
        | undefined;
      const raw = attrs ? Number(attrs.n_genes) : NaN;
      nodeWeight[i] = Number.isFinite(raw) && raw > 0 ? raw : 1;
    } else {
      nodeWeight[i] = 1;
    }
  }

  // Sorted neighbor-index arrays per node — that's all the per-node info the
  // weighted-Jaccard merge below needs, since the per-shared-neighbor weight
  // comes from the global nodeWeight table (the neighbor's own weight).
  const neighborIdsSorted: Int32Array[] = new Array(N);
  const neighborSet: Set<number>[] = new Array(N);
  for (let i = 0; i < N; i++) {
    const indices: number[] = [];
    graph.forEachNeighbor(ids[i], (nbr) => {
      const j = idx.get(nbr);
      if (j !== undefined) indices.push(j);
    });
    indices.sort((a, b) => a - b);
    neighborIdsSorted[i] = Int32Array.from(indices);
    neighborSet[i] = new Set(indices);
  }

  const D: number[][] = new Array(N);
  for (let i = 0; i < N; i++) D[i] = new Array(N).fill(0);

  for (let i = 0; i < N; i++) {
    const ki = kinds[i];
    const ai = neighborIdsSorted[i];
    const ni = neighborSet[i];
    for (let j = i + 1; j < N; j++) {
      let d: number;
      if (kinds[j] === ki) {
        d = 1 - weightedJaccardByNeighborSize(ai, neighborIdsSorted[j], nodeWeight);
      } else {
        d = ni.has(j) ? 0 : 1;
      }
      D[i][j] = d;
      D[j][i] = d;
    }
  }
  return D;
}

/**
 * Generalized Jaccard where each shared neighbor contributes its own weight
 * (taken from `weight[k]` for neighbor index k). Equivalent to
 *   sum_{k in A∩B} weight[k] / sum_{k in A∪B} weight[k]
 * computed in O(|A| + |B|) by merging the two sorted neighbor lists.
 */
function weightedJaccardByNeighborSize(
  aIds: Int32Array,
  bIds: Int32Array,
  weight: Float32Array,
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
      const w = weight[av];
      inter += w;
      uni += w;
      i++;
      j++;
    } else if (av < bv) {
      uni += weight[av];
      i++;
    } else {
      uni += weight[bv];
      j++;
    }
  }
  while (i < an) uni += weight[aIds[i++]];
  while (j < bn) uni += weight[bIds[j++]];
  return uni === 0 ? 0 : inter / uni;
}
