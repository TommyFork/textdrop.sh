// ../lodestar/src/hooks/flush.ts
import { readFileSync, existsSync, readdirSync, unlinkSync, statSync } from "fs";
import { execSync } from "child_process";
import { join, basename } from "path";
import { homedir } from "os";
function git(cmd) {
  try {
    return execSync(cmd, { stdio: ["pipe", "pipe", "pipe"], timeout: 5000 }).toString().trim();
  } catch {
    return "";
  }
}
function extractText(content) {
  if (typeof content === "string")
    return content;
  return content.flatMap((b) => {
    if (b.type === "text" && b.text)
      return [b.text];
    if (b.type === "tool_result" && Array.isArray(b.content)) {
      return b.content.filter((c) => c.type === "text" && c.text).map((c) => c.text);
    }
    return [];
  }).join(`
`);
}
async function scrapeClaudeTranscripts(cwd, sinceTimestamp) {
  const projectsDir = join(homedir(), ".claude", "projects");
  const sessions = new Map;
  if (!existsSync(projectsDir))
    return sessions;
  const since = new Date(sinceTimestamp).getTime();
  const expectedDirName = cwd.replace(/[^a-zA-Z0-9]/g, "-");
  const projectDirs = readdirSync(projectsDir, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name === expectedDirName).map((e) => join(projectsDir, e.name));
  for (const dir of projectDirs) {
    let files;
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const file of files) {
      const filepath = join(dir, file);
      try {
        const s = statSync(filepath);
        if (s.mtimeMs < since - 60 * 60 * 1000)
          continue;
      } catch {
        continue;
      }
      try {
        const content = readFileSync(filepath, "utf-8");
        const lines = content.split(`
`).filter((l) => l.trim()).map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return null;
          }
        }).filter(Boolean);
        const relevant = lines.filter((l) => {
          if (l.cwd && !l.cwd.startsWith(cwd))
            return false;
          if (l.timestamp && new Date(l.timestamp).getTime() < since)
            return false;
          return true;
        });
        if (relevant.length > 0) {
          const sessionId = relevant.find((l) => l.sessionId)?.sessionId ?? basename(file, ".jsonl");
          sessions.set(sessionId, lines);
        }
      } catch {
        continue;
      }
    }
  }
  return sessions;
}
async function buildPayload(cwd, config, queueEntries, transcripts) {
  const commitHash = git("git rev-parse HEAD");
  const branch = git("git rev-parse --abbrev-ref HEAD");
  const authorEmail = git("git log -1 --format=%ae");
  const commitTimestamp = git("git log -1 --format=%aI");
  const commitMessage = git("git log -1 --format=%s");
  const sessionMap = new Map;
  for (const [sessionId, lines] of transcripts.entries()) {
    const turns = [];
    let model;
    let inputTokens = 0;
    let outputTokens = 0;
    for (const line of lines) {
      if (line.type === "user" && line.message?.role === "user") {
        const content = line.message.content;
        if (content) {
          const text = extractText(content);
          if (text.trim()) {
            turns.push({ role: "human", content: text, timestamp: line.timestamp });
          }
        }
      }
      if (line.type === "assistant" && line.message?.role === "assistant") {
        if (line.message.model)
          model = line.message.model;
        if (line.message.usage) {
          inputTokens += line.message.usage.input_tokens ?? 0;
          outputTokens += line.message.usage.output_tokens ?? 0;
        }
        if (line.message.content) {
          const text = extractText(line.message.content);
          const toolCalls = [];
          if (Array.isArray(line.message.content)) {
            for (const block of line.message.content) {
              if (block.type === "tool_use" && block.name)
                toolCalls.push(block.name);
            }
          }
          if (text.trim() || toolCalls.length > 0) {
            turns.push({
              role: "assistant",
              content: text,
              timestamp: line.timestamp,
              tool_calls: toolCalls.length > 0 ? toolCalls : undefined
            });
          }
        }
      }
    }
    if (turns.length > 0) {
      sessionMap.set(sessionId, {
        session_id: sessionId,
        agent: "claude-code",
        model,
        turns,
        total_tokens: inputTokens + outputTokens > 0 ? { input: inputTokens, output: outputTokens } : undefined
      });
    }
  }
  for (const entry of queueEntries) {
    if (!entry.session_id)
      continue;
    if (!sessionMap.has(entry.session_id) && entry.prompt) {
      sessionMap.set(entry.session_id, {
        session_id: entry.session_id,
        agent: "claude-code",
        turns: [{ role: "human", content: entry.prompt, timestamp: entry.timestamp }]
      });
    }
  }
  return {
    project_id: config.project_id,
    commit: {
      hash: commitHash,
      branch,
      author_email: authorEmail,
      timestamp: commitTimestamp,
      message: commitMessage
    },
    sessions: Array.from(sessionMap.values())
  };
}
async function main() {
  const cwd = process.cwd();
  const configPath = join(cwd, ".lodestar", "config.json");
  const queueDir = join(cwd, ".lodestar", "queue");
  if (!existsSync(configPath))
    return;
  let config;
  try {
    config = JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {
    return;
  }
  if (!config.api_key || config.api_key === "REPLACE_WITH_YOUR_API_KEY")
    return;
  const queueEntries = [];
  const queueFiles = [];
  if (existsSync(queueDir)) {
    const files = readdirSync(queueDir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      try {
        const entry = JSON.parse(readFileSync(join(queueDir, file), "utf-8"));
        queueEntries.push(entry);
        queueFiles.push(join(queueDir, file));
      } catch {
        continue;
      }
    }
  }
  const lastCommitTimestamp = git("git log -2 --format=%aI").split(`
`)[1] || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const transcripts = await scrapeClaudeTranscripts(cwd, lastCommitTimestamp);
  const payload = await buildPayload(cwd, config, queueEntries, transcripts);
  const sessions = payload.sessions;
  if (sessions.length === 0)
    return;
  try {
    const res = await fetch(`${config.server_url}/ingest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Lodestar-Key": config.api_key
      },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      for (const file of queueFiles) {
        try {
          unlinkSync(file);
        } catch {}
      }
    }
  } catch {}
}
main().catch(() => process.exit(0));
