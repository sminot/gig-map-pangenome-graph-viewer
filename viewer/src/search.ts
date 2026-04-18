import type Sigma from "sigma";
import type Graph from "graphology";

/**
 * Highlight nodes (and adjacent edges) whose label contains `query`. Other
 * nodes/edges fade to a muted color. Ephemeral — not persisted in URL.
 */
export function attachSearch(
  input: HTMLInputElement,
  sigma: Sigma,
  graph: Graph,
): void {
  let matched: Set<string> = new Set();
  let active = false;

  sigma.setSetting("nodeReducer", (node, attrs) => {
    if (!active) return attrs;
    if (matched.has(node)) {
      return { ...attrs, zIndex: 2, highlighted: true };
    }
    return {
      ...attrs,
      color: "rgba(100, 110, 130, 0.25)",
      label: "",
      zIndex: 0,
    };
  });

  sigma.setSetting("edgeReducer", (edge, attrs) => {
    if (!active) return attrs;
    const [s, t] = graph.extremities(edge);
    if (matched.has(s) && matched.has(t)) {
      return { ...attrs, color: "rgba(120, 180, 255, 0.55)" };
    }
    if (matched.has(s) || matched.has(t)) {
      return { ...attrs, color: "rgba(120, 180, 255, 0.25)" };
    }
    return { ...attrs, color: "rgba(80, 90, 110, 0.08)" };
  });

  let pending = 0;
  input.addEventListener("input", () => {
    const raw = input.value.trim();
    window.clearTimeout(pending);
    pending = window.setTimeout(() => {
      if (!raw) {
        active = false;
        matched = new Set();
      } else {
        const needle = raw.toLowerCase();
        matched = new Set(
          graph.filterNodes((_n, a) =>
            String(a.label ?? "").toLowerCase().includes(needle),
          ),
        );
        active = true;
      }
      sigma.refresh();
    }, 120);
  });
}
