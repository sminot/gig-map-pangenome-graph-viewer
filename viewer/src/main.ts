import { loadGraph, NodeRow } from "./loader";
import { buildGraph } from "./graph";
import { createSigma } from "./render";
import { attachDragPhysics } from "./physics";
import { applyEncoding, EncodingState } from "./encoding";
import {
  attachTooltip,
  populateAttributeSelectors,
  renderLegend,
} from "./ui";
import { Palette } from "./palettes";

async function main() {
  const status = document.getElementById("status") as HTMLParagraphElement;
  status.textContent = "Loading graph…";

  const data = await loadGraph("./graph");
  status.textContent = `Loaded ${data.nodes.length} nodes, ${data.edges.length} edges`;

  const { graph } = buildGraph(data);
  const nodesById = new Map<string, NodeRow>(data.nodes.map((n) => [n.id, n]));

  const container = document.getElementById("sigma-container") as HTMLDivElement;
  const sigma = createSigma(graph, container);

  const binColorSel = document.getElementById("bin-color") as HTMLSelectElement;
  const genomeColorSel = document.getElementById("genome-color") as HTMLSelectElement;
  const binPaletteSel = document.getElementById("bin-palette") as HTMLSelectElement;
  const legendEl = document.getElementById("legend") as HTMLDivElement;

  populateAttributeSelectors(data, binColorSel, genomeColorSel);

  const state: EncodingState = {
    binColorCol: binColorSel.value || null,
    binPalette: (binPaletteSel.value as Palette) ?? "viridis",
    genomeColorCol: genomeColorSel.value || null,
  };

  const refresh = () => {
    state.binColorCol = binColorSel.value || null;
    state.binPalette = (binPaletteSel.value as Palette) ?? "viridis";
    state.genomeColorCol = genomeColorSel.value || null;
    const legend = applyEncoding(graph, data, state);
    renderLegend(legendEl, legend);
    sigma.refresh();
  };

  binColorSel.addEventListener("change", refresh);
  genomeColorSel.addEventListener("change", refresh);
  binPaletteSel.addEventListener("change", refresh);

  refresh();
  attachTooltip(sigma, graph, nodesById);
  attachDragPhysics(graph, sigma);
}

main().catch((err) => {
  const status = document.getElementById("status") as HTMLParagraphElement;
  status.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
  console.error(err);
});
