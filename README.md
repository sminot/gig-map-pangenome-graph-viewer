# gig-map Pangenome Graph Viewer

A static website that visualizes a [gig-map](https://github.com/FredHutch/gig-map) pangenome as a **bipartite graph** of gene bins and genomes.

- **Bin nodes** (circles) — groups of co-occurring genes; size = number of genes in the bin.
- **Genome nodes** (squares) — input genomes; colored by user-supplied metadata (taxonomy / clade / etc.).
- **Edges** — a genome contains that bin (from `prop_genes_detected` in gig-map output).

Hover for details; click and drag a node to watch neighbors respond with force-directed physics. Initial positions are precomputed in Python so the graph renders instantly and identically on every device.

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

## Tech stack

- **Python** — `pandas`, `python-igraph` (layout), `pyarrow`
- **Viewer** — `sigma` v3 (WebGL), `graphology`, `graphology-layout-forceatlas2`, `apache-arrow`
- **Build** — Vite + TypeScript
