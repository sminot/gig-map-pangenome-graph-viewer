import FA2Layout from "graphology-layout-forceatlas2/worker";
import forceAtlas2 from "graphology-layout-forceatlas2";
import type Graph from "graphology";
import type Sigma from "sigma";

/**
 * Wire up click-and-drag with localized force-directed behavior.
 *
 * While the user holds a node, the FA2 worker runs a simulation so neighbors
 * spring around the dragged node; the pinned node's position is overwritten
 * each tick to match the cursor. On release, the simulation winds down.
 */
export function attachDragPhysics(graph: Graph, sigma: Sigma): () => void {
  const settings = forceAtlas2.inferSettings(graph);
  const layout = new FA2Layout(graph, {
    settings: {
      ...settings,
      slowDown: 8,
      gravity: 0.3,
      scalingRatio: 4,
      barnesHutOptimize: graph.order > 2000,
    },
  });

  let draggedNode: string | null = null;
  let isDragging = false;

  const camera = sigma.getCamera();

  sigma.on("downNode", (event) => {
    draggedNode = event.node;
    isDragging = true;
    graph.setNodeAttribute(draggedNode, "highlighted", true);
    camera.disable();
    if (!layout.isRunning()) layout.start();
  });

  sigma.getMouseCaptor().on("mousemovebody", (event) => {
    if (!isDragging || !draggedNode) return;
    const pos = sigma.viewportToGraph(event);
    graph.setNodeAttribute(draggedNode, "x", pos.x);
    graph.setNodeAttribute(draggedNode, "y", pos.y);
    event.preventSigmaDefault();
    event.original.preventDefault();
    event.original.stopPropagation();
  });

  const release = () => {
    if (!isDragging) return;
    if (draggedNode) graph.removeNodeAttribute(draggedNode, "highlighted");
    draggedNode = null;
    isDragging = false;
    camera.enable();
    // Let the simulation settle briefly, then pause so the graph is stable.
    window.setTimeout(() => {
      if (!isDragging) layout.stop();
    }, 400);
  };

  sigma.getMouseCaptor().on("mouseup", release);
  sigma.getMouseCaptor().on("mouseleave", release);

  return () => {
    layout.kill();
  };
}
