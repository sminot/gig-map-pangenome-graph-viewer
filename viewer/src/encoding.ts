import type Graph from "graphology";
import type { GraphData, MetaRow } from "./loader";
import { Palette, categoricalColor, sampleSequential } from "./palettes";
import { BIN_RADIUS_FRAC_RANGE, GENOME_RADIUS_FRAC_VALUE } from "./graph";

const BIN_FALLBACK = "#58a6ff";
const GENOME_FALLBACK = "#f0883e";

// Legend-only: pixel diameters for the DOM swatches, independent of the
// graph-coordinate sizes used by Sigma.
const LEGEND_DOT_MIN_PX = 6;
const LEGEND_DOT_MAX_PX = 26;

export type SizeScale = "linear" | "sqrt" | "log";

export interface EncodingState {
  binColorCol: string | null;
  binPalette: Palette;
  genomeColorCol: string | null;
  binSizeScale: SizeScale;
}

/**
 * Recompute node colors and bin sizes based on the current encoding state.
 *
 * Colors:
 *   numeric attribute -> sequential palette; categorical -> Okabe-Ito.
 * Bin sizes:
 *   driven by `n_genes`; user picks linear / sqrt / log scaling. Genomes
 *   stay uniform.
 */
export function applyEncoding(
  graph: Graph,
  data: GraphData,
  state: EncodingState,
): LegendData {
  const legend: LegendData = {
    binLegend: null,
    genomeLegend: null,
    sizeLegend: null,
  };

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

  const pitch = readPitch(graph);
  legend.sizeLegend = applyBinSizes(graph, binNodes, state.binSizeScale, pitch);
  const genomeSize = pitch * GENOME_RADIUS_FRAC_VALUE;
  for (const n of genomeNodes) graph.setNodeAttribute(n.id, "size", genomeSize);

  return legend;
}

function readPitch(graph: Graph): number {
  const raw = Number(graph.getAttribute("hexPitch"));
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
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

export interface SizeLegend {
  scale: SizeScale;
  column: string;
  ticks: { value: number; size: number }[];
}

export interface LegendData {
  binLegend: LegendEntry | null;
  genomeLegend: LegendEntry | null;
  sizeLegend: SizeLegend | null;
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

function applyBinSizes(
  graph: Graph,
  nodes: { id: string; attrs: Record<string, unknown> }[],
  scale: SizeScale,
  pitch: number,
): SizeLegend | null {
  const values = nodes
    .map((n) => Math.max(1, Number(n.attrs.n_genes ?? 1)))
    .filter((v) => Number.isFinite(v));
  if (values.length === 0) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const transform = chooseTransform(scale);
  const tMin = transform(min);
  const tMax = transform(max);
  const tSpan = tMax - tMin || 1;

  const normalizedFor = (v: number) =>
    (transform(Math.max(1, v)) - tMin) / tSpan;

  const graphSizeFor = (v: number) =>
    pitch *
    (BIN_RADIUS_FRAC_RANGE.min +
      normalizedFor(v) * (BIN_RADIUS_FRAC_RANGE.max - BIN_RADIUS_FRAC_RANGE.min));

  const legendPixelFor = (v: number) =>
    (LEGEND_DOT_MIN_PX +
      normalizedFor(v) * (LEGEND_DOT_MAX_PX - LEGEND_DOT_MIN_PX)) /
    2;

  for (const n of nodes) {
    const raw = Math.max(1, Number(n.attrs.n_genes ?? 1));
    graph.setNodeAttribute(n.id, "size", graphSizeFor(raw));
  }

  const tickValues = pickTicks(min, max, scale);
  return {
    scale,
    column: "n_genes",
    ticks: tickValues.map((value) => ({ value, size: legendPixelFor(value) })),
  };
}

function chooseTransform(scale: SizeScale): (v: number) => number {
  if (scale === "linear") return (v) => v;
  if (scale === "log") return (v) => Math.log(v);
  return (v) => Math.sqrt(v);
}

function pickTicks(min: number, max: number, scale: SizeScale): number[] {
  if (min === max) return [Math.round(min)];
  if (scale === "log") {
    const lo = Math.log10(min);
    const hi = Math.log10(max);
    const mid = (lo + hi) / 2;
    return uniqueRounded([min, Math.pow(10, mid), max]);
  }
  return uniqueRounded([min, (min + max) / 2, max]);
}

function uniqueRounded(values: number[]): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const v of values) {
    const r = Math.round(v);
    if (!seen.has(r)) {
      seen.add(r);
      out.push(r);
    }
  }
  return out;
}
