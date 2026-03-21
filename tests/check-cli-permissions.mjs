import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "dist", "cli.js");

const cliStats = await stat(cliPath);

if ((cliStats.mode & 0o111) === 0) {
  throw new Error(`Expected ${cliPath} to be executable for npm link.`);
}
