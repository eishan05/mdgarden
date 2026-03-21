import { readdir } from "node:fs/promises";
import path from "node:path";

import {
  IGNORED_DIRECTORIES,
  isMarkdownPath,
  toPosixPath
} from "./pathing.js";

export type TreeNode =
  | {
      type: "directory";
      name: string;
      path: string;
      children: TreeNode[];
    }
  | {
      type: "file";
      name: string;
      path: string;
    };

export interface TreePayload {
  rootName: string;
  rootLabel: string;
  tree: TreeNode[];
}

export async function scanMarkdownTree(rootPath: string, rootLabel: string = path.basename(rootPath)): Promise<TreePayload> {
  return {
    rootName: path.basename(rootPath),
    rootLabel,
    tree: await scanDirectory(rootPath, "")
  };
}

async function scanDirectory(directoryPath: string, relativePath: string): Promise<TreeNode[]> {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const directories: TreeNode[] = [];
  const files: TreeNode[] = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryRelativePath = relativePath
      ? path.join(relativePath, entry.name)
      : entry.name;
    const normalizedPath = toPosixPath(entryRelativePath);
    const absoluteEntryPath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) {
        continue;
      }

      const children = await scanDirectory(absoluteEntryPath, entryRelativePath);

      if (children.length > 0) {
        directories.push({
          type: "directory",
          name: entry.name,
          path: normalizedPath,
          children
        });
      }

      continue;
    }

    if (!entry.isFile() || !isMarkdownPath(entry.name)) {
      continue;
    }

    files.push({
      type: "file",
      name: entry.name,
      path: normalizedPath
    });
  }

  return [...directories, ...files];
}
