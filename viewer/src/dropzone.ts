import { GraphData, RawBuffers, loadGraphFromBuffers } from "./loader";

const REQUIRED = ["nodes.arrow", "edges.arrow", "meta.arrow"] as const;

/**
 * Wire drag-and-drop on the sigma container. Accepts the three preprocessor
 * outputs dropped together (or a folder containing them) and invokes
 * `onGraph` with the parsed graph. Entirely client-side; no URL/CORS needed.
 */
export function attachDropzone(
  target: HTMLElement,
  overlay: HTMLElement,
  onGraph: (data: GraphData, source: string) => void,
  onError: (message: string) => void,
): void {
  let dragDepth = 0;

  const show = () => overlay.classList.add("active");
  const hide = () => {
    dragDepth = 0;
    overlay.classList.remove("active");
  };

  target.addEventListener("dragenter", (ev) => {
    ev.preventDefault();
    dragDepth++;
    show();
  });
  target.addEventListener("dragover", (ev) => {
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = "copy";
  });
  target.addEventListener("dragleave", (ev) => {
    ev.preventDefault();
    dragDepth--;
    if (dragDepth <= 0) hide();
  });
  target.addEventListener("drop", async (ev) => {
    ev.preventDefault();
    hide();
    const files = await collectFiles(ev.dataTransfer);
    try {
      const buffers = await matchRequired(files);
      const data = loadGraphFromBuffers(buffers);
      onGraph(data, "dropped files");
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  });
}

async function collectFiles(dt: DataTransfer | null): Promise<File[]> {
  if (!dt) return [];
  const out: File[] = [];
  const items = Array.from(dt.items ?? []);
  if (items.length && typeof items[0].webkitGetAsEntry === "function") {
    for (const item of items) {
      const entry = item.webkitGetAsEntry();
      if (entry) await walkEntry(entry, out);
    }
    return out;
  }
  return Array.from(dt.files ?? []);
}

async function walkEntry(
  entry: FileSystemEntry,
  out: File[],
): Promise<void> {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry;
    const file: File = await new Promise((res, rej) =>
      fileEntry.file(res, rej),
    );
    out.push(file);
    return;
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const children: FileSystemEntry[] = await new Promise((res, rej) =>
      reader.readEntries(res, rej),
    );
    for (const child of children) await walkEntry(child, out);
  }
}

async function matchRequired(files: File[]): Promise<RawBuffers> {
  const byName = new Map<string, File>();
  for (const f of files) byName.set(f.name, f);

  const missing = REQUIRED.filter((name) => !byName.has(name));
  if (missing.length) {
    throw new Error(
      `Drop all three files together (missing: ${missing.join(", ")})`,
    );
  }

  const [nodesFile, edgesFile, metaFile] = REQUIRED.map(
    (name) => byName.get(name)!,
  );
  const [nodes, edges, meta] = await Promise.all([
    readBytes(nodesFile),
    readBytes(edgesFile),
    readBytes(metaFile),
  ]);
  return { nodes, edges, meta };
}

async function readBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}
