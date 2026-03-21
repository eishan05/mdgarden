import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { isMarkdownPath, resolvePathWithinRoot } from "./pathing.js";

export interface MarkdownDocumentPayload {
  path: string;
  name: string;
  content: string;
  updatedAt: string;
}

export async function readMarkdownDocument(
  rootPath: string,
  relativePath: string
): Promise<MarkdownDocumentPayload> {
  const resolved = resolvePathWithinRoot(rootPath, relativePath);

  if (!isMarkdownPath(resolved.relativePath)) {
    throw new Error("Only markdown files can be opened.");
  }

  const documentStats = await stat(resolved.absolutePath);

  if (!documentStats.isFile()) {
    throw new Error("Requested document is not a file.");
  }

  return {
    path: resolved.relativePath,
    name: path.basename(resolved.relativePath),
    content: await readFile(resolved.absolutePath, "utf8"),
    updatedAt: documentStats.mtime.toISOString()
  };
}
