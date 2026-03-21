import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { parseCliArgs } from "../../src/lib/cli.js";
import { readMarkdownDocument } from "../../src/lib/documents.js";
import { resolveAssetPath, resolveMarkdownHref } from "../../src/lib/pathing.js";
import { listenOnAvailablePort } from "../../src/lib/ports.js";
import { scanMarkdownTree } from "../../src/lib/tree.js";

import net from "node:net";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directoryPath) =>
      import("node:fs/promises").then(({ rm }) =>
        rm(directoryPath, { recursive: true, force: true })
      )
    )
  );
});

describe("parseCliArgs", () => {
  it("uses the current directory by default", () => {
    const parsedArgs = parseCliArgs(["show"], "/tmp/example-workspace");

    expect(parsedArgs).toEqual({
      command: "show",
      rootPath: "/tmp/example-workspace",
      rootLabel: ".",
      port: 3210,
      openBrowser: true
    });
  });

  it("supports an explicit root path and no-open flag", () => {
    const parsedArgs = parseCliArgs(
      ["show", "./docs", "--port", "4500", "--no-open"],
      "/tmp/example-workspace"
    );

    expect(parsedArgs).toEqual({
      command: "show",
      rootPath: "/tmp/example-workspace/docs",
      rootLabel: "docs",
      port: 4500,
      openBrowser: false
    });
  });
});

describe("listenOnAvailablePort", () => {
  it("increments when the requested port is occupied", async () => {
    const occupiedServer = net.createServer();
    const candidateServer = net.createServer();
    await new Promise<void>((resolve) => occupiedServer.listen(0, "127.0.0.1", resolve));
    const address = occupiedServer.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected a TCP address.");
    }

    const availablePort = await listenOnAvailablePort(candidateServer, address.port);
    expect(availablePort).toBeGreaterThan(address.port);

    await new Promise<void>((resolve, reject) =>
      candidateServer.close((error) => (error ? reject(error) : resolve()))
    );
    await new Promise<void>((resolve, reject) =>
      occupiedServer.close((error) => (error ? reject(error) : resolve()))
    );
  });
});

describe("scanMarkdownTree", () => {
  it("walks markdown files recursively and ignores heavy directories", async () => {
    const rootPath = await createTemporaryWorkspace();

    await mkdir(path.join(rootPath, "guides"), { recursive: true });
    await mkdir(path.join(rootPath, "node_modules", "pkg"), { recursive: true });
    await writeFile(path.join(rootPath, "README.md"), "# Root");
    await writeFile(path.join(rootPath, "guides", "setup.markdown"), "# Setup");
    await writeFile(path.join(rootPath, "notes.txt"), "ignore me");
    await writeFile(path.join(rootPath, "node_modules", "pkg", "ignored.md"), "# Ignore");

    const treePayload = await scanMarkdownTree(rootPath);

    expect(treePayload.rootLabel).toBe(path.basename(rootPath));
    expect(treePayload.tree).toEqual([
      {
        type: "directory",
        name: "guides",
        path: "guides",
        children: [
          {
            type: "file",
            name: "setup.markdown",
            path: "guides/setup.markdown"
          }
        ]
      },
      {
        type: "file",
        name: "README.md",
        path: "README.md"
      }
    ]);
  });

  it("derives a safe display label from an absolute root path", () => {
    const parsedArgs = parseCliArgs(["show", "/tmp/example-workspace/docs"], "/tmp");

    expect(parsedArgs.rootLabel).toBe("docs");
  });
});

describe("readMarkdownDocument", () => {
  it("rejects attempts to read outside the workspace root", async () => {
    const rootPath = await createTemporaryWorkspace();
    await writeFile(path.join(rootPath, "README.md"), "# Root");

    await expect(readMarkdownDocument(rootPath, "../outside.md")).rejects.toThrow(
      /workspace root/
    );
  });
});

describe("relative markdown helpers", () => {
  it("resolves markdown links and images relative to the current document", () => {
    expect(resolveMarkdownHref("guides/setup.md", "../README.md#intro")).toEqual({
      path: "README.md",
      hash: "#intro"
    });

    expect(resolveAssetPath("guides/setup.md", "../assets/diagram.svg")).toBe(
      "assets/diagram.svg"
    );

    expect(resolveMarkdownHref("guides/setup.md", "https://example.com")).toBeNull();
  });
});

async function createTemporaryWorkspace(): Promise<string> {
  const directoryPath = await mkdir(
    path.join(os.tmpdir(), `mdgarden-test-${Date.now()}-${Math.random().toString(16).slice(2)}`),
    { recursive: true }
  );

  temporaryDirectories.push(directoryPath);
  return directoryPath;
}
