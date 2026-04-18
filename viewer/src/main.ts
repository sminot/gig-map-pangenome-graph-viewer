import Sigma from "sigma";
import type Graph from "graphology";
import { loadGraph, GraphData, NodeRow } from "./loader";
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

const DEFAULT_DATA_URL = "./graph";

interface AppParams {
  data: string | null;
  binColor: string | null;
  genomeColor: string | null;
  binPalette: Palette | null;
  embed: boolean;
}

function readParams(): AppParams {
  const q = new URLSearchParams(window.location.search);
  const palette = q.get("binPalette");
  return {
    data: q.get("data"),
    binColor: q.get("binColor"),
    genomeColor: q.get("genomeColor"),
    binPalette:
      palette === "viridis" || palette === "plasma" || palette === "category"
        ? palette
        : null,
    embed: q.get("embed") === "1",
  };
}

function writeParams(params: AppParams): string {
  const q = new URLSearchParams();
  if (params.data) q.set("data", params.data);
  if (params.binColor) q.set("binColor", params.binColor);
  if (params.genomeColor) q.set("genomeColor", params.genomeColor);
  if (params.binPalette) q.set("binPalette", params.binPalette);
  if (params.embed) q.set("embed", "1");
  const qs = q.toString();
  return qs ? `?${qs}` : "";
}

function buildShareUrls(params: AppParams): { share: string; embed: string } {
  const origin = `${window.location.origin}${window.location.pathname}`;
  const shareParams: AppParams = { ...params, embed: false };
  const embedParams: AppParams = { ...params, embed: true };
  const share = `${origin}${writeParams(shareParams)}`;
  const embedUrl = `${origin}${writeParams(embedParams)}`;
  const iframe = `<iframe src="${embedUrl}" style="width:100%;height:600px;border:0" loading="lazy"></iframe>`;
  return { share, embed: iframe };
}

let currentSigma: Sigma | null = null;
let detachPhysics: (() => void) | null = null;

async function loadAndRender(dataUrl: string): Promise<{ data: GraphData; graph: Graph }> {
  const data = await loadGraph(dataUrl);
  const { graph } = buildGraph(data);
  const nodesById = new Map<string, NodeRow>(data.nodes.map((n) => [n.id, n]));

  const container = document.getElementById("sigma-container") as HTMLDivElement;

  if (detachPhysics) {
    detachPhysics();
    detachPhysics = null;
  }
  if (currentSigma) {
    currentSigma.kill();
    currentSigma = null;
  }
  container.innerHTML = "";

  const sigma = createSigma(graph, container);
  attachTooltip(sigma, graph, nodesById);
  detachPhysics = attachDragPhysics(graph, sigma);
  currentSigma = sigma;

  return { data, graph };
}

async function main() {
  const params = readParams();
  if (params.embed) document.body.classList.add("embed");

  const status = document.getElementById("status") as HTMLParagraphElement;
  const binColorSel = document.getElementById("bin-color") as HTMLSelectElement;
  const genomeColorSel = document.getElementById("genome-color") as HTMLSelectElement;
  const binPaletteSel = document.getElementById("bin-palette") as HTMLSelectElement;
  const legendEl = document.getElementById("legend") as HTMLDivElement;
  const dataUrlInput = document.getElementById("data-url") as HTMLInputElement;
  const dataLoadBtn = document.getElementById("data-load") as HTMLButtonElement;
  const shareUrlEl = document.getElementById("share-url") as HTMLTextAreaElement;
  const embedSnippetEl = document.getElementById("embed-snippet") as HTMLTextAreaElement;

  if (params.data) dataUrlInput.value = params.data;
  if (params.binPalette) binPaletteSel.value = params.binPalette;

  const initialUrl = params.data ?? DEFAULT_DATA_URL;
  status.textContent = `Loading ${initialUrl}…`;

  let { data, graph } = await loadAndRender(initialUrl);
  status.textContent = `${initialUrl}: ${data.nodes.length} nodes, ${data.edges.length} edges`;
  populateAttributeSelectors(data, binColorSel, genomeColorSel);
  if (params.binColor) binColorSel.value = params.binColor;
  if (params.genomeColor) genomeColorSel.value = params.genomeColor;

  const state: EncodingState = {
    binColorCol: binColorSel.value || null,
    binPalette: (binPaletteSel.value as Palette) ?? "viridis",
    genomeColorCol: genomeColorSel.value || null,
  };

  const syncUrl = () => {
    const p: AppParams = {
      data: dataUrlInput.value.trim() || null,
      binColor: state.binColorCol,
      genomeColor: state.genomeColorCol,
      binPalette: state.binPalette,
      embed: false,
    };
    const qs = writeParams(p);
    const newUrl = `${window.location.pathname}${qs}${window.location.hash}`;
    window.history.replaceState(null, "", newUrl);
    const urls = buildShareUrls(p);
    shareUrlEl.value = urls.share;
    embedSnippetEl.value = urls.embed;
  };

  const refresh = () => {
    state.binColorCol = binColorSel.value || null;
    state.binPalette = (binPaletteSel.value as Palette) ?? "viridis";
    state.genomeColorCol = genomeColorSel.value || null;
    const legend = applyEncoding(graph, data, state);
    renderLegend(legendEl, legend);
    if (currentSigma) currentSigma.refresh();
    syncUrl();
  };

  binColorSel.addEventListener("change", refresh);
  genomeColorSel.addEventListener("change", refresh);
  binPaletteSel.addEventListener("change", refresh);

  const reload = async () => {
    const url = dataUrlInput.value.trim() || DEFAULT_DATA_URL;
    status.textContent = `Loading ${url}…`;
    try {
      const next = await loadAndRender(url);
      data = next.data;
      graph = next.graph;
      populateAttributeSelectors(data, binColorSel, genomeColorSel);
      status.textContent = `${url}: ${data.nodes.length} nodes, ${data.edges.length} edges`;
      refresh();
    } catch (err) {
      status.textContent = `Error loading ${url}: ${err instanceof Error ? err.message : String(err)}`;
      console.error(err);
    }
  };

  dataLoadBtn.addEventListener("click", reload);
  dataUrlInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") reload();
  });

  refresh();
}

main().catch((err) => {
  const status = document.getElementById("status") as HTMLParagraphElement;
  status.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
  console.error(err);
});
