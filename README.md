# gig-map Pangenome Graph Viewer

[![Deploy](https://github.com/sminot/gig-map-pangenome-graph-viewer/actions/workflows/pages.yml/badge.svg)](https://github.com/sminot/gig-map-pangenome-graph-viewer/actions/workflows/pages.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python 3.10+](https://img.shields.io/badge/python-3.10%2B-blue.svg)](https://www.python.org/)
[![Node 20+](https://img.shields.io/badge/node-20%2B-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/typescript-strict-3178c6.svg)](https://www.typescriptlang.org/)
[![Static site](https://img.shields.io/badge/hosting-static%20%7C%20no%20server-informational.svg)](#)

A static website that visualizes a [gig-map](https://github.com/FredHutch/gig-map) pangenome as a **bipartite graph** of gene bins and genomes.

- **Bin nodes** (circles) — groups of co-occurring genes; size = number of genes in the bin.
- **Genome nodes** (squares) — input genomes; colored by user-supplied metadata (taxonomy / clade / etc.).
- **Edges** — a genome contains that bin (from `prop_genes_detected` in gig-map output).

Hover for details; click and drag a node to watch neighbors respond with force-directed physics. Initial positions are precomputed in Python so the graph renders instantly and identically on every device.

## Screenshots

All captures use the bundled synthetic demo (80 genomes × 200 bins, core/shell/cloud partitions).

**Overview — bipartite graph, sequential bin color by gene count.**

![Overview](docs/screenshots/01-overview.png)

**Categorical coloring — bins by `partition` (core / shell / cloud), genomes by `clade`.**

![Categorical coloring](docs/screenshots/02-color-by-partition.png)

**Lasso selection — Shift + drag to select nodes; the action bar offers *Keep only*, *Hide*, or *Cancel*.**

![Lasso selection](docs/screenshots/03-lasso-selection.png)

**Filter applied — sidebar shows `Keeping 167 / 280` and a red *Clear filter* button. The filter state is encoded into the URL hash for shareable links.**

![Filter applied](docs/screenshots/04-filter-applied.png)

**Search — matching labels pop; non-matching nodes fade, incident edges mute.**

![Search highlight](docs/screenshots/05-search.png)

## Features

- **WebGL rendering** via Sigma.js v3 — handles tens of thousands of nodes
- **Bipartite visual language** — distinct shapes and palettes for bins vs. genomes
- **Live color encoding** — pick any attribute column (numeric → sequential palette; categorical → Okabe-Ito colorblind-safe)
- **Drag physics** — click and drag a node; neighbors spring around via a `graphology-layout-forceatlas2` worker
- **Three ways to load data** — bundled demo, remote URL (`?data=…`), or drag-and-drop the three `.arrow` files onto the canvas
- **Search / highlight** — filter by label, matching nodes pop while the rest fade
- **Lasso select + filter** — `Shift + drag` draws a lasso; keep only the selected nodes or hide them, with a one-click clear. Filter state compresses into the URL hash for shareable subsets.
- **Export** — PNG (canvas composite) or SVG (vector, publication-ready)
- **Shareable links + iframe embed** — `?embed=1` strips the chrome for embedding
- **Static hosting** — no server, no database, deploys to GitHub Pages out of the box

## Repository layout

```
preprocess/    # Python: gig-map output -> nodes.arrow + edges.arrow + meta.arrow
viewer/        # Vite + TypeScript static site (Sigma.js v3 + graphology + FA2)
scripts/       # demo-data generator
demo-data/     # generated synthetic gig-map output (gitignored; regenerable)
```

## Quick start

### 1. Install the preprocessor

```bash
pip install ./preprocess
```

### 2. Generate demo gig-map output and preprocess it

```bash
python scripts/generate_demo_data.py --out demo-data
python -m preprocess.cli demo-data --out viewer/public/graph
```

The preprocessor expects a gig-map output directory with the usual layout:

```
<gig-map-output>/
└── bin_pangenome/
    ├── genome_content.long.csv
    └── gene_bins.csv
```

It writes three Apache Arrow IPC files into the output directory:

- `nodes.arrow` — id, kind, label, x, y, and every attribute column for both bins and genomes
- `edges.arrow` — source, target, weight (`prop_genes_detected`)
- `meta.arrow` — attribute descriptors that drive the viewer's color-mapping UI

### 3. Run the viewer

```bash
cd viewer
npm install
npm run dev
```

Open the printed localhost URL.

### 4. Build for static hosting

```bash
npm run build
```

Output lands in `viewer/dist/`, including the bundled Arrow files. Any static host works (GitHub Pages, Netlify, S3, …). The included workflow at `.github/workflows/pages.yml` builds and deploys to GitHub Pages on push to `main`.

## How to point the viewer at your own gig-map run

Replace the demo preprocessing step:

```bash
python -m preprocess.cli /path/to/your/gig-map/output --out viewer/public/graph
cd viewer && npm run build
```

The preprocessor validates required columns fail-fast and tolerates extra annotation columns (they become available in the viewer's color-mapping dropdowns).

## Loading data from any URL (shareable links + embeds)

The viewer can load preprocessed Arrow files from any publicly reachable URL, so one deployed site can view many different pangenomes.

Host the output of `gig-map-preprocess` (the three `.arrow` files) anywhere — S3, GitHub Releases, your own server — then point the viewer at the **base URL of the folder** containing them.

**Query parameters:**

| Param | Meaning |
|---|---|
| `data` | Base URL of a folder with `nodes.arrow`, `edges.arrow`, `meta.arrow` |
| `binColor` | Bin attribute column to use for color |
| `genomeColor` | Genome attribute column to use for color |
| `binPalette` | `viridis`, `plasma`, or `category` |
| `embed` | `1` to hide the header and side panel (for iframe embedding) |

A filter from a lasso-select is appended to the URL as `#f=<lz-compressed>` so the exact subset of visible nodes is part of any shareable link.

**Shareable link example:**

```
https://your-site.example/?data=https://data.example.com/run-42&binColor=partition&genomeColor=genus
```

**Embeddable iframe example:**

```html
<iframe
  src="https://your-site.example/?data=https://data.example.com/run-42&embed=1"
  style="width:100%;height:600px;border:0"
  loading="lazy"></iframe>
```

The viewer's **Share & embed** panel exposes the current URL and a ready-made iframe snippet; any change to the data URL or color mappings is reflected in the browser's address bar so you can copy a link that reproduces the exact view.

**CORS caveat:** the remote host must serve the `.arrow` files with `Access-Control-Allow-Origin` set for the viewer's origin. Hosting on the same origin as the viewer, on S3 with CORS enabled, or on GitHub Releases / Pages all work.

## Loading local files without hosting them

If you'd rather not host the Arrow files anywhere, drop them directly onto the viewer's canvas. Drop `nodes.arrow`, `edges.arrow`, and `meta.arrow` together (or drop the containing folder) — parsing and rendering happen entirely in the browser. Nothing leaves your machine, and no CORS configuration is needed.

## Tech stack

- **Python** — `pandas`, `python-igraph` (layout), `pyarrow`
- **Viewer** — `sigma` v3 (WebGL), `graphology`, `graphology-layout-forceatlas2`, `apache-arrow`
- **Build** — Vite + TypeScript (strict mode)

## Development guide

### Prerequisites

- **Python 3.10+** with `pip`
- **Node 20+** with `npm`
- Git

### One-time setup

```bash
# Python preprocessor (editable install)
pip install -e ./preprocess

# Viewer dependencies
cd viewer && npm install
```

### Typical dev loop

Two terminals:

```bash
# Terminal 1 — regenerate graph data whenever gig-map inputs change
python scripts/generate_demo_data.py --out demo-data      # (first time only)
python -m preprocess.cli demo-data --out viewer/public/graph

# Terminal 2 — Vite dev server with hot reload
cd viewer && npm run dev
```

Vite watches `viewer/src/**` and `viewer/public/**`. Re-running the preprocessor rewrites `viewer/public/graph/*.arrow`, which triggers a browser reload.

### Commands

| Command | Purpose |
|---|---|
| `python -m preprocess.cli <dir> --out <out>` | Preprocess a gig-map output directory |
| `python scripts/generate_demo_data.py --out demo-data` | Generate synthetic gig-map-style data |
| `npm run dev` (in `viewer/`) | Start Vite dev server with HMR |
| `npm run build` (in `viewer/`) | TypeScript strict check + production bundle |
| `npm run preview` (in `viewer/`) | Serve the built bundle locally |

### Code layout

```
preprocess/preprocess/
  cli.py        # argparse entrypoint
  read.py       # fixed relative-path CSV reader; fails fast on missing files
  build.py      # bipartite bin<->genome graph + attribute derivation
  layout.py     # python-igraph DrL/FR layout, normalized to [-1, 1]
  write.py      # three Apache Arrow IPC files (nodes/edges/meta)

viewer/src/
  main.ts       # wiring: load -> install graph -> encoding, search, export, drag-drop
  loader.ts     # Arrow IPC decode (URL fetch + raw-buffer variants)
  graph.ts      # graphology Graph construction from parsed data
  render.ts     # Sigma.js setup + custom node programs (circle / square)
  physics.ts    # FA2 worker + click-drag neighbor-spring behavior
  encoding.ts   # attribute -> color/size mapping; emits legend metadata
  palettes.ts   # viridis, plasma, Okabe-Ito categorical
  search.ts     # label-substring search via Sigma node/edge reducers
  dropzone.ts   # drag-drop of nodes/edges/meta .arrow (or a folder)
  export.ts     # PNG (canvas composite) and SVG (synthesized from graph) export
  lasso.ts      # shift+drag lasso overlay + point-in-polygon
  filter.ts     # apply/clear keep|hide filter via node `hidden` attribute
  ui.ts        # tooltip, legend, attribute-selector population
```

### Deployment

`.github/workflows/pages.yml` runs on push to `main`:

1. Installs the Python preprocessor
2. Regenerates `demo-data/` via the scripted generator
3. Runs `python -m preprocess.cli demo-data --out viewer/public/graph`
4. Builds the viewer with `npm ci && npm run build`
5. Publishes `viewer/dist/` to GitHub Pages

To deploy elsewhere, point any static host at the `viewer/dist/` output after `npm run build`.

### Regenerating screenshots

```bash
npm run build --prefix viewer
npm install --no-save puppeteer           # bundles a Chromium the script drives
node scripts/capture_screenshots.mjs
```

Outputs land in `docs/screenshots/`. The script spins up a tiny static server over `viewer/dist/`, drives the viewer with the default demo, and captures the overview, categorical coloring, lasso selection, applied filter, and search states.

### Contributing

Issues and PRs are welcome. Please run `npm run build` (which type-checks) and make sure the preprocessor CLI still succeeds against `demo-data/` before submitting. No formal linting or test suite yet — see the open issues for anything worth picking up.

## License

[MIT](LICENSE)
