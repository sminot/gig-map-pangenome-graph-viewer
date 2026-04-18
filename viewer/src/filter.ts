import type Graph from "graphology";
import type Sigma from "sigma";

export type FilterMode = "keep" | "hide";

export interface FilterState {
  mode: FilterMode;
  ids: string[];
}

/** Apply (or clear) a node filter by toggling the `hidden` attribute. Edges
 * incident to a hidden node are hidden implicitly by Sigma. */
export function applyFilter(
  graph: Graph,
  sigma: Sigma,
  filter: FilterState | null,
): { visibleCount: number; totalCount: number } {
  const total = graph.order;

  if (!filter || filter.ids.length === 0) {
    graph.forEachNode((n) => graph.removeNodeAttribute(n, "hidden"));
    sigma.refresh();
    return { visibleCount: total, totalCount: total };
  }

  const set = new Set(filter.ids);
  let visible = 0;
  graph.forEachNode((n) => {
    const keep = filter.mode === "keep" ? set.has(n) : !set.has(n);
    if (keep) {
      graph.removeNodeAttribute(n, "hidden");
      visible++;
    } else {
      graph.setNodeAttribute(n, "hidden", true);
    }
  });
  sigma.refresh();
  return { visibleCount: visible, totalCount: total };
}
