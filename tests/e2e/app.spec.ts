import { test, expect } from "@playwright/test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const fixturePath = path.resolve("tests/fixtures/docs");
const requestedPort = 4310;

test("starts with folders collapsed and prompts the user to open a markdown file", async ({
  page
}) => {
  const workspacePath = await mkdtemp(path.join(os.tmpdir(), "mdgarden-e2e-"));
  await cp(fixturePath, workspacePath, { recursive: true });

  const serverProcess = spawn(
    "node",
    ["dist/cli.js", "show", workspacePath, "--port", String(requestedPort), "--no-open"],
    {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"]
    }
  );

  try {
    const baseUrl = await waitForServerUrl(serverProcess);
    await waitForServer(`${baseUrl}/api/tree`);

    await page.goto(baseUrl);

    await expect(page.locator(".tree-directory[open]")).toHaveCount(0);
    await expect(page.locator(".empty-pane")).toContainText("Open a markdown file");
    await expect(page.locator(".empty-pane")).toContainText(
      "Expand the folders in the sidebar to get started."
    );

    const nestedDocument = page.getByRole("button", { name: "Open guides/setup.md" });
    await expect(nestedDocument).toBeHidden();

    await page.locator(".tree-directory summary").filter({ hasText: "guides" }).click();

    await expect(nestedDocument).toBeVisible();
  } finally {
    serverProcess.kill("SIGTERM");
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test("opens markdown files side by side and refreshes on change", async ({ page }) => {
  const workspacePath = await mkdtemp(path.join(os.tmpdir(), "mdgarden-e2e-"));
  await cp(fixturePath, workspacePath, { recursive: true });

  const serverProcess = spawn(
    "node",
    ["dist/cli.js", "show", workspacePath, "--port", String(requestedPort), "--no-open"],
    {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"]
    }
  );

  try {
    const baseUrl = await waitForServerUrl(serverProcess);
    await waitForServer(`${baseUrl}/api/tree`);

    await page.goto(baseUrl);
    await page.getByRole("button", { name: "Open README.md" }).click();
    await expect(page.locator(".pane").first().getByRole("heading", { level: 1 })).toHaveText(
      "Garden Home"
    );
    await expect(page.getByText('console.log("hello garden");')).toBeVisible();
    await expect(page.locator("pre code .hljs-string")).toBeVisible();
    await expect(page.locator('img[alt="Garden diagram"]')).toBeVisible();

    await page.locator(".tree-directory summary").filter({ hasText: "guides" }).click();
    await page.getByRole("button", { name: "Split with guides/setup.md" }).click();
    await expect(page.locator(".pane")).toHaveCount(2);
    await expect(
      page.locator(".pane").nth(1).getByRole("heading", { level: 1 })
    ).toHaveText("Setup Guide");

    const readmePath = path.join(workspacePath, "README.md");
    const originalContent = await readFile(readmePath, "utf8");
    await writeFile(readmePath, originalContent.replace("Garden Home", "Garden Home Updated"));

    await expect(page.locator(".pane").first().getByRole("heading", { level: 1 })).toHaveText(
      "Garden Home Updated"
    );
  } finally {
    serverProcess.kill("SIGTERM");
    await rm(workspacePath, { recursive: true, force: true });
  }
});

async function waitForServer(url: string): Promise<void> {
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);

      if (response.ok) {
        return;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  throw new Error(`Timed out waiting for ${url}`);
}

async function waitForServerUrl(serverProcess: ChildProcessWithoutNullStreams): Promise<string> {
  const deadline = Date.now() + 20_000;

  return await new Promise<string>((resolve, reject) => {
    let bufferedOutput = "";

    const cleanup = () => {
      serverProcess.stdout.off("data", handleOutput);
      serverProcess.stderr.off("data", handleOutput);
      serverProcess.off("exit", handleExit);
      clearInterval(timeoutPoll);
    };

    const handleOutput = (chunk: Buffer) => {
      bufferedOutput += chunk.toString();
      const match = bufferedOutput.match(/mdgarden running at (http:\/\/127\.0\.0\.1:\d+)/);

      if (match) {
        cleanup();
        resolve(match[1]);
      }
    };

    const handleExit = (code: number | null) => {
      cleanup();
      reject(new Error(`Server exited before reporting a URL (code ${code}).`));
    };

    const timeoutPoll = setInterval(() => {
      if (Date.now() >= deadline) {
        cleanup();
        reject(new Error("Timed out waiting for the server URL."));
      }
    }, 250);

    serverProcess.stdout.on("data", handleOutput);
    serverProcess.stderr.on("data", handleOutput);
    serverProcess.on("exit", handleExit);
  });
}
