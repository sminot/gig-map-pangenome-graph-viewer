import { tableFromIPC, Table } from "apache-arrow";

export interface NodeRow {
  id: string;
  kind: "bin" | "genome";
  label: string;
  x: number;
  y: number;
  attrs: Record<string, unknown>;
}

export interface EdgeRow {
  source: string;
  target: string;
  weight: number;
}

export interface MetaRow {
  column: string;
  kind: "bin" | "genome";
  category: "numeric" | "categorical";
}

export interface DatasetInfo {
  title: string | null;
  description: string | null;
}

export interface GraphData {
  nodes: NodeRow[];
  edges: EdgeRow[];
  meta: MetaRow[];
  info: DatasetInfo;
}

const STRUCTURAL_NODE_COLS = new Set(["id", "kind", "label", "x", "y"]);

export async function loadGraph(baseUrl: string): Promise<GraphData> {
  const [nodesTable, edgesTable, metaTable] = await Promise.all([
    fetchTable(`${baseUrl}/nodes.arrow`),
    fetchTable(`${baseUrl}/edges.arrow`),
    fetchTable(`${baseUrl}/meta.arrow`),
  ]);

  return decodeTables(nodesTable, edgesTable, metaTable);
}

export interface RawBuffers {
  nodes: Uint8Array;
  edges: Uint8Array;
  meta: Uint8Array;
}

export function loadGraphFromBuffers(buffers: RawBuffers): GraphData {
  return decodeTables(
    tableFromIPC(buffers.nodes),
    tableFromIPC(buffers.edges),
    tableFromIPC(buffers.meta),
  );
}

function decodeTables(
  nodesTable: Table,
  edgesTable: Table,
  metaTable: Table,
): GraphData {
  return {
    nodes: tableToNodes(nodesTable),
    edges: tableToEdges(edgesTable),
    meta: tableToMeta(metaTable),
    info: readSchemaInfo(metaTable),
  };
}

function readSchemaInfo(table: Table): DatasetInfo {
  const meta = table.schema.metadata;
  const get = (key: string) => {
    const raw = meta?.get(key);
    if (typeof raw !== "string") return null;
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  };
  return { title: get("title"), description: get("description") };
}

async function fetchTable(url: string): Promise<Table> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }
  const buffer = new Uint8Array(await res.arrayBuffer());
  return tableFromIPC(buffer);
}

function tableToNodes(table: Table): NodeRow[] {
  const cols = table.schema.fields.map((f) => f.name);
  const attrCols = cols.filter((c) => !STRUCTURAL_NODE_COLS.has(c));
  const rows: NodeRow[] = [];
  for (const raw of table.toArray()) {
    const record = raw as unknown as Record<string, unknown>;
    const attrs: Record<string, unknown> = {};
    for (const c of attrCols) attrs[c] = record[c];
    rows.push({
      id: String(record.id),
      kind: record.kind === "genome" ? "genome" : "bin",
      label: String(record.label ?? record.id),
      x: Number(record.x ?? 0),
      y: Number(record.y ?? 0),
      attrs,
    });
  }
  return rows;
}

function tableToEdges(table: Table): EdgeRow[] {
  const rows: EdgeRow[] = [];
  for (const raw of table.toArray()) {
    const r = raw as unknown as Record<string, unknown>;
    rows.push({
      source: String(r.source),
      target: String(r.target),
      weight: Number(r.weight ?? 1),
    });
  }
  return rows;
}

function tableToMeta(table: Table): MetaRow[] {
  const rows: MetaRow[] = [];
  for (const raw of table.toArray()) {
    const r = raw as unknown as Record<string, unknown>;
    rows.push({
      column: String(r.column),
      kind: r.kind === "genome" ? "genome" : "bin",
      category: r.category === "numeric" ? "numeric" : "categorical",
    });
  }
  return rows;
}
