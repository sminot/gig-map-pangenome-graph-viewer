import type Sigma from "sigma";
import type Graph from "graphology";
import type { GraphData, MetaRow, NodeRow } from "./loader";
import type { LegendData, LegendEntry, SizeLegend } from "./encoding";
import { categoricalColor, sampleSequential } from "./palettes";

export function populateAttributeSelectors(
  data: GraphData,
  binSel: HTMLSelectElement,
  genomeSel: HTMLSelectElement,
): void {
  fillSelect(binSel, filterMeta(data.meta, "bin"), "n_genes");
  fillSelect(genomeSel, filterMeta(data.meta, "genome"), "clade");
}

function filterMeta(meta: MetaRow[], kind: "bin" | "genome"): MetaRow[] {
  return meta.filter((m) => m.kind === kind);
}

function fillSelect(
  sel: HTMLSelectElement,
  rows: MetaRow[],
  preferred: string,
): void {
  sel.innerHTML = "";
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "— none —";
  sel.appendChild(none);
  for (const r of rows) {
    const opt = document.createElement("option");
    opt.value = r.column;
    opt.textContent = `${r.column} (${r.category})`;
    sel.appendChild(opt);
  }
  if (rows.some((r) => r.column === preferred)) {
    sel.value = preferred;
  }
}

export function attachTooltip(
  sigma: Sigma,
  _graph: Graph,
  nodesById: Map<string, NodeRow>,
): () => void {
  const tooltip = document.getElementById("tooltip") as HTMLDivElement;
  const container = sigma.getContainer();
  let hideTimer: number | undefined;

  const showAt = (node: string, clientX: number, clientY: number) => {
    const n = nodesById.get(node);
    if (!n) return;
    tooltip.innerHTML = formatTooltip(n);
    tooltip.style.left = `${clientX + 12}px`;
    tooltip.style.top = `${clientY + 12}px`;
    tooltip.classList.remove("hidden");
  };

  const hide = () => {
    tooltip.classList.add("hidden");
    if (hideTimer !== undefined) {
      window.clearTimeout(hideTimer);
      hideTimer = undefined;
    }
  };

  const onEnter = ({ node, event }: { node: string; event: { x: number; y: number } }) => {
    const rect = container.getBoundingClientRect();
    showAt(node, rect.left + event.x, rect.top + event.y);
    // On touch there's no leaveNode; auto-hide after a short window so the
    // tooltip doesn't linger forever after a tap.
    if (hideTimer !== undefined) window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(hide, 2500);
  };

  const onLeave = () => hide();
  const onStageDown = () => hide();

  // Pointer events cover both mouse and touch, so the tooltip tracks fingers
  // as well as cursors.
  const onPointerMove = (ev: PointerEvent) => {
    if (tooltip.classList.contains("hidden")) return;
    tooltip.style.left = `${ev.clientX + 12}px`;
    tooltip.style.top = `${ev.clientY + 12}px`;
  };

  sigma.on("enterNode", onEnter);
  sigma.on("leaveNode", onLeave);
  sigma.on("downStage", onStageDown);
  container.addEventListener("pointermove", onPointerMove);

  return () => {
    sigma.off("enterNode", onEnter);
    sigma.off("leaveNode", onLeave);
    sigma.off("downStage", onStageDown);
    container.removeEventListener("pointermove", onPointerMove);
    if (hideTimer !== undefined) window.clearTimeout(hideTimer);
    hide();
  };
}

function formatTooltip(n: NodeRow): string {
  const rows = Object.entries(n.attrs)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `<div class="row"><span class="key">${escape(k)}</span><span>${escape(String(v))}</span></div>`)
    .join("");
  return `<div class="title">${escape(n.label)}</div>
    <div class="row"><span class="key">kind</span><span>${n.kind}</span></div>
    ${rows}`;
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function renderLegend(
  container: HTMLElement,
  legend: LegendData,
): void {
  container.innerHTML = "";
  container.appendChild(renderSection("Bins (rings)", legend.binLegend));
  container.appendChild(renderSection("Genomes (filled)", legend.genomeLegend));
  if (legend.sizeLegend) {
    container.appendChild(renderSizeLegend(legend.sizeLegend));
  }
}

function renderSizeLegend(legend: SizeLegend): HTMLElement {
  const wrap = document.createElement("div");
  const h = document.createElement("div");
  h.style.fontWeight = "600";
  h.style.marginTop = "10px";
  h.textContent = `Bin size (${legend.column}, ${legend.scale})`;
  wrap.appendChild(h);

  const row = document.createElement("div");
  row.className = "size-legend-row";
  for (const tick of legend.ticks) {
    const cell = document.createElement("div");
    cell.className = "size-legend-cell";
    const dot = document.createElement("span");
    dot.className = "size-legend-dot";
    const d = Math.max(4, tick.size * 2);
    dot.style.width = `${d}px`;
    dot.style.height = `${d}px`;
    cell.appendChild(dot);
    const label = document.createElement("span");
    label.className = "size-legend-label";
    label.textContent = String(tick.value);
    cell.appendChild(label);
    row.appendChild(cell);
  }
  wrap.appendChild(row);
  return wrap;
}

function renderSection(title: string, entry: LegendEntry | null): HTMLElement {
  const wrap = document.createElement("div");
  const h = document.createElement("div");
  h.style.fontWeight = "600";
  h.style.marginTop = "6px";
  h.textContent = title;
  wrap.appendChild(h);

  if (!entry || entry.kind === null) {
    const p = document.createElement("div");
    p.textContent = "uniform color";
    wrap.appendChild(p);
    return wrap;
  }

  if (entry.kind === "numeric" && entry.range && entry.palette) {
    const gradient = document.createElement("div");
    gradient.className = "gradient";
    const stops: string[] = [];
    for (let i = 0; i <= 10; i++) {
      stops.push(sampleSequential(entry.palette, i / 10));
    }
    gradient.style.background = `linear-gradient(90deg, ${stops.join(", ")})`;
    wrap.appendChild(gradient);
    const labels = document.createElement("div");
    labels.style.display = "flex";
    labels.style.justifyContent = "space-between";
    labels.innerHTML = `<span>${fmt(entry.range.min)}</span><span>${entry.column ?? ""}</span><span>${fmt(entry.range.max)}</span>`;
    wrap.appendChild(labels);
    return wrap;
  }

  if (entry.kind === "categorical" && entry.domain) {
    for (const v of entry.domain.slice(0, 12)) {
      const row = document.createElement("div");
      row.className = "row";
      const swatch = document.createElement("span");
      swatch.className = "swatch";
      swatch.style.background = categoricalColor(v, entry.domain);
      row.appendChild(swatch);
      row.appendChild(document.createTextNode(v));
      wrap.appendChild(row);
    }
    if (entry.domain.length > 12) {
      const more = document.createElement("div");
      more.textContent = `+${entry.domain.length - 12} more`;
      wrap.appendChild(more);
    }
  }
  return wrap;
}

function fmt(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2);
}
