import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const runInBand = args.includes("--runInBand");
const vitestArgs = args.filter((arg) => arg !== "--runInBand");

if (runInBand) {
  vitestArgs.push("--maxWorkers=1", "--no-file-parallelism");
}

const result = spawnSync("vitest", ["run", ...vitestArgs], {
  shell: process.platform === "win32",
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
