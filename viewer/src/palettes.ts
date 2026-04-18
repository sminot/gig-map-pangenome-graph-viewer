// Minimal color utilities (sequential + categorical) so we don't pull in d3-scale.

export type Palette = "viridis" | "plasma" | "category";

// Sampled from matplotlib viridis / plasma at 10 stops.
const VIRIDIS = [
  "#440154", "#482878", "#3e4989", "#31688e", "#26828e",
  "#1f9e89", "#35b779", "#6ece58", "#b5de2b", "#fde725",
];
const PLASMA = [
  "#0d0887", "#41049d", "#6a00a8", "#8f0da4", "#b12a90",
  "#cc4778", "#e16462", "#f1844b", "#fca636", "#fcce25",
];

// Okabe-Ito categorical — colorblind-safe.
const CATEGORY = [
  "#56b4e9", "#e69f00", "#009e73", "#f0e442", "#0072b2",
  "#d55e00", "#cc79a7", "#999999",
];

export function sampleSequential(palette: Palette, t: number): string {
  const stops = palette === "plasma" ? PLASMA : VIRIDIS;
  const clamped = Math.max(0, Math.min(1, t));
  const pos = clamped * (stops.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(stops.length - 1, lo + 1);
  const frac = pos - lo;
  return mix(stops[lo], stops[hi], frac);
}

export function categoricalColor(key: string, domain: string[]): string {
  const idx = domain.indexOf(key);
  if (idx < 0) return CATEGORY[CATEGORY.length - 1];
  return CATEGORY[idx % CATEGORY.length];
}

function mix(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const r = Math.round(ca.r + (cb.r - ca.r) * t);
  const g = Math.round(ca.g + (cb.g - ca.g) * t);
  const bl = Math.round(ca.b + (cb.b - ca.b) * t);
  return `rgb(${r},${g},${bl})`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}
