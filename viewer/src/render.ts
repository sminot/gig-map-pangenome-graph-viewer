import Sigma from "sigma";
import { createNodeBorderProgram } from "@sigma/node-border";
import type Graph from "graphology";

/**
 * Genome nodes render as unfilled "rings": a 2px outer band in the node's
 * color, with the center filled in the canvas background so it reads as an
 * outline against edges. Bins keep the default solid-filled circle.
 */
const RING_BACKGROUND = "#010409";
const RING_PROGRAM = createNodeBorderProgram({
  borders: [
    {
      color: { attribute: "color" },
      size: { value: 2, mode: "pixels" },
    },
    {
      color: { value: RING_BACKGROUND },
      size: { fill: true },
    },
  ],
});

export function createSigma(graph: Graph, container: HTMLElement): Sigma {
  const renderer = new Sigma(graph, container, {
    renderEdgeLabels: false,
    enableEdgeEvents: false,
    defaultNodeType: "circle",
    nodeProgramClasses: {
      ring: RING_PROGRAM,
    },
    labelDensity: 0.2,
    labelGridCellSize: 80,
    labelRenderedSizeThreshold: 12,
    zIndex: true,
    minCameraRatio: 0.02,
    maxCameraRatio: 40,
    // Node "size" is in graph coordinates, so circles scale with zoom and
    // never outgrow their hex cell regardless of camera ratio.
    itemSizesReference: "positions",
    zoomToSizeRatioFunction: (ratio) => ratio,
  });
  return renderer;
}
