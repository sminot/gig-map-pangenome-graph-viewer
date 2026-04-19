# gig-map Pangenome Graph Viewer

[![Deploy](https://github.com/sminot/gig-map-pangenome-graph-viewer/actions/workflows/pages.yml/badge.svg)](https://github.com/sminot/gig-map-pangenome-graph-viewer/actions/workflows/pages.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python 3.10+](https://img.shields.io/badge/python-3.10%2B-blue.svg)](https://www.python.org/)
[![Node 20+](https://img.shields.io/badge/node-20%2B-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/typescript-strict-3178c6.svg)](https://www.typescriptlang.org/)
[![Static site](https://img.shields.io/badge/hosting-static%20%7C%20no%20server-informational.svg)](#)

A static website that visualizes a [gig-map](https://github.com/FredHutch/gig-map) pangenome as a **bipartite graph** of gene bins and genomes.

**Live demo: <https://sminot.github.io/gig-map-pangenome-graph-viewer/>**

- **Bin nodes** (circles) — groups of co-occurring genes; size = number of genes in the bin.
- **Genome nodes** (unfilled rings) — input genomes; colored by user-supplied metadata (taxonomy / clade / etc.).
- **Edges** — a genome contains that bin (from `prop_genes_detected` in gig-map output).

Layout is computed **in the browser** from graph structure alone. Distances are bipartite-aware — `1 − Jaccard` between bins over their genome neighborhoods (and symmetrically for genomes), `0 / 1` between bins and genomes depending on edge presence — and run through t-SNE to give similarity groups as real 2D clusters instead of a hairball. The continuous embedding then snaps to a hexagonal grid so circles never overlap at any zoom. Hover for details; click and drag a node to watch it follow the cursor while its immediate neighbors are gently tugged along.

![Overview — bins colored by `partition` (core / shell / cloud), genomes by `clade`; five clades form five visibly separated clusters](docs/screenshots/overview.png)

## Features

- **WebGL rendering** via Sigma.js v3 — handles tens of thousands of nodes
- **Bipartite visual language** — filled circles for bins, unfilled rings for genomes, with independent palettes
- **Live color encoding** — pick any attribute column (numeric → sequential palette; categorical → Okabe-Ito colorblind-safe)
- **Bin size scale** — `linear`, `sqrt` (area-proportional), or `log`, with a built-in size legend
- **Hex-grid layout** — every node lives on a unique pointy-top hex cell snapped from an in-browser t-SNE, so circles never overlap at any zoom
- **Drag tug** — click and drag a node; it follows the cursor while its immediate neighbors are gently pulled along, no force-directed restructuring
- **Three ways to load data** — bundled demo, remote URL (`?data=…`), or drag-and-drop the three `.arrow` files onto the canvas
- **Search / highlight** — filter by label, matching nodes pop while the rest fade
- **Lasso select + filter** — `Shift + drag` draws a lasso; keep only the selected nodes or hide them, with a one-click clear. Filter state compresses into the URL hash for shareable subsets.
- **Export** — PNG (canvas composite) or SVG (vector, publication-ready)
- **Shareable links + iframe embed** — `?embed=1` strips the chrome for embedding
- **Static hosting** — no server, no database, deploys to GitHub Pages out of the box

## Repository layout

```
preprocess/    # Python: gig-map output -> nodes.arrow + edges.arrow + meta.arrow (structure only, no coords)
viewer/        # Vite + TypeScript static site (Sigma.js v3 + graphology); computes layout in the browser
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

Output lands in `viewer/dist/`, including the bundled Arrow files. Any static host works (GitHub Pages, Netlify, S3, …). The included workflow at `.github/workflows/pages.yml` builds on every push to `main` and publishes `viewer/dist/` to the `gh-pages` branch (force-orphaned, one commit per deploy). One-time setup: in the repo's **Settings → Pages**, set **Source** to *Deploy from a branch* and pick `gh-pages` / `/ (root)`.

## How to point the viewer at your own gig-map run

Replace the demo preprocessing step:

```bash
python -m preprocess.cli /path/to/your/gig-map/output --out viewer/public/graph
cd viewer && npm run build
```

The preprocessor validates required columns fail-fast and tolerates extra annotation columns (they become available in the viewer's color-mapping dropdowns).

### Dataset title & description

Pass `--title` and `--description` to the preprocessor to stamp dataset identity into the output:

```bash
python -m preprocess.cli /path/to/gig-map/output --out viewer/public/graph \
  --title "HMP-2 gut pangenome, 2025 refresh" \
  --description "2,143 MAGs × 8,412 bins; min prop_genes_detected 0.5"
```

Both strings are embedded in `meta.arrow`'s schema metadata, so the viewer picks them up automatically — no separate file, no extra fetch. URL params `?title=...&description=...` override whatever the data carries, handy for ad-hoc re-labeling of an existing dataset (for example, a curated embed).

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
| `binSize` | `linear`, `sqrt`, or `log` (size scale for bin nodes) |
| `title` | Overrides the dataset title baked into `meta.arrow` |
| `description` | Overrides the dataset description baked into `meta.arrow` |
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

- **Python** — `pandas`, `pyarrow` (graph-only; no numerical stack required)
- **Viewer** — `sigma` v3 (WebGL), `graphology`, `@keckelt/tsne` (in-browser embedding), `apache-arrow`
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
  write.py      # three Apache Arrow IPC files (nodes/edges/meta); no coordinates

viewer/src/
  main.ts       # wiring: load -> install graph -> encoding, search, export, drag-drop
  loader.ts     # Arrow IPC decode (URL fetch + raw-buffer variants)
  graph.ts      # graphology Graph construction + layout pipeline wiring
  embed.ts     # bipartite overlap distance matrix + t-SNE -> 2D positions
  layout.ts    # snap the continuous embedding onto a non-overlapping hex grid
  render.ts     # Sigma.js setup + node programs (filled circle / ring)
  physics.ts    # click-drag that tugs immediate neighbors by a fraction of the drag delta
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

`.github/workflows/pages.yml` runs on push to `main` — it builds `viewer/dist/` and deploys it to the root of the `gh-pages` branch via `JamesIves/github-pages-deploy-action`, preserving the `pr-preview/` subtree so open-PR previews survive a production deploy.

`.github/workflows/preview.yml` runs on every PR open/synchronize/reopen — it builds the viewer with Vite's `--base` set to `/<repo>/pr-preview/pr-<N>/`, deploys to that subfolder on `gh-pages` (with `clean: false` so other previews stay put), and posts (or updates) a sticky comment on the PR with the preview URL. The comment links to:

```
https://<owner>.github.io/<repo>/pr-preview/pr-<N>/
```

`.github/workflows/preview-cleanup.yml` runs on PR closed — it checks out `gh-pages` and deletes the corresponding `pr-preview/pr-<N>/` directory in a single commit.

**One-time repo setup:** in **Settings → Pages**, set **Source** = *Deploy from a branch*, **Branch** = `gh-pages`, **Folder** = `/ (root)`. GitHub Pages then serves the most recent deploy (and any active PR previews) from that branch. The first deploy creates the branch automatically.

To deploy elsewhere, point any static host at the `viewer/dist/` output after `npm run build`.

### Porting the layout back to Python (notes for future work)

Layout currently runs in the browser (`viewer/src/embed.ts` + `viewer/src/layout.ts`) because it keeps the preprocessor dependency-free and lets the viewer re-layout whenever a user drops in a new `.arrow` bundle. If a future dataset is large enough that the browser run starts to hurt, the same pipeline can be precomputed in Python and shipped as `x`/`y` columns on `nodes.arrow`.

Algorithm, Python-side sketch:

1. **Distance matrix (`N × N`).** `N = n_bins + n_genomes`. Fill symmetrically:

   - `bin ↔ bin`: `1 − Jaccard(genomes_containing_a, genomes_containing_b)` (unweighted)
   - `genome ↔ genome`: `1 − Σ n_genes(b) for b in shared_bins / Σ n_genes(b) for b in union_of_bins` — i.e. weighted Jaccard with the shared-bin's gene count as the per-bin weight, so a 100-gene shared bin counts 20× more than a 5-gene shared bin
   - `bin ↔ genome`: `0` if an edge exists, `1` otherwise

   Implementation note: assign every node a `weight` (`n_genes` for bins, `1` for genomes); then the same `Σw / Σw` formula handles both same-kind cases — bin↔bin collapses to ordinary Jaccard because every genome contributes weight 1. For sparse bipartite graphs the loop is `O(N² · avg_deg)` and can be replaced by a sparse matrix product (`(W · M^T) / (1·M^T + M·1^T − W·M^T)` style) if `N` gets large.

2. **t-SNE.** Feed the matrix to `sklearn.manifold.TSNE(metric="precomputed", init="random", perplexity=min(50, sqrt(N)))` to get `(N, 2)` coordinates. Seed via `random_state` if you want reproducibility across deploys.

3. **Hex snap.** Pitch is picked so `cell_area = sqrt(3)/2 · pitch² ≈ bbox_area / N · 1.15`, i.e. `pitch = sqrt(2 · area / (sqrt(3) · N)) · 1.15`. Use pointy-top axial coordinates with the same forward / inverse formulas as `layout.ts`:

   ```
   x = pitch · (q + r/2)
   y = pitch · sqrt(3)/2 · r
   ```

   Snap each node to its nearest axial cell via cube-rounding. Process nodes in order of ideal-cell crowding (uncontested ideal cells first) and spiral outward to the nearest empty cell on collisions.

4. **Local swap refinement.** A few passes (≤30) over the node set: for each node, consider the cells within ring-radius 3; take the move (into an empty cell) or swap (with an occupying node) that most reduces the summed Euclidean distance from each node to its t-SNE position. Stop when a pass produces no improvement.

5. **Ship.** Merge the `(id, x, y)` dataframe back into `graph.nodes` before `write_graph` and restore the `x`/`y` pass-through in `viewer/src/loader.ts` / `viewer/src/graph.ts` (behind a check — fall back to in-browser embed when the columns are missing so both schemas stay supported).

The JS reference in `viewer/src/embed.ts` and `viewer/src/layout.ts` is short (~300 lines combined) and directly maps to numpy/pandas; the refinement is the only non-obvious part (displacement-minimizing local swaps).

### Regenerating screenshots

```bash
npm run build --prefix viewer
npm install --no-save puppeteer           # bundles a Chromium the script drives
node scripts/capture_screenshots.mjs
```

The script spins up a tiny static server over `viewer/dist/`, drives the viewer with the default demo under partition / clade coloring, and writes `docs/screenshots/overview.png`.

### Contributing

Issues and PRs are welcome. Please run `npm run build` (which type-checks) and make sure the preprocessor CLI still succeeds against `demo-data/` before submitting. No formal linting or test suite yet — see the open issues for anything worth picking up.

## License

[MIT](LICENSE)
