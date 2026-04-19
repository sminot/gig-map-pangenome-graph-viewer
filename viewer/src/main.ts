import Sigma from "sigma";
import type Graph from "graphology";
import {
  compressToEncodedURIComponent,
  decompressFromEncodedURIComponent,
} from "lz-string";
import { loadGraph, GraphData, NodeRow } from "./loader";
import { buildGraph } from "./graph";
import { createSigma } from "./render";
import { attachDragPhysics } from "./physics";
import { applyEncoding, EncodingState, SizeScale } from "./encoding";
import {
  attachTooltip,
  populateAttributeSelectors,
  renderLegend,
} from "./ui";
import { Palette } from "./palettes";
import { attachDropzone } from "./dropzone";
import { attachSearch } from "./search";
import { exportPNG, exportSVG } from "./export";
import { attachLasso, pointInPolygon } from "./lasso";
import { applyFilter, FilterState } from "./filter";
import { attachInteractions, InteractionHandle } from "./interactions";

const DEFAULT_DATA_URL = "./graph";

interface AppParams {
  data: string | null;
  binColor: string | null;
  genomeColor: string | null;
  binPalette: Palette | null;
  binSize: SizeScale | null;
  title: string | null;
  description: string | null;
  embed: boolean;
}

function readParams(): AppParams {
  const q = new URLSearchParams(window.location.search);
  const palette = q.get("binPalette");
  const size = q.get("binSize");
  return {
    data: q.get("data"),
    binColor: q.get("binColor"),
    genomeColor: q.get("genomeColor"),
    binPalette:
      palette === "viridis" || palette === "plasma" || palette === "category"
        ? palette
        : null,
    binSize:
      size === "linear" || size === "sqrt" || size === "log" ? size : null,
    title: q.get("title"),
    description: q.get("description"),
    embed: q.get("embed") === "1",
  };
}

function writeParams(params: AppParams): string {
  const q = new URLSearchParams();
  if (params.data) q.set("data", params.data);
  if (params.binColor) q.set("binColor", params.binColor);
  if (params.genomeColor) q.set("genomeColor", params.genomeColor);
  if (params.binPalette) q.set("binPalette", params.binPalette);
  if (params.binSize) q.set("binSize", params.binSize);
  if (params.title) q.set("title", params.title);
  if (params.description) q.set("description", params.description);
  if (params.embed) q.set("embed", "1");
  const qs = q.toString();
  return qs ? `?${qs}` : "";
}

function encodeHash(filter: FilterState | null, pinned: Set<string>): string {
  const parts: string[] = [];
  if (filter && filter.ids.length > 0) {
    const payload = JSON.stringify({ m: filter.mode, i: filter.ids });
    parts.push(`f=${compressToEncodedURIComponent(payload)}`);
  }
  if (pinned.size > 0) {
    const payload = JSON.stringify([...pinned]);
    parts.push(`p=${compressToEncodedURIComponent(payload)}`);
  }
  return parts.length > 0 ? `#${parts.join("&")}` : "";
}

function decodeFilter(hash: string): FilterState | null {
  const match = /[#&]f=([^&]+)/.exec(hash);
  if (!match) return null;
  try {
    const raw = decompressFromEncodedURIComponent(match[1]);
    if (!raw) return null;
    const obj = JSON.parse(raw) as { m?: unknown; i?: unknown };
    const mode = obj.m === "hide" ? "hide" : "keep";
    const ids = Array.isArray(obj.i) ? obj.i.map((v) => String(v)) : [];
    if (ids.length === 0) return null;
    return { mode, ids };
  } catch {
    return null;
  }
}

function decodePinned(hash: string): Set<string> {
  const match = /[#&]p=([^&]+)/.exec(hash);
  if (!match) return new Set();
  try {
    const raw = decompressFromEncodedURIComponent(match[1]);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.map((v) => String(v)));
  } catch {
    return new Set();
  }
}

function buildShareUrls(
  params: AppParams,
  filter: FilterState | null,
  pinned: Set<string>,
): { share: string; embed: string } {
  const origin = `${window.location.origin}${window.location.pathname}`;
  const hash = encodeHash(filter, pinned);
  const share = `${origin}${writeParams({ ...params, embed: false })}${hash}`;
  const embedUrl = `${origin}${writeParams({ ...params, embed: true })}${hash}`;
  const iframe = `<iframe src="${embedUrl}" style="width:100%;height:600px;border:0" loading="lazy"></iframe>`;
  return { share, embed: iframe };
}

async function main() {
  const params = readParams();
  if (params.embed) document.body.classList.add("embed");

  const status = document.getElementById("status") as HTMLParagraphElement;
  const binColorSel = document.getElementById("bin-color") as HTMLSelectElement;
  const genomeColorSel = document.getElementById("genome-color") as HTMLSelectElement;
  const binPaletteSel = document.getElementById("bin-palette") as HTMLSelectElement;
  const binSizeScaleSel = document.getElementById("bin-size-scale") as HTMLSelectElement;
  const legendEl = document.getElementById("legend") as HTMLDivElement;
  const dataUrlInput = document.getElementById("data-url") as HTMLInputElement;
  const dataLoadBtn = document.getElementById("data-load") as HTMLButtonElement;
  const shareUrlEl = document.getElementById("share-url") as HTMLTextAreaElement;
  const embedSnippetEl = document.getElementById("embed-snippet") as HTMLTextAreaElement;
  const searchInput = document.getElementById("search-input") as HTMLInputElement;
  const exportPngBtn = document.getElementById("export-png") as HTMLButtonElement;
  const exportSvgBtn = document.getElementById("export-svg") as HTMLButtonElement;
  const container = document.getElementById("sigma-container") as HTMLDivElement;
  const dropOverlay = document.getElementById("drop-overlay") as HTMLDivElement;
  const appTitleEl = document.getElementById("app-title") as HTMLHeadingElement;
  const appDescriptionEl = document.getElementById("app-description") as HTMLParagraphElement;
  const DEFAULT_TITLE = appTitleEl.textContent ?? "gig-map Pangenome Graph Viewer";
  const filterSection = document.getElementById("filter-section") as HTMLElement;
  const filterStatus = document.getElementById("filter-status") as HTMLParagraphElement;
  const filterClearBtn = document.getElementById("filter-clear") as HTMLButtonElement;
  const selectionActions = document.getElementById("selection-actions") as HTMLDivElement;
  const selectionCount = document.getElementById("selection-count") as HTMLSpanElement;
  const selectionKeepBtn = document.getElementById("selection-keep") as HTMLButtonElement;
  const selectionHideBtn = document.getElementById("selection-hide") as HTMLButtonElement;
  const selectionCancelBtn = document.getElementById("selection-cancel") as HTMLButtonElement;
  const controlsToggleBtn = document.getElementById("controls-toggle") as HTMLButtonElement;
  const edgesAlwaysOnInput = document.getElementById("edges-always-on") as HTMLInputElement;
  const edgesOpacityInput = document.getElementById("edges-opacity") as HTMLInputElement;
  const pinnedSection = document.getElementById("pinned-section") as HTMLElement;
  const pinnedStatus = document.getElementById("pinned-status") as HTMLParagraphElement;
  const pinnedClearBtn = document.getElementById("pinned-clear") as HTMLButtonElement;

  if (params.data) dataUrlInput.value = params.data;
  if (params.binPalette) binPaletteSel.value = params.binPalette;
  if (params.binSize) binSizeScaleSel.value = params.binSize;

  let data!: GraphData;
  let graph!: Graph;
  let sigma!: Sigma;
  let detachPhysics: (() => void) | null = null;
  let detachLasso: (() => void) | null = null;
  let detachSearch: (() => void) | null = null;
  let detachTooltip: (() => void) | null = null;
  let interactions: InteractionHandle | null = null;
  let loadToken = 0;
  let filter: FilterState | null = decodeFilter(window.location.hash);
  let pinned: Set<string> = decodePinned(window.location.hash);
  let pendingSelection: string[] = [];

  const state: EncodingState = {
    binColorCol: null,
    binPalette: (binPaletteSel.value as Palette) ?? "viridis",
    genomeColorCol: null,
    binSizeScale: (binSizeScaleSel.value as SizeScale) ?? "sqrt",
  };

  const syncUrl = () => {
    const p: AppParams = {
      data: dataUrlInput.value.trim() || null,
      binColor: state.binColorCol,
      genomeColor: state.genomeColorCol,
      binPalette: state.binPalette,
      binSize: state.binSizeScale,
      title: params.title,
      description: params.description,
      embed: false,
    };
    const qs = writeParams(p);
    const hash = encodeHash(filter, pinned);
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${qs}${hash}`,
    );
    const urls = buildShareUrls(p, filter, pinned);
    shareUrlEl.value = urls.share;
    embedSnippetEl.value = urls.embed;
  };

  const renderPinnedUi = () => {
    if (pinned.size === 0) {
      pinnedSection.classList.add("hidden");
      return;
    }
    pinnedSection.classList.remove("hidden");
    pinnedStatus.textContent = `${pinned.size} node${pinned.size === 1 ? "" : "s"} pinned.`;
  };

  const renderFilterUi = (visible: number, total: number) => {
    if (!filter) {
      filterSection.classList.add("hidden");
      return;
    }
    filterSection.classList.remove("hidden");
    const verb = filter.mode === "keep" ? "Keeping" : "Hiding";
    filterStatus.textContent = `${verb} ${filter.ids.length} node(s). Showing ${visible} / ${total}.`;
  };

  const applyCurrentFilter = () => {
    const { visibleCount, totalCount } = applyFilter(graph, sigma, filter);
    renderFilterUi(visibleCount, totalCount);
    syncUrl();
  };

  const refresh = () => {
    state.binColorCol = binColorSel.value || null;
    state.binPalette = (binPaletteSel.value as Palette) ?? "viridis";
    state.genomeColorCol = genomeColorSel.value || null;
    state.binSizeScale = (binSizeScaleSel.value as SizeScale) ?? "sqrt";
    const legend = applyEncoding(graph, data, state);
    renderLegend(legendEl, legend);
    sigma.refresh();
    syncUrl();
  };

  const showSelectionActions = (ids: string[]) => {
    pendingSelection = ids;
    if (ids.length === 0) {
      selectionActions.classList.add("hidden");
      return;
    }
    selectionCount.textContent = `${ids.length} node(s) selected`;
    selectionActions.classList.remove("hidden");
  };

  const hideSelectionActions = () => {
    pendingSelection = [];
    selectionActions.classList.add("hidden");
  };

  const onLasso = (polygon: { x: number; y: number }[]) => {
    const selected: string[] = [];
    graph.forEachNode((id, attrs) => {
      if (attrs.hidden) return;
      if (pointInPolygon({ x: attrs.x, y: attrs.y }, polygon)) {
        selected.push(id);
      }
    });
    if (selected.length === 0) {
      hideSelectionActions();
      return;
    }
    showSelectionActions(selected);
  };

  const applyHeader = (info: { title: string | null; description: string | null }) => {
    const title = params.title ?? info.title ?? DEFAULT_TITLE;
    const description = params.description ?? info.description ?? null;
    appTitleEl.textContent = title;
    document.title = title;
    if (description) {
      appDescriptionEl.textContent = description;
      appDescriptionEl.classList.remove("hidden");
    } else {
      appDescriptionEl.textContent = "";
      appDescriptionEl.classList.add("hidden");
    }
  };

  const installGraph = (next: GraphData, source: string) => {
    if (detachPhysics) {
      detachPhysics();
      detachPhysics = null;
    }
    if (detachLasso) {
      detachLasso();
      detachLasso = null;
    }
    if (detachSearch) {
      detachSearch();
      detachSearch = null;
    }
    if (detachTooltip) {
      detachTooltip();
      detachTooltip = null;
    }
    if (interactions) {
      interactions.detach();
      interactions = null;
    }
    if (sigma) sigma.kill();
    container.innerHTML = "";
    container.appendChild(dropOverlay);

    data = next;
    const built = buildGraph(data);
    graph = built.graph;
    const nodesById = new Map<string, NodeRow>(data.nodes.map((n) => [n.id, n]));

    sigma = createSigma(graph, container);
    detachTooltip = attachTooltip(sigma, graph, nodesById);
    interactions = attachInteractions(sigma, graph, {
      edgesAlwaysOn: edgesAlwaysOnInput.checked,
      edgeOpacity: Number(edgesOpacityInput.value) / 100,
    });
    // Drop any pinned ids that aren't in this dataset, then push the survivors
    // into the handle. Store the set back so the URL reflects reality.
    const known = new Set(graph.nodes());
    pinned = new Set([...pinned].filter((id) => known.has(id)));
    interactions.setPinned(pinned);
    interactions.onPinnedChange((ids) => {
      pinned = ids;
      renderPinnedUi();
      syncUrl();
    });
    detachPhysics = attachDragPhysics(graph, sigma);
    detachSearch = attachSearch(searchInput, graph, (matched) =>
      interactions?.setSearch(matched),
    );
    detachLasso = attachLasso(sigma, container, onLasso);

    populateAttributeSelectors(data, binColorSel, genomeColorSel);
    if (params.binColor) binColorSel.value = params.binColor;
    if (params.genomeColor) genomeColorSel.value = params.genomeColor;

    if (filter) {
      const known = new Set(graph.nodes());
      filter = { ...filter, ids: filter.ids.filter((id) => known.has(id)) };
      if (filter.ids.length === 0) filter = null;
    }

    status.textContent = `${source}: ${data.nodes.length} nodes, ${data.edges.length} edges`;
    applyHeader(data.info);
    refresh();
    applyCurrentFilter();
    renderPinnedUi();
  };

  const initialUrl = params.data ?? DEFAULT_DATA_URL;
  status.textContent = `Loading ${initialUrl}…`;
  const initialToken = ++loadToken;
  const initialData = await loadGraph(initialUrl);
  if (initialToken === loadToken) {
    installGraph(initialData, initialUrl);
  }

  binColorSel.addEventListener("change", refresh);
  genomeColorSel.addEventListener("change", refresh);
  binPaletteSel.addEventListener("change", refresh);
  binSizeScaleSel.addEventListener("change", refresh);

  // loadToken tags the latest requested load; any callback whose token is no
  // longer current (because the user triggered another load meanwhile) bails
  // out before mutating the graph. Prevents the double-click / drop-while-
  // loading race where the older fetch can win against the newer one.
  const reload = async () => {
    const url = dataUrlInput.value.trim() || DEFAULT_DATA_URL;
    const myToken = ++loadToken;
    status.textContent = `Loading ${url}…`;
    try {
      const data = await loadGraph(url);
      if (myToken !== loadToken) return;
      installGraph(data, url);
    } catch (err) {
      if (myToken !== loadToken) return;
      status.textContent = `Error loading ${url}: ${err instanceof Error ? err.message : String(err)}`;
      console.error(err);
    }
  };

  dataLoadBtn.addEventListener("click", reload);
  dataUrlInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") reload();
  });

  attachDropzone(
    container,
    dropOverlay,
    (next, src) => {
      loadToken++;
      filter = null;
      installGraph(next, src);
    },
    (msg) => {
      status.textContent = `Drop failed: ${msg}`;
    },
  );

  exportPngBtn.addEventListener("click", () => exportPNG(sigma));
  exportSvgBtn.addEventListener("click", () => exportSVG(sigma, graph));

  selectionKeepBtn.addEventListener("click", () => {
    if (pendingSelection.length === 0) return;
    filter = { mode: "keep", ids: pendingSelection };
    hideSelectionActions();
    applyCurrentFilter();
  });
  selectionHideBtn.addEventListener("click", () => {
    if (pendingSelection.length === 0) return;
    filter = { mode: "hide", ids: pendingSelection };
    hideSelectionActions();
    applyCurrentFilter();
  });
  selectionCancelBtn.addEventListener("click", hideSelectionActions);

  filterClearBtn.addEventListener("click", () => {
    filter = null;
    applyCurrentFilter();
  });

  pinnedClearBtn.addEventListener("click", () => {
    interactions?.clearPinned();
  });

  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") hideSelectionActions();
  });

  edgesAlwaysOnInput.addEventListener("change", () => {
    interactions?.setEdgesAlwaysOn(edgesAlwaysOnInput.checked);
  });
  edgesOpacityInput.addEventListener("input", () => {
    interactions?.setEdgeOpacity(Number(edgesOpacityInput.value) / 100);
  });

  controlsToggleBtn.addEventListener("click", () => {
    document.body.classList.toggle("menu-collapsed");
  });
}

main().catch((err) => {
  const status = document.getElementById("status") as HTMLParagraphElement;
  status.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
  console.error(err);
});
