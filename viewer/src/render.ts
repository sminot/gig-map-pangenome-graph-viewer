import Sigma from "sigma";
import { NodeSquareProgram } from "@sigma/node-square";
import type Graph from "graphology";

export function createSigma(graph: Graph, container: HTMLElement): Sigma {
  const renderer = new Sigma(graph, container, {
    renderEdgeLabels: false,
    enableEdgeEvents: false,
    defaultNodeType: "circle",
    nodeProgramClasses: {
      square: NodeSquareProgram,
    },
    labelDensity: 0.2,
    labelGridCellSize: 80,
    labelRenderedSizeThreshold: 12,
    zIndex: true,
    minCameraRatio: 0.05,
    maxCameraRatio: 20,
  });
  return renderer;
}
