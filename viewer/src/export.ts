import type Sigma from "sigma";
import type Graph from "graphology";

/**
 * Composite Sigma's WebGL / 2D canvases into a single PNG and download it.
 * Runs at the renderer's current pixel size (respects devicePixelRatio).
 */
export function exportPNG(sigma: Sigma, filename = "pangenome.png"): void {
  const canvases = sigma.getCanvases();
  const anyCanvas = Object.values(canvases)[0] as HTMLCanvasElement | undefined;
  if (!anyCanvas) return;

  const width = anyCanvas.width;
  const height = anyCanvas.height;
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const ctx = out.getContext("2d");
  if (!ctx) return;

  ctx.fillStyle = "#010409";
  ctx.fillRect(0, 0, width, height);

  for (const layer of ["edges", "nodes", "labels", "hovers", "edgeLabels"]) {
    const c = (canvases as Record<string, HTMLCanvasElement | undefined>)[layer];
    if (c) ctx.drawImage(c, 0, 0, width, height);
  }

  out.toBlob((blob) => {
    if (!blob) return;
    triggerDownload(blob, filename);
  }, "image/png");
}

/**
 * Synthesize an SVG from the current graphology graph + Sigma camera so the
 * export matches what's on screen. Pure vectors — ideal for figures.
 */
export function exportSVG(
  sigma: Sigma,
  graph: Graph,
  filename = "pangenome.svg",
): void {
  const canvases = sigma.getCanvases();
  const ref = Object.values(canvases)[0] as HTMLCanvasElement | undefined;
  if (!ref) return;
  const width = ref.clientWidth;
  const height = ref.clientHeight;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
  );
  parts.push(`<rect width="100%" height="100%" fill="#010409"/>`);

  // Node sizes live in graph coordinates now; scale them into viewport pixels
  // so the exported SVG matches the on-screen rendering at the current zoom.
  const sizeRatio = sigma.getGraphToViewportRatio();

  parts.push(`<g stroke-linecap="round">`);
  graph.forEachEdge((_e, attrs, source, target) => {
    const a = sigma.graphToViewport({
      x: graph.getNodeAttribute(source, "x"),
      y: graph.getNodeAttribute(source, "y"),
    });
    const b = sigma.graphToViewport({
      x: graph.getNodeAttribute(target, "x"),
      y: graph.getNodeAttribute(target, "y"),
    });
    const color = attrs.color ?? "rgba(120,140,180,0.25)";
    const w = Math.max(0.25, Number(attrs.size ?? 0.5) * sizeRatio);
    parts.push(
      `<line x1="${a.x.toFixed(2)}" y1="${a.y.toFixed(2)}" x2="${b.x.toFixed(2)}" y2="${b.y.toFixed(2)}" stroke="${escapeAttr(color)}" stroke-width="${w.toFixed(2)}"/>`,
    );
  });
  parts.push(`</g>`);

  parts.push(`<g>`);
  graph.forEachNode((_n, attrs) => {
    const p = sigma.graphToViewport({ x: attrs.x, y: attrs.y });
    const color = attrs.color ?? "#58a6ff";
    const radius = Math.max(0.5, Number(attrs.size ?? 4) * sizeRatio);
    if (attrs.type === "ring") {
      parts.push(
        `<circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="${radius.toFixed(2)}" fill="none" stroke="${escapeAttr(color)}" stroke-width="2"/>`,
      );
    } else {
      parts.push(
        `<circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="${radius.toFixed(2)}" fill="${escapeAttr(color)}"/>`,
      );
    }
  });
  parts.push(`</g>`);

  parts.push(`</svg>`);
  const blob = new Blob([parts.join("")], { type: "image/svg+xml" });
  triggerDownload(blob, filename);
}

function escapeAttr(v: unknown): string {
  return String(v).replace(/"/g, "&quot;");
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
