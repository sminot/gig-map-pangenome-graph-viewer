"""Serialize the bipartite graph + layout to Apache Arrow IPC files."""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import pyarrow as pa
import pyarrow.ipc as ipc

from .build import Graph

NODES_FILE = "nodes.arrow"
EDGES_FILE = "edges.arrow"
META_FILE = "meta.arrow"


def write_graph(graph: Graph, layout: pd.DataFrame, out_dir: Path) -> None:
    """Write nodes.arrow, edges.arrow, and meta.arrow into `out_dir`.

    Three files keep the wire format simple (one IPC stream per schema) and
    let the browser fetch them in parallel.
    """
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    nodes = graph.nodes.merge(layout, on="id", how="left")
    nodes["x"] = nodes["x"].fillna(0).astype("float32")
    nodes["y"] = nodes["y"].fillna(0).astype("float32")

    _write_table(pa.Table.from_pandas(nodes, preserve_index=False), out_dir / NODES_FILE)
    _write_table(pa.Table.from_pandas(graph.edges, preserve_index=False), out_dir / EDGES_FILE)
    _write_table(_build_meta_table(graph, nodes), out_dir / META_FILE)


def _write_table(table: pa.Table, path: Path) -> None:
    with pa.OSFile(str(path), "wb") as sink:
        with ipc.new_file(sink, table.schema) as writer:
            writer.write_table(table)


def _build_meta_table(graph: Graph, nodes: pd.DataFrame) -> pa.Table:
    """Describe attribute columns so the viewer can drive its encoding UI.

    Each row: column name, owning kind ("bin" or "genome"), and the inferred
    category: "numeric" vs "categorical".
    """
    rows: list[dict[str, str]] = []

    for col in graph.bin_attr_cols:
        rows.append(
            {
                "column": col,
                "kind": "bin",
                "category": _category(nodes[nodes["kind"] == "bin"][col]),
            }
        )
    for col in graph.genome_attr_cols:
        rows.append(
            {
                "column": col,
                "kind": "genome",
                "category": _category(nodes[nodes["kind"] == "genome"][col]),
            }
        )

    if not rows:
        return pa.table(
            {
                "column": pa.array([], type=pa.string()),
                "kind": pa.array([], type=pa.string()),
                "category": pa.array([], type=pa.string()),
            }
        )
    return pa.Table.from_pydict(
        {
            "column": [r["column"] for r in rows],
            "kind": [r["kind"] for r in rows],
            "category": [r["category"] for r in rows],
        }
    )


def _category(series: pd.Series) -> str:
    return "numeric" if pd.api.types.is_numeric_dtype(series) else "categorical"
