import type Graph from "graphology";
import type Sigma from "sigma";

/**
 * Click-and-drag with gentle local node tugging — works for both mouse and
 * touch. The dragged node follows the pointer exactly; its direct neighbors
 * are pulled by a small fraction of the drag delta so edges appear to tug
 * without the layout restructuring.
 *
 * Camera is only taken over once the pointer actually moves, so a pure tap
 * (pin-toggle) still propagates to clickNode and doesn't leave the camera
 * disabled on mobile if a touchup event gets dropped.
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
  let dragActive = false;
  const neighborSnapshots = new Map<string, NeighborSnapshot>();

  const camera = sigma.getCamera();
  const mouseCaptor = sigma.getMouseCaptor();
  const touchCaptor = sigma.getTouchCaptor();

  const captureNeighbors = (node: string) => {
    neighborSnapshots.clear();
    graph.forEachNeighbor(node, (neighbor) => {
      if (neighbor === node) return;
      const edgeId = graph.edge(node, neighbor);
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
  };

  const onDownNode = (event: { node: string; event: { x: number; y: number } }) => {
    draggedNode = event.node;
    dragActive = false;
    initialNodeX = Number(graph.getNodeAttribute(draggedNode, "x"));
    initialNodeY = Number(graph.getNodeAttribute(draggedNode, "y"));
    const cursor = sigma.viewportToGraph(event.event);
    initialCursorX = cursor.x;
    initialCursorY = cursor.y;
    captureNeighbors(draggedNode);
  };

  const activate = () => {
    if (dragActive || !draggedNode) return;
    dragActive = true;
    graph.setNodeAttribute(draggedNode, "highlighted", true);
    camera.disable();
  };

  const applyMove = (viewportX: number, viewportY: number) => {
    if (!draggedNode) return;
    const cursor = sigma.viewportToGraph({ x: viewportX, y: viewportY });
    const dx = cursor.x - initialCursorX;
    const dy = cursor.y - initialCursorY;

    // Skip tiny jitters on touch devices so a tap isn't interpreted as a drag.
    if (!dragActive && Math.hypot(dx, dy) < 1e-6) return;
    activate();

    graph.setNodeAttribute(draggedNode, "x", initialNodeX + dx);
    graph.setNodeAttribute(draggedNode, "y", initialNodeY + dy);
    for (const [id, snap] of neighborSnapshots) {
      graph.setNodeAttribute(id, "x", snap.x + dx * snap.strength);
      graph.setNodeAttribute(id, "y", snap.y + dy * snap.strength);
    }
  };

  const onMouseMoveBody = (event: {
    x: number;
    y: number;
    preventSigmaDefault: () => void;
    original: MouseEvent | TouchEvent;
  }) => {
    if (!draggedNode) return;
    applyMove(event.x, event.y);
    if (dragActive) {
      event.preventSigmaDefault();
      event.original.preventDefault();
      event.original.stopPropagation();
    }
  };

  const onTouchMoveBody = (event: {
    touches: { x: number; y: number }[];
    preventSigmaDefault: () => void;
    original: TouchEvent;
  }) => {
    if (!draggedNode || event.touches.length === 0) return;
    // Multi-touch (e.g. pinch-to-zoom) cancels any in-flight drag so sigma's
    // touch captor can run its gesture without fighting us.
    if (event.touches.length > 1) {
      release();
      return;
    }
    const t = event.touches[0];
    applyMove(t.x, t.y);
    if (dragActive) {
      event.preventSigmaDefault();
      event.original.preventDefault();
      event.original.stopPropagation();
    }
  };

  const release = () => {
    if (!draggedNode) return;
    if (dragActive) {
      graph.removeNodeAttribute(draggedNode, "highlighted");
      camera.enable();
    }
    draggedNode = null;
    dragActive = false;
    neighborSnapshots.clear();
  };

  sigma.on("downNode", onDownNode);
  mouseCaptor.on("mousemovebody", onMouseMoveBody);
  mouseCaptor.on("mouseup", release);
  mouseCaptor.on("mouseleave", release);
  touchCaptor.on("touchmovebody", onTouchMoveBody);
  touchCaptor.on("touchup", release);

  return () => {
    sigma.off("downNode", onDownNode);
    mouseCaptor.off("mousemovebody", onMouseMoveBody);
    mouseCaptor.off("mouseup", release);
    mouseCaptor.off("mouseleave", release);
    touchCaptor.off("touchmovebody", onTouchMoveBody);
    touchCaptor.off("touchup", release);
    release();
  };
}
