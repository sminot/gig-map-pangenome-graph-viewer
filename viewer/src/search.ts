import type Graph from "graphology";

/**
 * Wire the search input to the interactions handle. The actual node/edge
 * styling is decided by `interactions.ts` — this module just computes the
 * matched-id set and pushes it in.
 */
export function attachSearch(
  input: HTMLInputElement,
  graph: Graph,
  setMatched: (matched: Set<string>) => void,
): () => void {
  let pending = 0;
  const onInput = () => {
    const raw = input.value.trim();
    window.clearTimeout(pending);
    pending = window.setTimeout(() => {
      if (!raw) {
        setMatched(new Set());
        return;
      }
      const needle = raw.toLowerCase();
      const matched = new Set(
        graph.filterNodes((_n, a) =>
          String(a.label ?? "").toLowerCase().includes(needle),
        ),
      );
      setMatched(matched);
    }, 120);
  };
  input.addEventListener("input", onInput);
  return () => {
    window.clearTimeout(pending);
    input.removeEventListener("input", onInput);
  };
}
