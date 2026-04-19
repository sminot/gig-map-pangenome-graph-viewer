import Graph from "graphology";
import type { GraphData, NodeRow } from "./loader";
import { applyHexLayout } from "./layout";

export interface BuildResult {
  graph: Graph;
  binIds: string[];
  genomeIds: string[];
  pitch: number;
}

// Node "size" is now interpreted in graph coordinates (itemSizesReference =
// "positions" in render.ts), so every radius is a fraction of the hex pitch.
// Keeping max radius ≤ 0.5 * pitch guarantees adjacent cells can never overlap.
const BIN_MIN_RADIUS_FRAC = 0.12;
const BIN_MAX_RADIUS_FRAC = 0.38;
const GENOME_RADIUS_FRAC = 0.32;

export function buildGraph(data: GraphData): BuildResult {
  const graph = new Graph({ type: "undirected", multi: false });

  const binIds: string[] = [];
  const genomeIds: string[] = [];

  for (const n of data.nodes) {
    graph.addNode(n.id, {
      label: n.label,
      kind: n.kind,
      x: n.x,
      y: n.y,
      size: 1,
      color: defaultColor(n),
      type: n.kind === "genome" ? "ring" : "circle",
      attrs: n.attrs,
    });
    if (n.kind === "bin") binIds.push(n.id);
    else genomeIds.push(n.id);
  }

  for (const e of data.edges) {
    if (!graph.hasNode(e.source) || !graph.hasNode(e.target)) continue;
    if (graph.hasEdge(e.source, e.target)) continue;
    graph.addEdge(e.source, e.target, {
      size: 0.4 + e.weight * 1.6,
      color: "rgba(120, 140, 180, 0.25)",
      weight: e.weight,
    });
  }

  const pitch = applyHexLayout(graph);
  graph.setAttribute("hexPitch", pitch);

  // Seed default sizes so the first render (pre-encoding) already respects
  // the grid and nothing overlaps.
  for (const n of data.nodes) {
    graph.setNodeAttribute(n.id, "size", defaultSize(n, pitch));
  }

  return { graph, binIds, genomeIds, pitch };
}

function defaultSize(n: NodeRow, pitch: number): number {
  if (n.kind === "genome") return pitch * GENOME_RADIUS_FRAC;
  const nGenes = Number(n.attrs["n_genes"] ?? 1);
  // sqrt shape within the [min, max] band by default.
  const normalized = Math.min(1, Math.sqrt(Math.max(1, nGenes)) / 20);
  return (
    pitch *
    (BIN_MIN_RADIUS_FRAC +
      (BIN_MAX_RADIUS_FRAC - BIN_MIN_RADIUS_FRAC) * normalized)
  );
}

export const BIN_RADIUS_FRAC_RANGE = {
  min: BIN_MIN_RADIUS_FRAC,
  max: BIN_MAX_RADIUS_FRAC,
};
export const GENOME_RADIUS_FRAC_VALUE = GENOME_RADIUS_FRAC;

function defaultColor(n: NodeRow): string {
  return n.kind === "genome" ? "#f0883e" : "#58a6ff";
}
