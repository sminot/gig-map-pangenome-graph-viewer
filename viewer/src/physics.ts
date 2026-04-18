import type Graph from "graphology";
import type Sigma from "sigma";

/**
 * Wire up click-and-drag with gentle, local node tugging.
 *
 * No simulation runs. The dragged node follows the cursor exactly; its direct
 * neighbors get pulled by a small fraction of the drag delta so the edges
 * appear to tug rather than stay rigid. When the mouse is released everything
 * stays where it is — no force-directed settling.
 */

const TUG_STRENGTH_MIN = 0.1;
const TUG_STRENGTH_MAX = 0.35;

interface NeighborSnapshot {
  x: number;
  y: number;
  strength: number;
}

export function attachDragPhysics(graph: Graph, sigma: Sigma): () => void {
  let draggedNode: string | null = null;
  let initialNodeX = 0;
  let initialNodeY = 0;
  let initialCursorX = 0;
  let initialCursorY = 0;
  const neighborSnapshots = new Map<string, NeighborSnapshot>();

  const camera = sigma.getCamera();

  sigma.on("downNode", (event) => {
    draggedNode = event.node;
    initialNodeX = Number(graph.getNodeAttribute(draggedNode, "x"));
    initialNodeY = Number(graph.getNodeAttribute(draggedNode, "y"));
    const cursor = sigma.viewportToGraph(event.event);
    initialCursorX = cursor.x;
    initialCursorY = cursor.y;

    neighborSnapshots.clear();
    graph.forEachNeighbor(draggedNode, (neighbor, _attrs) => {
      if (neighbor === draggedNode) return;
      const edgeId = graph.edge(draggedNode!, neighbor);
      let weight = 1;
      if (edgeId) {
        const w = Number(graph.getEdgeAttribute(edgeId, "weight"));
        if (Number.isFinite(w)) weight = Math.max(0, Math.min(1, w));
      }
      const strength =
        TUG_STRENGTH_MIN + (TUG_STRENGTH_MAX - TUG_STRENGTH_MIN) * weight;
      neighborSnapshots.set(neighbor, {
        x: Number(graph.getNodeAttribute(neighbor, "x")),
        y: Number(graph.getNodeAttribute(neighbor, "y")),
        strength,
      });
    });

    graph.setNodeAttribute(draggedNode, "highlighted", true);
    camera.disable();
  });

  sigma.getMouseCaptor().on("mousemovebody", (event) => {
    if (!draggedNode) return;
    const cursor = sigma.viewportToGraph(event);
    const dx = cursor.x - initialCursorX;
    const dy = cursor.y - initialCursorY;

    graph.setNodeAttribute(draggedNode, "x", initialNodeX + dx);
    graph.setNodeAttribute(draggedNode, "y", initialNodeY + dy);

    for (const [id, snap] of neighborSnapshots) {
      graph.setNodeAttribute(id, "x", snap.x + dx * snap.strength);
      graph.setNodeAttribute(id, "y", snap.y + dy * snap.strength);
    }

    event.preventSigmaDefault();
    event.original.preventDefault();
    event.original.stopPropagation();
  });

  const release = () => {
    if (!draggedNode) return;
    graph.removeNodeAttribute(draggedNode, "highlighted");
    draggedNode = null;
    neighborSnapshots.clear();
    camera.enable();
  };

  sigma.getMouseCaptor().on("mouseup", release);
  sigma.getMouseCaptor().on("mouseleave", release);

  return release;
}
