import type Graph from "graphology";

/**
 * Place every node on a unique pointy-top hexagonal cell. Connected components
 * are laid out independently, then shelf-packed with a visible gap between
 * them so disjoint sub-graphs appear as distinct islands.
 *
 * Axial coordinates (q, r) map to cartesian as:
 *   x = pitch * (q + r / 2)
 *   y = pitch * sqrt(3) / 2 * r
 * where `pitch` is the center-to-center distance between adjacent cells.
 */

type Axial = { q: number; r: number };

interface Edge {
  source: string;
  target: string;
  weight: number;
}

export interface HexLayoutOptions {
  /** Override the auto-computed cell pitch (graph units). */
  pitch?: number;
  /** Max refinement passes per component. Default 40. */
  maxPasses?: number;
  /** Search radius (in hex rings) for swap candidates. Default 2. */
  searchRadius?: number;
  /** Hard time budget for refinement across all components, in ms. */
  timeBudgetMs?: number;
  /** Empty-cell gap (in hex cells) between packed components. Default 3. */
  componentGap?: number;
}

interface ComponentLayout {
  nodeIds: string[];
  positions: Map<string, { x: number; y: number }>;
  width: number;
  height: number;
  minX: number;
  minY: number;
}

const SQRT3 = Math.sqrt(3);

export function applyHexLayout(
  graph: Graph,
  options: HexLayoutOptions = {},
): number {
  const allNodes = graph.nodes();
  if (allNodes.length === 0) return options.pitch ?? 1;

  const { pitch, hints, centerX, centerY } = gatherHints(graph, allNodes, options);
  const axialToXY = (cell: Axial) => ({
    x: pitch * (cell.q + cell.r / 2),
    y: pitch * (SQRT3 / 2) * cell.r,
  });
  const xyToAxial = (x: number, y: number): Axial => {
    const qf = (x - y / SQRT3) / pitch;
    const rf = y / ((SQRT3 / 2) * pitch);
    return axialRound(qf, rf);
  };

  const components = findComponents(graph);

  // Share the time budget across components, weighted by node count.
  const totalBudget = options.timeBudgetMs ?? 1500;
  const layouts: ComponentLayout[] = components.map((comp) => {
    const share = Math.max(
      50,
      Math.round((totalBudget * comp.length) / allNodes.length),
    );
    return layoutComponent(
      graph,
      comp,
      hints,
      centerX,
      centerY,
      axialToXY,
      xyToAxial,
      {
        maxPasses: options.maxPasses ?? 40,
        searchRadius: options.searchRadius ?? 2,
        timeBudgetMs: share,
      },
    );
  });

  // Largest islands first — gives the packer a stable, predictable shape.
  layouts.sort((a, b) => b.nodeIds.length - a.nodeIds.length);

  const gap = Math.max(1, options.componentGap ?? 3) * pitch;
  const offsets = shelfPack(layouts, gap);

  for (let i = 0; i < layouts.length; i++) {
    const layout = layouts[i];
    const { dx, dy } = offsets[i];
    for (const id of layout.nodeIds) {
      const p = layout.positions.get(id)!;
      graph.setNodeAttribute(id, "x", p.x + dx);
      graph.setNodeAttribute(id, "y", p.y + dy);
    }
  }

  return pitch;
}

function gatherHints(
  graph: Graph,
  nodes: string[],
  options: HexLayoutOptions,
): {
  pitch: number;
  hints: Map<string, { x: number; y: number }>;
  centerX: number;
  centerY: number;
} {
  const hints = new Map<string, { x: number; y: number }>();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let haveFinite = false;
  for (const id of nodes) {
    const x = Number(graph.getNodeAttribute(id, "x"));
    const y = Number(graph.getNodeAttribute(id, "y"));
    if (Number.isFinite(x) && Number.isFinite(y)) {
      hints.set(id, { x, y });
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      haveFinite = true;
    }
  }
  if (!haveFinite) {
    minX = 0;
    minY = 0;
    maxX = 1;
    maxY = 1;
  }
  const diag = Math.hypot(maxX - minX, maxY - minY);
  const autoPitch = diag > 0 ? (diag / Math.sqrt(nodes.length)) * 0.95 : 1;
  const pitch = options.pitch ?? Math.max(autoPitch, 1e-6);
  return {
    pitch,
    hints,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
  };
}

function findComponents(graph: Graph): string[][] {
  const seen = new Set<string>();
  const comps: string[][] = [];
  for (const start of graph.nodes()) {
    if (seen.has(start)) continue;
    const queue: string[] = [start];
    let head = 0;
    seen.add(start);
    const comp: string[] = [];
    while (head < queue.length) {
      const id = queue[head++];
      comp.push(id);
      graph.forEachNeighbor(id, (nbr) => {
        if (!seen.has(nbr)) {
          seen.add(nbr);
          queue.push(nbr);
        }
      });
    }
    comps.push(comp);
  }
  return comps;
}

function layoutComponent(
  graph: Graph,
  nodeIds: string[],
  hints: Map<string, { x: number; y: number }>,
  centerX: number,
  centerY: number,
  axialToXY: (c: Axial) => { x: number; y: number },
  xyToAxial: (x: number, y: number) => Axial,
  options: { maxPasses: number; searchRadius: number; timeBudgetMs: number },
): ComponentLayout {
  const member = new Set(nodeIds);

  // Component-local hints: recenter on the centroid of this component's hints
  // so its cells cluster near the axial origin, independent of where the
  // full-graph hint cloud lives.
  let hintCX = 0;
  let hintCY = 0;
  let hintCount = 0;
  for (const id of nodeIds) {
    const h = hints.get(id);
    if (h) {
      hintCX += h.x;
      hintCY += h.y;
      hintCount++;
    }
  }
  if (hintCount > 0) {
    hintCX /= hintCount;
    hintCY /= hintCount;
  } else {
    hintCX = centerX;
    hintCY = centerY;
  }

  // Place high-degree nodes first so the component's hub gets its preferred
  // cell; leaves spiral around them.
  const sorted = [...nodeIds].sort(
    (a, b) => graph.degree(b) - graph.degree(a) || (a < b ? -1 : 1),
  );

  const cellKey = (c: Axial) => `${c.q},${c.r}`;
  const cellToNode = new Map<string, string>();
  const nodeToCell = new Map<string, Axial>();

  for (const id of sorted) {
    const h = hints.get(id) ?? { x: hintCX, y: hintCY };
    const desired = xyToAxial(h.x - hintCX, h.y - hintCY);
    const cell = findEmptyNear(desired, cellToNode);
    cellToNode.set(cellKey(cell), id);
    nodeToCell.set(id, cell);
  }

  // Edge table for this component only.
  const edgesByNode = new Map<string, Edge[]>();
  for (const id of nodeIds) edgesByNode.set(id, []);
  graph.forEachEdge((_eid, attrs, source, target) => {
    if (!member.has(source) || !member.has(target)) return;
    const w = Number(attrs.weight);
    const weight = Number.isFinite(w) && w > 0 ? w : 1;
    const entry: Edge = { source, target, weight };
    edgesByNode.get(source)!.push(entry);
    edgesByNode.get(target)!.push(entry);
  });

  const otherEnd = (edge: Edge, self: string): string =>
    edge.source === self ? edge.target : edge.source;

  const hexDist = (a: Axial, b: Axial): number => {
    const dq = a.q - b.q;
    const dr = a.r - b.r;
    return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
  };

  const costOf = (node: string, cell: Axial): number => {
    let sum = 0;
    for (const edge of edgesByNode.get(node) ?? []) {
      const other = otherEnd(edge, node);
      const otherCell = nodeToCell.get(other);
      if (!otherCell) continue;
      sum += hexDist(cell, otherCell) * edge.weight;
    }
    return sum;
  };

  const ringOffsets = ringsUpTo(options.searchRadius);
  const start = now();
  for (let pass = 0; pass < options.maxPasses; pass++) {
    let improvements = 0;
    for (const node of sorted) {
      if (now() - start > options.timeBudgetMs) break;
      const currentCell = nodeToCell.get(node)!;
      const currentCost = costOf(node, currentCell);

      let bestGain = 1e-9;
      let bestTarget: Axial | null = null;
      let bestSwap: string | null = null;

      for (const offset of ringOffsets) {
        const candidate: Axial = {
          q: currentCell.q + offset.q,
          r: currentCell.r + offset.r,
        };
        const key = cellKey(candidate);
        const occupant = cellToNode.get(key);
        if (occupant === node) continue;

        if (!occupant) {
          const newCost = costOf(node, candidate);
          const gain = currentCost - newCost;
          if (gain > bestGain) {
            bestGain = gain;
            bestTarget = candidate;
            bestSwap = null;
          }
        } else {
          const otherCurrent = costOf(occupant, candidate);
          nodeToCell.set(node, candidate);
          nodeToCell.set(occupant, currentCell);
          const newSelf = costOf(node, candidate);
          const newOther = costOf(occupant, currentCell);
          nodeToCell.set(node, currentCell);
          nodeToCell.set(occupant, candidate);
          const gain = currentCost + otherCurrent - newSelf - newOther;
          if (gain > bestGain) {
            bestGain = gain;
            bestTarget = candidate;
            bestSwap = occupant;
          }
        }
      }

      if (bestTarget) {
        const targetKey = cellKey(bestTarget);
        const currentKey = cellKey(currentCell);
        if (bestSwap) {
          nodeToCell.set(node, bestTarget);
          nodeToCell.set(bestSwap, currentCell);
          cellToNode.set(targetKey, node);
          cellToNode.set(currentKey, bestSwap);
        } else {
          nodeToCell.set(node, bestTarget);
          cellToNode.delete(currentKey);
          cellToNode.set(targetKey, node);
        }
        improvements++;
      }
    }
    if (improvements === 0) break;
    if (now() - start > options.timeBudgetMs) break;
  }

  // Convert to XY and compute bounding box.
  const positions = new Map<string, { x: number; y: number }>();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const id of nodeIds) {
    const cell = nodeToCell.get(id)!;
    const xy = axialToXY(cell);
    positions.set(id, xy);
    if (xy.x < minX) minX = xy.x;
    if (xy.y < minY) minY = xy.y;
    if (xy.x > maxX) maxX = xy.x;
    if (xy.y > maxY) maxY = xy.y;
  }
  return {
    nodeIds,
    positions,
    width: maxX - minX,
    height: maxY - minY,
    minX,
    minY,
  };
}

/**
 * Next-fit-decreasing-height shelf packing. Components are arranged left to
 * right into rows; a new row starts when the current shelf would exceed a
 * square-ish target width. Simple, deterministic, and good enough for the
 * island-of-islands aesthetic.
 */
function shelfPack(
  layouts: ComponentLayout[],
  gap: number,
): { dx: number; dy: number }[] {
  const totalArea = layouts.reduce(
    (s, l) => s + (l.width + gap) * (l.height + gap),
    0,
  );
  const targetWidth = Math.sqrt(Math.max(totalArea, 1)) * 1.2;

  const offsets: { dx: number; dy: number }[] = new Array(layouts.length);
  let shelfY = 0;
  let shelfHeight = 0;
  let cursorX = 0;
  let shelfFirst = true;

  for (let i = 0; i < layouts.length; i++) {
    const l = layouts[i];
    const w = l.width;
    const h = l.height;

    if (!shelfFirst && cursorX + w > targetWidth) {
      // Wrap to the next shelf.
      shelfY += shelfHeight + gap;
      cursorX = 0;
      shelfHeight = 0;
      shelfFirst = true;
    }

    // Translate so the component's local min-corner lands at (cursorX, shelfY).
    offsets[i] = { dx: cursorX - l.minX, dy: shelfY - l.minY };
    cursorX += w + gap;
    if (h > shelfHeight) shelfHeight = h;
    shelfFirst = false;
  }
  return offsets;
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function findEmptyNear(
  desired: Axial,
  cellToNode: Map<string, string>,
): Axial {
  const key = (c: Axial) => `${c.q},${c.r}`;
  if (!cellToNode.has(key(desired))) return desired;
  for (let radius = 1; radius < 10_000; radius++) {
    for (const offset of ringAt(radius)) {
      const candidate: Axial = {
        q: desired.q + offset.q,
        r: desired.r + offset.r,
      };
      if (!cellToNode.has(key(candidate))) return candidate;
    }
  }
  return desired;
}

const AXIAL_DIRS: Axial[] = [
  { q: +1, r: 0 },
  { q: +1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: +1 },
  { q: 0, r: +1 },
];

function ringAt(radius: number): Axial[] {
  if (radius <= 0) return [{ q: 0, r: 0 }];
  const cells: Axial[] = [];
  let q = AXIAL_DIRS[4].q * radius;
  let r = AXIAL_DIRS[4].r * radius;
  for (let side = 0; side < 6; side++) {
    for (let step = 0; step < radius; step++) {
      cells.push({ q, r });
      q += AXIAL_DIRS[side].q;
      r += AXIAL_DIRS[side].r;
    }
  }
  return cells;
}

function ringsUpTo(radius: number): Axial[] {
  const result: Axial[] = [];
  for (let r = 1; r <= radius; r++) {
    for (const cell of ringAt(r)) result.push(cell);
  }
  return result;
}

function axialRound(qf: number, rf: number): Axial {
  const xf = qf;
  const zf = rf;
  const yf = -xf - zf;
  let rx = Math.round(xf);
  let ry = Math.round(yf);
  let rz = Math.round(zf);
  const dx = Math.abs(rx - xf);
  const dy = Math.abs(ry - yf);
  const dz = Math.abs(rz - zf);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return { q: rx, r: rz };
}
