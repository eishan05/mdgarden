import { stat } from "node:fs/promises";

import { resolvePathWithinRoot } from "./pathing.js";

export async function resolveAssetFile(rootPath: string, relativePath: string): Promise<string> {
  const resolved = resolvePathWithinRoot(rootPath, relativePath);
  const assetStats = await stat(resolved.absolutePath);

  if (!assetStats.isFile()) {
    throw new Error("Requested asset is not a file.");
  }

  return resolved.absolutePath;
}
