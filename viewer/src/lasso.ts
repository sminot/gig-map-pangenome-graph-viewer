import type Sigma from "sigma";

type Pt = { x: number; y: number };

/**
 * Shift-drag on empty canvas area -> draw a lasso polygon. On release,
 * invokes `onSelect` with graph-space polygon vertices; caller runs its
 * own point-in-polygon against node positions.
 *
 * Plain mousedown is left alone so Sigma's camera pan + node drag still work.
 */
export function attachLasso(
  sigma: Sigma,
  container: HTMLElement,
  onSelect: (polygonInGraphCoords: Pt[]) => void,
): () => void {
  const canvas = document.createElement("canvas");
  canvas.className = "lasso-canvas";
  canvas.style.position = "absolute";
  canvas.style.inset = "0";
  canvas.style.pointerEvents = "none";
  canvas.style.zIndex = "40";
  container.appendChild(canvas);

  const ctx = canvas.getContext("2d");

  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = container.clientWidth * dpr;
    canvas.height = container.clientHeight * dpr;
    canvas.style.width = `${container.clientWidth}px`;
    canvas.style.height = `${container.clientHeight}px`;
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  const resizeObs = new ResizeObserver(resize);
  resizeObs.observe(container);

  let points: Pt[] = [];
  let drawing = false;

  const draw = () => {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (points.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.closePath();
    ctx.fillStyle = "rgba(88, 166, 255, 0.12)";
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(88, 166, 255, 0.9)";
    ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  };

  const clear = () => {
    points = [];
    drawing = false;
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  const toLocal = (ev: MouseEvent): Pt => {
    const rect = container.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  };

  const camera = sigma.getCamera();
  let cameraWasEnabled = true;

  const onMouseDown = (ev: MouseEvent) => {
    if (!ev.shiftKey) return;
    if (ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    cameraWasEnabled = true;
    camera.disable();
    document.body.style.userSelect = "none";
    drawing = true;
    points = [toLocal(ev)];
    draw();
  };

  const onMouseMove = (ev: MouseEvent) => {
    if (!drawing) return;
    const p = toLocal(ev);
    const last = points[points.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 3) {
      points.push(p);
      draw();
    }
    ev.preventDefault();
    ev.stopPropagation();
  };

  const onMouseUp = (ev: MouseEvent) => {
    if (!drawing) return;
    drawing = false;
    document.body.style.userSelect = "";
    if (cameraWasEnabled) camera.enable();
    if (points.length >= 3) {
      const polygon = points.map((p) => sigma.viewportToGraph(p));
      onSelect(polygon);
    }
    clear();
    ev.preventDefault();
    ev.stopPropagation();
  };

  // Capture phase on the container so we beat Sigma's camera pan handler.
  container.addEventListener("mousedown", onMouseDown, true);
  window.addEventListener("mousemove", onMouseMove, true);
  window.addEventListener("mouseup", onMouseUp, true);

  return () => {
    container.removeEventListener("mousedown", onMouseDown, true);
    window.removeEventListener("mousemove", onMouseMove, true);
    window.removeEventListener("mouseup", onMouseUp, true);
    resizeObs.disconnect();
    canvas.remove();
  };
}

/** Ray-casting point-in-polygon. `pt` and `polygon` must share a coordinate space. */
export function pointInPolygon(pt: Pt, polygon: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect =
      yi > pt.y !== yj > pt.y &&
      pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
