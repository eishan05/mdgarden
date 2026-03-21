import path from "node:path";

export const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"]);
export const IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next"
]);

export function isMarkdownPath(filePath: string): boolean {
  return MARKDOWN_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join(path.posix.sep);
}

export function normalizeRelativePath(inputPath: string): string {
  const normalized = path.posix.normalize(inputPath.replaceAll("\\", "/"));

  if (
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.startsWith("/") ||
    path.posix.isAbsolute(normalized)
  ) {
    throw new Error("Path escapes the workspace root.");
  }

  return normalized === "." ? "" : normalized;
}

export function resolvePathWithinRoot(rootPath: string, relativePath: string): {
  absolutePath: string;
  relativePath: string;
} {
  const normalizedRelativePath = normalizeRelativePath(relativePath);
  const absolutePath = path.resolve(rootPath, normalizedRelativePath);
  const relativeToRoot = path.relative(rootPath, absolutePath);

  if (
    relativeToRoot === ".." ||
    relativeToRoot.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToRoot)
  ) {
    throw new Error("Path escapes the workspace root.");
  }

  return {
    absolutePath,
    relativePath: toPosixPath(relativeToRoot)
  };
}

export function toRelativeWorkspacePath(rootPath: string, absolutePath: string): string {
  return toPosixPath(path.relative(rootPath, absolutePath));
}

export function isIgnoredPath(rootPath: string, absolutePath: string): boolean {
  const relativePath = path.relative(rootPath, absolutePath);

  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return false;
  }

  return relativePath
    .split(path.sep)
    .some((segment) => IGNORED_DIRECTORIES.has(segment));
}

function isExternalReference(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(value) || value.startsWith("//");
}

export function resolveMarkdownHref(
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

  const resolvedPath = path.posix.normalize(
    path.posix.join(path.posix.dirname(currentDocumentPath), rawPath.replaceAll("\\", "/"))
  );

  if (
    resolvedPath === ".." ||
    resolvedPath.startsWith("../") ||
    resolvedPath.startsWith("/")
  ) {
    return null;
  }

  if (!isMarkdownPath(resolvedPath)) {
    return null;
  }

  return {
    path: resolvedPath,
    hash
  };
}

export function resolveAssetPath(currentDocumentPath: string, source: string): string | null {
  if (!source || isExternalReference(source) || source.startsWith("data:")) {
    return null;
  }

  const [rawPath] = source.split("#", 1);

  if (!rawPath) {
    return null;
  }

  const resolvedPath = rawPath.startsWith("/")
    ? normalizeRelativePath(rawPath.slice(1))
    : path.posix.normalize(
        path.posix.join(path.posix.dirname(currentDocumentPath), rawPath.replaceAll("\\", "/"))
      );

  if (
    resolvedPath === ".." ||
    resolvedPath.startsWith("../") ||
    resolvedPath.startsWith("/")
  ) {
    return null;
  }

  return resolvedPath;
}
