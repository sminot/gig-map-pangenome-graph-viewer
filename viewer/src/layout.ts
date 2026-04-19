import type Graph from "graphology";

/**
 * Snap a continuous 2D embedding (one position per node) to a unique
 * pointy-top hexagonal cell, picking the grid pitch so most nodes don't have
 * to move far, and resolving collisions to minimize total displacement.
 *
 * Axial coordinates (q, r) map to cartesian as:
 *   x = pitch * (q + r / 2)
 *   y = pitch * sqrt(3) / 2 * r
 * where `pitch` is the center-to-center distance between adjacent cells.
 */

type Axial = { q: number; r: number };

export interface HexSnapInput {
  ids: string[];
  positions: { x: number; y: number }[];
}

export interface HexSnapOptions {
  /** Override the auto-computed cell pitch (graph units). */
  pitch?: number;
  /** Search radius (in hex rings) for displacement-reducing swaps. Default 3. */
  searchRadius?: number;
  /** Max refinement passes. Default 30. */
  maxPasses?: number;
  /** Hard time budget for refinement, in ms. Default 1500. */
  timeBudgetMs?: number;
}

const SQRT3 = Math.sqrt(3);

export function applyHexLayout(
  graph: Graph,
  embedding: HexSnapInput,
  options: HexSnapOptions = {},
): number {
  const ids = embedding.ids;
  const positions = embedding.positions;
  const N = ids.length;
  if (N === 0) return options.pitch ?? 1;

  // Pitch heuristic: enough cell area so all N points fit in roughly the same
  // bounding box as the embedding, with a small inflation so even crowded
  // regions usually find their nearest cell empty.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of positions) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const w = Math.max(1e-6, maxX - minX);
  const h = Math.max(1e-6, maxY - minY);
  const area = w * h;
  // Hex cell area = sqrt(3)/2 * pitch^2. Solve for pitch given area / N cells,
  // then inflate slightly (1.15) so collisions are the exception.
  const autoPitch = Math.sqrt((2 * area) / (SQRT3 * N)) * 1.15;
  const pitch = options.pitch ?? Math.max(autoPitch, 1e-6);

  const xyToAxial = (x: number, y: number): Axial => {
    const qf = (x - y / SQRT3) / pitch;
    const rf = y / ((SQRT3 / 2) * pitch);
    return axialRound(qf, rf);
  };
  const axialToXY = (cell: Axial) => ({
    x: pitch * (cell.q + cell.r / 2),
    y: pitch * (SQRT3 / 2) * cell.r,
  });

  // Center the embedding so the hex grid is also centered on origin.
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const desired: { x: number; y: number }[] = positions.map((p) => ({
    x: p.x - cx,
    y: p.y - cy,
  }));

  // Pre-compute each node's ideal axial cell.
  const idealCell: Axial[] = desired.map((p) => xyToAxial(p.x, p.y));

  // Process in order of ideal-cell crowding: nodes whose ideal cell is
  // uncontested go first (they get their preferred cell free); nodes in
  // crowded ideal cells are placed last, when more cells are filled, but with
  // the spiral guaranteeing uniqueness. This keeps the average displacement
  // low without an expensive global assignment.
  const idealKeyCounts = new Map<string, number>();
  for (const c of idealCell) {
    const k = cellKey(c);
    idealKeyCounts.set(k, (idealKeyCounts.get(k) ?? 0) + 1);
  }
  const order = [...Array(N).keys()].sort((a, b) => {
    const ca = idealKeyCounts.get(cellKey(idealCell[a]))!;
    const cb = idealKeyCounts.get(cellKey(idealCell[b]))!;
    if (ca !== cb) return ca - cb;
    // Tiebreak: nodes farther from the center of their ideal cell go later
    // (their preference is weaker, so it's fine to displace them).
    const da = displacement(desired[a], idealCell[a], pitch);
    const db = displacement(desired[b], idealCell[b], pitch);
    return da - db;
  });

  const cellToIndex = new Map<string, number>();
  const indexToCell: Axial[] = new Array(N);
  for (const i of order) {
    const cell = findEmptyNear(idealCell[i], cellToIndex);
    cellToIndex.set(cellKey(cell), i);
    indexToCell[i] = cell;
  }

  // Refinement: minimize total displacement by swapping/moving within a small
  // hex-ring neighborhood. Cheap because each iteration is local.
  const searchRadius = options.searchRadius ?? 3;
  const maxPasses = options.maxPasses ?? 30;
  const timeBudgetMs = options.timeBudgetMs ?? 1500;
  const ringOffsets = ringsUpTo(searchRadius);
  const start = now();

  const dispOf = (i: number, cell: Axial) =>
    displacement(desired[i], cell, pitch);

  for (let pass = 0; pass < maxPasses; pass++) {
    let improvements = 0;
    for (let i = 0; i < N; i++) {
      if (now() - start > timeBudgetMs) break;
      const cell = indexToCell[i];
      const cur = dispOf(i, cell);

      let bestGain = 1e-9;
      let bestTarget: Axial | null = null;
      let bestSwap = -1;

      for (const off of ringOffsets) {
        const cand: Axial = { q: cell.q + off.q, r: cell.r + off.r };
        const ck = cellKey(cand);
        const occupant = cellToIndex.get(ck);
        if (occupant === i) continue;

        if (occupant === undefined) {
          const gain = cur - dispOf(i, cand);
          if (gain > bestGain) {
            bestGain = gain;
            bestTarget = cand;
            bestSwap = -1;
          }
        } else {
          const otherCell = indexToCell[occupant];
          const otherCur = dispOf(occupant, otherCell);
          const newSelf = dispOf(i, cand);
          const newOther = dispOf(occupant, cell);
          const gain = cur + otherCur - newSelf - newOther;
          if (gain > bestGain) {
            bestGain = gain;
            bestTarget = cand;
            bestSwap = occupant;
          }
        }
      }

      if (bestTarget) {
        const targetKey = cellKey(bestTarget);
        const currentKey = cellKey(cell);
        if (bestSwap >= 0) {
          indexToCell[i] = bestTarget;
          indexToCell[bestSwap] = cell;
          cellToIndex.set(targetKey, i);
          cellToIndex.set(currentKey, bestSwap);
        } else {
          indexToCell[i] = bestTarget;
          cellToIndex.delete(currentKey);
          cellToIndex.set(targetKey, i);
        }
        improvements++;
      }
    }
    if (improvements === 0) break;
    if (now() - start > timeBudgetMs) break;
  }

  // Commit absolute positions back onto the graph.
  for (let i = 0; i < N; i++) {
    const xy = axialToXY(indexToCell[i]);
    graph.setNodeAttribute(ids[i], "x", xy.x);
    graph.setNodeAttribute(ids[i], "y", xy.y);
  }

  return pitch;
}

function displacement(
  p: { x: number; y: number },
  cell: Axial,
  pitch: number,
): number {
  const cx = pitch * (cell.q + cell.r / 2);
  const cy = pitch * (SQRT3 / 2) * cell.r;
  const dx = p.x - cx;
  const dy = p.y - cy;
  return Math.hypot(dx, dy);
}

function cellKey(c: Axial): string {
  return `${c.q},${c.r}`;
}

function findEmptyNear(
  desired: Axial,
  cellToIndex: Map<string, number>,
): Axial {
  if (!cellToIndex.has(cellKey(desired))) return desired;
  for (let radius = 1; radius < 10_000; radius++) {
    for (const offset of ringAt(radius)) {
      const candidate: Axial = {
        q: desired.q + offset.q,
        r: desired.r + offset.r,
      };
      if (!cellToIndex.has(cellKey(candidate))) return candidate;
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

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
