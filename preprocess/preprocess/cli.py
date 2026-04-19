"""CLI entrypoint for the preprocessor."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .build import build_graph
from .read import read_gigmap
from .write import write_graph


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="gig-map-preprocess",
        description=(
            "Preprocess a gig-map Nextflow output directory into a binary graph "
            "(nodes.arrow, edges.arrow, meta.arrow) for the pangenome viewer."
        ),
    )
    parser.add_argument(
        "input_dir",
        type=Path,
        help="Path to a gig-map output directory (contains bin_pangenome/...)",
    )
    parser.add_argument(
        "--out",
        type=Path,
        required=True,
        help="Output directory for nodes.arrow, edges.arrow, meta.arrow.",
    )
    parser.add_argument(
        "--min-prop-detected",
        type=float,
        default=0.5,
        help="Minimum prop_genes_detected for an edge to be kept (default: 0.5).",
    )
    parser.add_argument(
        "--title",
        default=None,
        help="Dataset title shown in the viewer header (optional).",
    )
    parser.add_argument(
        "--description",
        default=None,
        help="One-line dataset description shown under the title (optional).",
    )
    args = parser.parse_args(argv)

    tables = read_gigmap(args.input_dir)
    graph = build_graph(tables, min_prop_detected=args.min_prop_detected)
    write_graph(
        graph,
        args.out,
        title=args.title,
        description=args.description,
    )

    print(
        f"Wrote {len(graph.nodes)} nodes and {len(graph.edges)} edges to {args.out}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
