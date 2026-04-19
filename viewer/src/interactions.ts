import type Sigma from "sigma";
import type Graph from "graphology";

/**
 * Single source of truth for the per-render reducers. Three independent
 * inputs feed into the final node/edge styling:
 *
 *   - hovered node (set by sigma's enterNode/leaveNode)
 *   - search match set (driven by the search box)
 *   - edge global controls (always-on toggle + opacity slider)
 *
 * Sigma only allows one node reducer and one edge reducer, so search can't
 * own its own reducers — they all share state here.
 */

export interface InteractionHandle {
  setSearch(matched: Set<string>): void;
  setEdgesAlwaysOn(on: boolean): void;
  setEdgeOpacity(alpha: number): void;
  detach(): void;
}

interface InteractionState {
  hoveredNode: string | null;
  search: Set<string>;
  edgesAlwaysOn: boolean;
  edgeOpacity: number;
}

const FADE_NODE_COLOR = "rgba(100, 110, 130, 0.25)";
const HIGHLIGHT_EDGE_BOTH = "rgba(120, 180, 255, 0.55)";
const HIGHLIGHT_EDGE_PARTIAL = "rgba(120, 180, 255, 0.35)";
const HOVER_EDGE_COLOR = "rgba(120, 180, 255, 0.85)";

export function attachInteractions(
  sigma: Sigma,
  graph: Graph,
  initial: { edgesAlwaysOn: boolean; edgeOpacity: number },
): InteractionHandle {
  const state: InteractionState = {
    hoveredNode: null,
    search: new Set(),
    edgesAlwaysOn: initial.edgesAlwaysOn,
    edgeOpacity: initial.edgeOpacity,
  };

  const onEnter = ({ node }: { node: string }) => {
    state.hoveredNode = node;
    sigma.refresh();
  };
  const onLeave = () => {
    state.hoveredNode = null;
    sigma.refresh();
  };
  sigma.on("enterNode", onEnter);
  sigma.on("leaveNode", onLeave);

  sigma.setSetting("nodeReducer", (node, attrs) => {
    if (state.search.size === 0) return attrs;
    if (state.search.has(node)) {
      return { ...attrs, zIndex: 2, highlighted: true };
    }
    return { ...attrs, color: FADE_NODE_COLOR, label: "", zIndex: 0 };
  });

  sigma.setSetting("edgeReducer", (edge, attrs) => {
    const [s, t] = graph.extremities(edge);
    const hovered = state.hoveredNode;
    const matched = state.search;
    const searching = matched.size > 0;

    const touchedByHover =
      hovered != null && (s === hovered || t === hovered);
    const matchTouches = searching && (matched.has(s) || matched.has(t));
    const matchBoth = searching && matched.has(s) && matched.has(t);

    // Visibility: hover always wins (focuses on neighborhood); otherwise
    // search restricts to matched-touching edges; otherwise the always-on
    // toggle decides whether to draw anything at all.
    let visible: boolean;
    if (hovered != null) visible = touchedByHover;
    else if (searching) visible = matchTouches;
    else visible = state.edgesAlwaysOn;

    if (!visible) return { ...attrs, hidden: true };

    let color: string;
    if (touchedByHover) {
      color = HOVER_EDGE_COLOR;
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
    detach() {
      sigma.off("enterNode", onEnter);
      sigma.off("leaveNode", onLeave);
    },
  };
}
