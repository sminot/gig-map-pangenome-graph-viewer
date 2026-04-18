import type Graph from "graphology";
import type { GraphData, MetaRow } from "./loader";
import { Palette, categoricalColor, sampleSequential } from "./palettes";

const BIN_FALLBACK = "#58a6ff";
const GENOME_FALLBACK = "#f0883e";

export interface EncodingState {
  binColorCol: string | null;
  binPalette: Palette;
  genomeColorCol: string | null;
}

/**
 * Recompute node colors based on the current encoding selections.
 *
 * Numeric attributes -> sequential palette (normalized per kind's domain).
 * Categorical attributes -> Okabe-Ito categorical palette.
 */
export function applyEncoding(
  graph: Graph,
  data: GraphData,
  state: EncodingState,
): LegendData {
  const legend: LegendData = { binLegend: null, genomeLegend: null };

  const binMeta = metaFor(data.meta, "bin", state.binColorCol);
  const genomeMeta = metaFor(data.meta, "genome", state.genomeColorCol);

  const binNodes = data.nodes.filter((n) => n.kind === "bin");
  const genomeNodes = data.nodes.filter((n) => n.kind === "genome");

  legend.binLegend = paintNodes(
    graph,
    binNodes,
    binMeta,
    state.binPalette,
    BIN_FALLBACK,
  );
  legend.genomeLegend = paintNodes(
    graph,
    genomeNodes,
    genomeMeta,
    "category",
    GENOME_FALLBACK,
  );

  return legend;
}

function metaFor(
  meta: MetaRow[],
  kind: "bin" | "genome",
  col: string | null,
): MetaRow | null {
  if (!col) return null;
  return meta.find((m) => m.kind === kind && m.column === col) ?? null;
}

export interface LegendEntry {
  column: string | null;
  kind: "numeric" | "categorical" | null;
  domain?: string[];
  range?: { min: number; max: number };
  palette?: Palette;
}

export interface LegendData {
  binLegend: LegendEntry | null;
  genomeLegend: LegendEntry | null;
}

function paintNodes(
  graph: Graph,
  nodes: { id: string; attrs: Record<string, unknown> }[],
  meta: MetaRow | null,
  palette: Palette,
  fallback: string,
): LegendEntry {
  if (!meta) {
    for (const n of nodes) graph.setNodeAttribute(n.id, "color", fallback);
    return { column: null, kind: null };
  }

  if (meta.category === "numeric") {
    const values = nodes
      .map((n) => Number(n.attrs[meta.column]))
      .filter((v) => Number.isFinite(v));
    if (values.length === 0) {
      for (const n of nodes) graph.setNodeAttribute(n.id, "color", fallback);
      return { column: meta.column, kind: "numeric" };
    }
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    for (const n of nodes) {
      const raw = Number(n.attrs[meta.column]);
      const t = Number.isFinite(raw) ? (raw - min) / span : 0;
      graph.setNodeAttribute(n.id, "color", sampleSequential(palette, t));
    }
    return {
      column: meta.column,
      kind: "numeric",
      range: { min, max },
      palette,
    };
  }

  const domain = Array.from(
    new Set(nodes.map((n) => String(n.attrs[meta.column] ?? "—"))),
  );
  for (const n of nodes) {
    const v = String(n.attrs[meta.column] ?? "—");
    graph.setNodeAttribute(n.id, "color", categoricalColor(v, domain));
  }
  return { column: meta.column, kind: "categorical", domain };
}
