import type { PaneState } from "./types";

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function createPane(path: string | null = null): PaneState {
  return {
    id: crypto.randomUUID(),
    path,
    width: 1
  };
}

export function rebalancePanes(panes: PaneState[]): PaneState[] {
  if (panes.length === 0) {
    return [createPane()];
  }

  const width = 1 / panes.length;
  return panes.map((pane) => ({
    ...pane,
    width
  }));
}

export function normalizePaneWidths(panes: PaneState[]): PaneState[] {
  const totalWidth = panes.reduce((total, pane) => total + pane.width, 0);

  if (totalWidth <= 0) {
    return rebalancePanes(panes);
  }

  return panes.map((pane) => ({
    ...pane,
    width: pane.width / totalWidth
  }));
}

function isExternalReference(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(value) || value.startsWith("//");
}

export function resolveDocumentHref(
  currentDocumentPath: string,
  href: string
): { path: string; hash: string } | null {
  if (!href || isExternalReference(href)) {
    return null;
  }

  const [rawPath, rawHash] = href.split("#", 2);
  const hash = rawHash ? `#${rawHash}` : "";

  if (!rawPath) {
    return { path: currentDocumentPath, hash };
  }

  const currentDirectory = currentDocumentPath.includes("/")
    ? currentDocumentPath.slice(0, currentDocumentPath.lastIndexOf("/"))
    : "";
  const basePath = currentDirectory ? `${currentDirectory}/` : "";
  const resolvedPath = normalizeRelativeUrlPath(`${basePath}${rawPath.replaceAll("\\", "/")}`);

  if (!resolvedPath || !/\.(md|markdown)$/i.test(resolvedPath)) {
    return null;
  }

  return {
    path: resolvedPath,
    hash
  };
}

export function resolveAssetSource(currentDocumentPath: string, source: string): string | null {
  if (!source || isExternalReference(source) || source.startsWith("data:")) {
    return null;
  }

  const [rawPath] = source.split("#", 1);

  if (!rawPath) {
    return null;
  }

  const resolvedPath = rawPath.startsWith("/")
    ? normalizeRelativeUrlPath(rawPath.slice(1))
    : normalizeRelativeUrlPath(joinToCurrentDocument(currentDocumentPath, rawPath));

  return resolvedPath;
}

export function getDocumentTitle(documentPath: string | null): string {
  if (!documentPath) {
    return "Untitled pane";
  }

  const segments = documentPath.split("/");
  return segments[segments.length - 1] ?? documentPath;
}

export function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

export function buildAssetUrl(relativePath: string): string {
  return `/api/asset?path=${encodeURIComponent(relativePath)}`;
}

function joinToCurrentDocument(currentDocumentPath: string, relativePath: string): string {
  const currentDirectory = currentDocumentPath.includes("/")
    ? currentDocumentPath.slice(0, currentDocumentPath.lastIndexOf("/"))
    : "";

  return currentDirectory ? `${currentDirectory}/${relativePath}` : relativePath;
}

function normalizeRelativeUrlPath(inputPath: string): string | null {
  const rawSegments = inputPath.split("/");
  const normalizedSegments: string[] = [];

  for (const segment of rawSegments) {
    if (!segment || segment === ".") {
      continue;
    }

    if (segment === "..") {
      if (normalizedSegments.length === 0) {
        return null;
      }

      normalizedSegments.pop();
      continue;
    }

    normalizedSegments.push(segment);
  }

  return normalizedSegments.length > 0 ? normalizedSegments.join("/") : null;
}
