import type Graph from "graphology";

/**
 * Lay every node on a unique pointy-top hexagonal cell and locally swap/move
 * nodes between cells to reduce the total weighted edge length.
 *
 * Uses axial coordinates (q, r) with the conversion:
 *   x = pitch * (q + r / 2)
 *   y = pitch * sqrt(3) / 2 * r
 * where `pitch` is the center-to-center distance between adjacent cells.
 */

type Axial = { q: number; r: number };

interface Edge {
  id: string;
  source: string;
  target: string;
  weight: number;
}

export interface HexLayoutOptions {
  /** Override the auto-computed cell pitch (graph units). */
  pitch?: number;
  /** Max refinement passes over the node set. Default 40. */
  maxPasses?: number;
  /** Search radius (in hex rings) for swap candidates. Default 2. */
  searchRadius?: number;
  /** Hard time budget for refinement, in ms. Default 1500. */
  timeBudgetMs?: number;
}

export function applyHexLayout(graph: Graph, options: HexLayoutOptions = {}): number {
  const nodes = graph.nodes();
  if (nodes.length === 0) return options.pitch ?? 1;

  // Gather initial x/y hints — we prefer the preprocessor embedding when present
  // so the grid layout preserves coarse neighborhoods.
  const hints = new Map<string, { x: number; y: number }>();
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  let haveFiniteHint = false;
  for (const id of nodes) {
    const x = Number(graph.getNodeAttribute(id, "x"));
    const y = Number(graph.getNodeAttribute(id, "y"));
    if (Number.isFinite(x) && Number.isFinite(y)) {
      hints.set(id, { x, y });
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      haveFiniteHint = true;
    }
  }
  if (!haveFiniteHint) {
    minX = 0;
    minY = 0;
    maxX = 1;
    maxY = 1;
  }

  // Auto-pitch: spread N cells across roughly the same area as the hint set,
  // with a small buffer. Falls back to a unit pitch when everything coincides.
  const diag = Math.hypot(maxX - minX, maxY - minY);
  const autoPitch = diag > 0 ? (diag / Math.sqrt(nodes.length)) * 0.95 : 1;
  const pitch = options.pitch ?? Math.max(autoPitch, 1e-6);

  const axialToXY = (cell: Axial) => ({
    x: pitch * (cell.q + cell.r / 2),
    y: pitch * (Math.sqrt(3) / 2) * cell.r,
  });

  const xyToAxial = (x: number, y: number): Axial => {
    // Fractional axial, then cube-round to the nearest hex.
    const qf = (x - y / Math.sqrt(3)) / pitch;
    const rf = (y / (Math.sqrt(3) / 2)) / pitch;
    return axialRound(qf, rf);
  };

  // Deterministic iteration order: nodes with more connections get first pick.
  const sorted = [...nodes].sort(
    (a, b) => graph.degree(b) - graph.degree(a) || (a < b ? -1 : 1),
  );

  const cellKey = (c: Axial) => `${c.q},${c.r}`;
  const cellToNode = new Map<string, string>();
  const nodeToCell = new Map<string, Axial>();

  const centerX = Number.isFinite((minX + maxX) / 2) ? (minX + maxX) / 2 : 0;
  const centerY = Number.isFinite((minY + maxY) / 2) ? (minY + maxY) / 2 : 0;

  // Seed placement: each node snaps to the cell nearest its hint, spiraling
  // outward when the desired cell is taken.
  for (const id of sorted) {
    const hint = hints.get(id) ?? { x: centerX, y: centerY };
    const desired = xyToAxial(hint.x - centerX, hint.y - centerY);
    const cell = findEmptyNear(desired, cellToNode);
    cellToNode.set(cellKey(cell), id);
    nodeToCell.set(id, cell);
  }

  // Build edge tables once — edge length cost only needs source/target/weight.
  const edgesByNode = new Map<string, Edge[]>();
  for (const id of nodes) edgesByNode.set(id, []);
  graph.forEachEdge((id, attrs, source, target) => {
    const w = Number(attrs.weight);
    const weight = Number.isFinite(w) && w > 0 ? w : 1;
    const entry: Edge = { id, source, target, weight };
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

  const searchRadius = options.searchRadius ?? 2;
  const maxPasses = options.maxPasses ?? 40;
  const timeBudgetMs = options.timeBudgetMs ?? 1500;
  const start = typeof performance !== "undefined" ? performance.now() : Date.now();
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

  // Precompute ring offsets once.
  const ringOffsets = ringsUpTo(searchRadius);

  for (let pass = 0; pass < maxPasses; pass++) {
    let improvements = 0;
    for (const node of sorted) {
      if (now() - start > timeBudgetMs) break;
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
          // Move into the empty cell.
          const newCost = costOf(node, candidate);
          const gain = currentCost - newCost;
          if (gain > bestGain) {
            bestGain = gain;
            bestTarget = candidate;
            bestSwap = null;
          }
        } else {
          // Swap with occupant. Shared-edge contribution is symmetric and cancels.
          const otherCurrent = costOf(occupant, candidate);
          // Temporarily swap to measure the swapped cost without mutating final state.
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
    if (now() - start > timeBudgetMs) break;
  }

  // Commit final positions back onto the graph.
  for (const id of nodes) {
    const cell = nodeToCell.get(id)!;
    const { x, y } = axialToXY(cell);
    graph.setNodeAttribute(id, "x", x);
    graph.setNodeAttribute(id, "y", y);
  }

  return pitch;
}

function findEmptyNear(
  desired: Axial,
  cellToNode: Map<string, string>,
): Axial {
  const key = (c: Axial) => `${c.q},${c.r}`;
  if (!cellToNode.has(key(desired))) return desired;
  // Spiral outward by rings.
  for (let radius = 1; radius < 10_000; radius++) {
    for (const offset of ringAt(radius)) {
      const candidate: Axial = {
        q: desired.q + offset.q,
        r: desired.r + offset.r,
      };
      if (!cellToNode.has(key(candidate))) return candidate;
    }
  }
  // Should never happen for any reasonable graph.
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
  // Start at the "northwest" corner and walk around.
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
  // Cube-round for unbiased nearest-hex snapping.
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
