// ../lodestar/src/hooks/capture-claude.ts
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { execSync } from "child_process";
import { join } from "path";
function readStdinSync() {
  try {
    return readFileSync("/dev/stdin", "utf-8");
  } catch {
    return "";
  }
}
function gitCommand(cmd) {
  try {
    return execSync(cmd, { stdio: ["pipe", "pipe", "pipe"], timeout: 2000 }).toString().trim();
  } catch {
    return "";
  }
}
function main() {
  const raw = readStdinSync();
  if (!raw.trim())
    process.exit(0);
  let payload = {};
  try {
    payload = JSON.parse(raw);
  } catch {
    process.exit(0);
  }
  const cwd = payload.cwd ?? process.cwd();
  const queueDir = join(cwd, ".lodestar", "queue");
  if (!existsSync(queueDir)) {
    try {
      mkdirSync(queueDir, { recursive: true });
    } catch {
      process.exit(0);
    }
  }
  let config = {};
  const configPath = join(cwd, ".lodestar", "config.json");
  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, "utf-8"));
    } catch {}
  }
  const enriched = {
    ...payload,
    branch: gitCommand("git rev-parse --abbrev-ref HEAD"),
    commit: gitCommand("git rev-parse HEAD"),
    timestamp: new Date().toISOString(),
    project_id: config.project_id ?? "unknown"
  };
  const sessionId = payload.session_id ?? "unknown";
  const filename = `${Date.now()}_prompt_${sessionId.replace(/[^a-zA-Z0-9]/g, "_")}.json`;
  try {
    writeFileSync(join(queueDir, filename), JSON.stringify(enriched));
  } catch {}
  process.exit(0);
}
main();
