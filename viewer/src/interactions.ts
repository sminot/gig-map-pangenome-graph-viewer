import type Sigma from "sigma";
import type Graph from "graphology";

/**
 * Single source of truth for the per-render reducers. These inputs all feed
 * into the final node/edge styling:
 *
 *   - hovered node (set by sigma's enterNode/leaveNode)
 *   - pinned set (cumulative click selection — click a node to keep its
 *     edges on; click again to unpin)
 *   - search match set (driven by the search box)
 *   - edge global controls (always-on toggle + opacity slider)
 *
 * Sigma only allows one node reducer and one edge reducer, so these can't
 * own their own reducers — they all share state here.
 */

export interface InteractionHandle {
  setSearch(matched: Set<string>): void;
  setEdgesAlwaysOn(on: boolean): void;
  setEdgeOpacity(alpha: number): void;
  setPinned(ids: Iterable<string>): void;
  getPinned(): Set<string>;
  clearPinned(): void;
  onPinnedChange(cb: (ids: Set<string>) => void): void;
  detach(): void;
}

interface InteractionState {
  hoveredNode: string | null;
  search: Set<string>;
  pinned: Set<string>;
  edgesAlwaysOn: boolean;
  edgeOpacity: number;
}

const FADE_NODE_COLOR = "rgba(100, 110, 130, 0.25)";
const HIGHLIGHT_EDGE_BOTH = "rgba(120, 180, 255, 0.55)";
const HIGHLIGHT_EDGE_PARTIAL = "rgba(120, 180, 255, 0.35)";
const HOVER_EDGE_COLOR = "rgba(120, 180, 255, 0.85)";
const PINNED_EDGE_COLOR = "rgba(240, 136, 62, 0.7)";

export function attachInteractions(
  sigma: Sigma,
  graph: Graph,
  initial: { edgesAlwaysOn: boolean; edgeOpacity: number },
): InteractionHandle {
  const state: InteractionState = {
    hoveredNode: null,
    search: new Set(),
    pinned: new Set(),
    edgesAlwaysOn: initial.edgesAlwaysOn,
    edgeOpacity: initial.edgeOpacity,
  };

  let pinnedListener: ((ids: Set<string>) => void) | null = null;
  const emitPinned = () => {
    pinnedListener?.(new Set(state.pinned));
  };

  const onEnter = ({ node }: { node: string }) => {
    state.hoveredNode = node;
    sigma.refresh();
  };
  const onLeave = () => {
    state.hoveredNode = null;
    sigma.refresh();
  };
  const onClickNode = ({ node }: { node: string }) => {
    if (state.pinned.has(node)) state.pinned.delete(node);
    else state.pinned.add(node);
    emitPinned();
    sigma.refresh();
  };
  sigma.on("enterNode", onEnter);
  sigma.on("leaveNode", onLeave);
  sigma.on("clickNode", onClickNode);

  // NOTE: this module is the sole owner of sigma's node/edge reducers —
  // sigma only stores one function per key, so if another module also calls
  // setSetting("nodeReducer"|"edgeReducer") the state below is silently
  // overridden. Keep all per-render styling decisions in this file.
  sigma.setSetting("nodeReducer", (node, attrs) => {
    const pinned = state.pinned.has(node);
    const searching = state.search.size > 0;
    if (searching) {
      if (state.search.has(node)) {
        return { ...attrs, zIndex: 2, highlighted: true };
      }
      if (pinned) {
        return { ...attrs, zIndex: 2, highlighted: true };
      }
      return { ...attrs, color: FADE_NODE_COLOR, label: "", zIndex: 0 };
    }
    if (pinned) return { ...attrs, zIndex: 2, highlighted: true };
    return attrs;
  });

  sigma.setSetting("edgeReducer", (edge, attrs) => {
    const [s, t] = graph.extremities(edge);
    const hovered = state.hoveredNode;
    const matched = state.search;
    const searching = matched.size > 0;
    const pinned = state.pinned;
    const pinning = pinned.size > 0;

    const touchedByHover =
      hovered != null && (s === hovered || t === hovered);
    const touchedByPin = pinning && (pinned.has(s) || pinned.has(t));
    const matchTouches = searching && (matched.has(s) || matched.has(t));
    const matchBoth = searching && matched.has(s) && matched.has(t);

    // Hover wins for focus, then cumulative pin, then search, else global
    // always-on toggle.
    let visible: boolean;
    if (hovered != null) visible = touchedByHover;
    else if (pinning || searching || !state.edgesAlwaysOn) {
      visible = touchedByPin || matchTouches || state.edgesAlwaysOn;
    } else visible = true;

    if (!visible) return { ...attrs, hidden: true };

    let color: string;
    if (touchedByHover) {
      color = HOVER_EDGE_COLOR;
    } else if (touchedByPin) {
      color = PINNED_EDGE_COLOR;
    } else if (matchBoth) {
      color = HIGHLIGHT_EDGE_BOTH;
    } else if (matchTouches) {
      color = HIGHLIGHT_EDGE_PARTIAL;
    } else {
      color = `rgba(120, 140, 180, ${state.edgeOpacity.toFixed(3)})`;
    }
    return { ...attrs, color };
  });

  return {
    setSearch(matched) {
      state.search = matched;
      sigma.refresh();
    },
    setEdgesAlwaysOn(on) {
      state.edgesAlwaysOn = on;
      sigma.refresh();
    },
    setEdgeOpacity(alpha) {
      state.edgeOpacity = Math.max(0, Math.min(1, alpha));
      sigma.refresh();
    },
    setPinned(ids) {
      state.pinned = new Set(ids);
      emitPinned();
      sigma.refresh();
    },
    getPinned() {
      return new Set(state.pinned);
    },
    clearPinned() {
      if (state.pinned.size === 0) return;
      state.pinned = new Set();
      emitPinned();
      sigma.refresh();
    },
    onPinnedChange(cb) {
      pinnedListener = cb;
    },
    detach() {
      sigma.off("enterNode", onEnter);
      sigma.off("leaveNode", onLeave);
      sigma.off("clickNode", onClickNode);
      pinnedListener = null;
    },
  };
}
