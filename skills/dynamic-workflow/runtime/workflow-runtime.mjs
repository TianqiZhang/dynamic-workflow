import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import os from "node:os";
import crypto from "node:crypto";

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_TIMEOUT_MS = 600000;
const DEFAULT_AGENT_TIMEOUT_MS = 900000;
const SUBDIRS = ["prompts", "outputs", "errors", "shell", "diffs", "artifacts"];

let currentWorkflow = null;

export function createWorkflow(options = {}) {
  if (!options.name) {
    throw new Error("createWorkflow requires a workflow name");
  }

  const workflow = {
    name: String(options.name),
    runDir: options.runDir ?? path.join(".dynamic-workflows", "runs", safeName(options.name)),
    concurrency: positiveInteger(options.concurrency, DEFAULT_CONCURRENCY),
    resume: options.resume !== false,
    state: { items: {} },
    _stateWriteChain: Promise.resolve(),
    _agentsConfig: null,

    get itemsPath() {
      return path.join(this.runDir, "items.json");
    },

    async run(fn) {
      if (typeof fn !== "function") {
        throw new Error("wf.run requires an async function");
      }

      await ensureDir(this.runDir);
      await Promise.all(SUBDIRS.map((dir) => ensureDir(path.join(this.runDir, dir))));

      const loaded = this.resume ? await readJson(this.itemsPath, null) : null;
      this.state = loaded ? normalizeItemState(loaded) : { items: {} };

      const runId = crypto.randomUUID();
      await writeJson(path.join(this.runDir, "run.json"), {
        runId,
        name: this.name,
        startedAt: now(),
        cwd: process.cwd(),
        runDir: this.runDir,
        concurrency: this.concurrency,
        resume: this.resume,
        node: process.version,
        platform: os.platform()
      });

      const previousWorkflow = currentWorkflow;
      currentWorkflow = this;

      await this.event("run_started", { runId, name: this.name, cwd: process.cwd() });

      try {
        const result = await fn(this);
        await this._stateWriteChain;
        await this.event("run_completed", { runId });
        return result;
      } catch (error) {
        await this._stateWriteChain.catch(() => {});
        await this.event("run_failed", { runId, error: serializeError(error) });
        throw error;
      } finally {
        this._agentsConfig = null;
        currentWorkflow = previousWorkflow;
      }
    },

    async event(type, data = {}) {
      await appendJsonl(path.join(this.runDir, "events.jsonl"), {
        type,
        at: now(),
        ...data
      });
    },

    getItemState(key) {
      return this.state.items[String(key)];
    },

    async _writeItemEntry(key, entry, eventType, eventExtra) {
      const itemKey = String(key);
      await enqueueItemStateWrite(this, () => {
        this.state.items[itemKey] = entry;
      });
      await this.event(eventType, { key: itemKey, ...eventExtra });
      return entry;
    },

    async setItemState(key, value) {
      const entry = normalizeItemEntry(value);
      return this._writeItemEntry(key, entry, "item_state_updated", { status: entry.status ?? null });
    },

    isItemDone(key) {
      return this.getItemState(key)?.status === "done";
    },

    async markItemDone(key, value = null) {
      const entry = { status: "done", updatedAt: now(), result: value };
      return this._writeItemEntry(key, entry, "item_done", { result: value });
    },

    async markItemFailed(key, errorOrValue) {
      const entry = { status: "failed", updatedAt: now(), error: serializeError(errorOrValue) };
      return this._writeItemEntry(key, entry, "item_failed", { error: entry.error });
    },

    async writeReport(markdown) {
      const reportPath = path.join(this.runDir, "report.md");
      await writeText(reportPath, ensureTrailingNewline(markdown));
      await this.event("report_written", { path: reportPath });
      return reportPath;
    }
  };

  return workflow;
}

export async function agent(agentName, options = {}) {
  const workflow = requireWorkflow("agent");
  if (!options.prompt || typeof options.prompt !== "string") {
    throw new Error("agent requires a string prompt");
  }

  const config = await loadAgentsConfig();
  const adapter = config.agents?.[agentName];
  if (!adapter) {
    throw new Error(`Agent '${agentName}' is not configured in .dynamic-workflows/agents.json`);
  }
  if (!adapter.command || typeof adapter.command !== "string") {
    throw new Error(`Agent '${agentName}' requires a string command`);
  }

  const inputMode = adapter.input ?? "stdin";
  const outputMode = adapter.output ?? "text";
  if (!["stdin", "file"].includes(inputMode)) {
    throw new Error(`Agent '${agentName}' has unsupported input mode '${inputMode}'`);
  }
  if (!["text", "json"].includes(outputMode)) {
    throw new Error(`Agent '${agentName}' has unsupported output mode '${outputMode}'`);
  }

  const label = options.label ?? agentName;
  const artifactBase = artifactName(label);
  const promptPath = path.join(workflow.runDir, "prompts", `${artifactBase}.md`);
  await writeText(promptPath, options.prompt);

  let command = adapter.command;
  let stdin = "";
  if (inputMode === "stdin") {
    stdin = options.prompt;
  } else {
    if (!command.includes("{promptFile}")) {
      throw new Error(
        `Agent '${agentName}' uses input:file but its command is missing '{promptFile}'`
      );
    }
    command = command.replaceAll("{promptFile}", shellQuote(path.resolve(promptPath)));
  }

  const timeoutMs = positiveInteger(options.timeoutMs ?? adapter.timeoutMs, DEFAULT_AGENT_TIMEOUT_MS);
  const retries = Math.max(0, positiveInteger(options.retries, 0));
  const maxAttempts = retries + 1;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const attemptBase =
      maxAttempts > 1 ? `${artifactBase}.attempt-${attempt}` : artifactBase;
    const started = Date.now();

    await workflow.event("agent_started", {
      agent: agentName,
      label,
      attempt,
      cwd: path.resolve(options.cwd ?? process.cwd())
    });

    try {
      const result = await runCommand(command, {
        cwd: options.cwd ?? process.cwd(),
        input: stdin,
        timeoutMs,
        env: buildProcessEnv(adapter)
      });

      await writeText(
        path.join(workflow.runDir, "outputs", `${attemptBase}.stdout.txt`),
        result.stdout
      );
      await writeText(
        path.join(workflow.runDir, "errors", `${attemptBase}.stderr.txt`),
        result.stderr
      );

      if (result.timedOut) {
        throw transientError(`Agent '${agentName}' timed out after ${timeoutMs}ms`, {
          exitCode: result.exitCode,
          signal: result.signal
        });
      }
      if (result.exitCode !== 0) {
        throw transientError(`Agent '${agentName}' exited with code ${result.exitCode}`, {
          exitCode: result.exitCode,
          signal: result.signal
        });
      }

      let value = result.stdout;
      if (outputMode === "json") {
        try {
          value = parseJsonLoose(result.stdout);
        } catch (error) {
          throw transientError(`Agent '${agentName}' returned invalid JSON`, {
            cause: serializeError(error)
          });
        }
      }

      await workflow.event("agent_completed", {
        agent: agentName,
        label,
        attempt,
        durationMs: Date.now() - started
      });
      return value;
    } catch (error) {
      lastError = error;
      await workflow.event("agent_failed", {
        agent: agentName,
        label,
        attempt,
        durationMs: Date.now() - started,
        error: serializeError(error)
      });

      if (!error.transient || attempt === maxAttempts) {
        throw error;
      }

      await workflow.event("agent_retrying", {
        agent: agentName,
        label,
        nextAttempt: attempt + 1,
        delayMs: 500 * attempt
      });
      await sleep(500 * attempt);
    }
  }

  throw lastError ?? new Error(`Agent '${agentName}' failed`);
}

export async function shell(command, options = {}) {
  if (!command || typeof command !== "string") {
    throw new Error("shell requires a command string");
  }

  const workflow = currentWorkflow;
  const label = options.label ?? command;
  const base = artifactName(label);
  const started = Date.now();

  if (workflow) {
    await workflow.event("shell_started", {
      label,
      command,
      cwd: path.resolve(options.cwd ?? process.cwd())
    });
  }

  const result = await runCommand(command, {
    cwd: options.cwd ?? process.cwd(),
    timeoutMs: positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS),
    env: buildProcessEnv({ env: options.env ?? {}, inheritEnv: true })
  });

  if (workflow) {
    await writeText(path.join(workflow.runDir, "shell", `${base}.stdout.txt`), result.stdout);
    await writeText(path.join(workflow.runDir, "shell", `${base}.stderr.txt`), result.stderr);
  }

  const response = {
    ok: !result.timedOut && result.exitCode === 0,
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    stdout: result.stdout,
    stderr: result.stderr,
    durationMs: result.durationMs
  };

  if (options.json) {
    try {
      response.json = parseJsonLoose(result.stdout);
    } catch (error) {
      response.ok = false;
      response.error = `Failed to parse stdout as JSON: ${error.message}`;
    }
  }

  if (workflow) {
    await workflow.event("shell_completed", {
      label,
      ok: response.ok,
      exitCode: response.exitCode,
      timedOut: response.timedOut,
      durationMs: Date.now() - started,
      error: response.error ?? null
    });
  }

  return response;
}

export async function parallel(tasks, options = {}) {
  if (!Array.isArray(tasks)) {
    throw new Error("parallel requires an array of async task functions");
  }

  const concurrency = positiveInteger(
    options.concurrency ?? currentWorkflow?.concurrency,
    DEFAULT_CONCURRENCY
  );
  const stopOnError = options.stopOnError === true;
  const results = new Array(tasks.length);
  let nextIndex = 0;
  let stopped = false;

  async function worker() {
    while (!stopped) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= tasks.length) {
        return;
      }

      try {
        if (typeof tasks[index] !== "function") {
          throw new Error(`Task at index ${index} is not a function`);
        }
        const value = await tasks[index]();
        results[index] = { ok: true, index, value };
      } catch (error) {
        if (stopOnError) {
          stopped = true;
          throw error;
        }
        results[index] = {
          ok: false,
          index,
          error: errorToString(error)
        };
      }
    }
  }

  const workerCount = Math.min(concurrency, tasks.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

export async function pipeline(items, stages, options = {}) {
  if (!Array.isArray(items)) {
    throw new Error("pipeline requires an array of items");
  }
  if (!Array.isArray(stages) || stages.some((stage) => typeof stage !== "function")) {
    throw new Error("pipeline requires an array of stage functions");
  }

  const concurrency = positiveInteger(
    options.concurrency ?? currentWorkflow?.concurrency,
    DEFAULT_CONCURRENCY
  );
  const stopOnError = options.stopOnError === true;
  const results = new Array(items.length);
  let nextIndex = 0;
  let stopped = false;

  async function runItem(item, index) {
    let value = item;
    for (let stageIndex = 0; stageIndex < stages.length; stageIndex += 1) {
      try {
        value = await stages[stageIndex](value, item, index);
      } catch (error) {
        if (stopOnError) {
          const wrapped = new Error(
            `Pipeline item ${index} failed at stage ${stageIndex}: ${errorToString(error)}`
          );
          wrapped.cause = error;
          wrapped.index = index;
          wrapped.item = item;
          wrapped.stage = stageIndex;
          throw wrapped;
        }
        return {
          ok: false,
          index,
          item,
          stage: stageIndex,
          error: errorToString(error)
        };
      }
    }
    return { ok: true, index, item, value };
  }

  async function worker() {
    while (!stopped) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) {
        return;
      }

      try {
        results[index] = await runItem(items[index], index);
      } catch (error) {
        stopped = true;
        throw error;
      }
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

export async function globFiles(options = {}) {
  const root = options.root ?? ".";
  const rootPath = path.resolve(root);
  const extensions = new Set(
    (options.extensions ?? []).map((extension) => String(extension).toLowerCase())
  );
  const ignoreDirs = new Set(
    (options.ignoreDirs ?? ["node_modules", ".git", ".dynamic-workflows"]).map(String)
  );
  const files = [];

  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") {
        return;
      }
      throw error;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!ignoreDirs.has(entry.name)) {
          await walk(fullPath);
        }
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const extension = path.extname(entry.name).toLowerCase();
      if (extensions.size === 0 || extensions.has(extension)) {
        files.push(toPosixPath(path.relative(process.cwd(), fullPath)));
      }
    }
  }

  await walk(rootPath);
  return files.sort();
}

export async function readText(filePath) {
  return fs.readFile(filePath, "utf8");
}

export async function writeText(filePath, content) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, String(content), "utf8");
}

export async function appendText(filePath, content) {
  await ensureDir(path.dirname(filePath));
  await fs.appendFile(filePath, String(content), "utf8");
}

export async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await readText(filePath));
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

export async function writeJson(filePath, value) {
  await ensureDir(path.dirname(filePath));
  const tmpPath = `${filePath}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tmpPath, filePath);
}

export async function appendJsonl(filePath, value) {
  await appendText(filePath, `${JSON.stringify(value)}\n`);
}

export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function parseList(value, fallback) {
  if (!value) {
    return fallback;
  }
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

export function parseBoolean(value, fallback) {
  if (value === undefined || value === "") {
    return Boolean(fallback);
  }
  return ["1", "true", "yes", "y"].includes(String(value).toLowerCase());
}

export function formatPercent(value, { whenNullish = "" } = {}) {
  if (value === null || value === undefined) {
    return whenNullish;
  }
  if (!Number.isFinite(value)) {
    return String(value);
  }
  return `${value.toFixed(2)}%`;
}

export function markdownTable(headers, rows) {
  if (rows.length === 0) {
    return "_None._";
  }
  const escape = (cell) => String(cell ?? "").replace(/\|/g, "\\|").replace(/\n/g, "<br>");
  return [
    `| ${headers.map(escape).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(escape).join(" | ")} |`)
  ].join("\n");
}

export function safeName(name) {
  const cleaned = String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/[.]+$/g, "");

  return cleaned.slice(0, 120) || "item";
}

export function artifactName(label) {
  const text = String(label ?? "artifact");
  const safe = safeName(text);
  const hash = crypto.createHash("sha1").update(text).digest("hex").slice(0, 8);
  return `${safe.slice(0, 91)}-${hash}`;
}

export function diffText(before, after) {
  const beforeText = String(before);
  const afterText = String(after);
  if (beforeText === afterText) {
    return "";
  }

  const beforeLines = beforeText.split(/\r?\n/);
  const afterLines = afterText.split(/\r?\n/);
  const cellCount = beforeLines.length * afterLines.length;

  if (cellCount > 250000) {
    return pairedLineDiff(beforeLines, afterLines);
  }

  const dp = Array.from({ length: beforeLines.length + 1 }, () =>
    Array(afterLines.length + 1).fill(0)
  );

  for (let i = beforeLines.length - 1; i >= 0; i -= 1) {
    for (let j = afterLines.length - 1; j >= 0; j -= 1) {
      dp[i][j] =
        beforeLines[i] === afterLines[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const lines = [];
  let i = 0;
  let j = 0;

  while (i < beforeLines.length && j < afterLines.length) {
    if (beforeLines[i] === afterLines[j]) {
      lines.push(` ${beforeLines[i]}`);
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      lines.push(`-${beforeLines[i]}`);
      i += 1;
    } else {
      lines.push(`+${afterLines[j]}`);
      j += 1;
    }
  }

  while (i < beforeLines.length) {
    lines.push(`-${beforeLines[i]}`);
    i += 1;
  }
  while (j < afterLines.length) {
    lines.push(`+${afterLines[j]}`);
    j += 1;
  }

  return `${lines.join("\n")}\n`;
}

function pairedLineDiff(beforeLines, afterLines) {
  const lines = [];
  const length = Math.max(beforeLines.length, afterLines.length);
  for (let index = 0; index < length; index += 1) {
    const beforeLine = beforeLines[index];
    const afterLine = afterLines[index];
    if (beforeLine === afterLine) {
      lines.push(` ${beforeLine}`);
    } else {
      if (beforeLine !== undefined) {
        lines.push(`-${beforeLine}`);
      }
      if (afterLine !== undefined) {
        lines.push(`+${afterLine}`);
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

async function loadAgentsConfig() {
  const workflow = currentWorkflow;
  if (workflow?._agentsConfig) {
    return workflow._agentsConfig;
  }
  const configPath = path.resolve(".dynamic-workflows", "agents.json");
  const config = await readJson(configPath, null);
  if (!config || typeof config !== "object") {
    throw new Error("Missing or invalid .dynamic-workflows/agents.json");
  }
  if (!config.agents || typeof config.agents !== "object") {
    throw new Error(".dynamic-workflows/agents.json must contain an agents object");
  }
  if (workflow) {
    workflow._agentsConfig = config;
  }
  return config;
}

function requireWorkflow(functionName) {
  if (!currentWorkflow) {
    throw new Error(`${functionName} must be called inside createWorkflow(...).run()`);
  }
  return currentWorkflow;
}

function normalizeItemState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { items: {} };
  }
  if (!value.items || typeof value.items !== "object" || Array.isArray(value.items)) {
    value.items = {};
  }
  return value;
}

function normalizeItemEntry(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      status: "pending",
      updatedAt: now(),
      result: value
    };
  }
  return {
    updatedAt: now(),
    ...value
  };
}

function enqueueItemStateWrite(workflow, mutate) {
  const write = workflow._stateWriteChain.then(async () => {
    mutate();
    await writeJson(workflow.itemsPath, workflow.state);
  });
  workflow._stateWriteChain = write.catch(() => {});
  return write;
}

function parseJsonLoose(text) {
  try {
    return JSON.parse(text);
  } catch {}

  const fencedPattern = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match;
  while ((match = fencedPattern.exec(text))) {
    try {
      return JSON.parse(match[1].trim());
    } catch {}
  }

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "{" && text[index] !== "[") {
      continue;
    }
    const end = findJsonEnd(text, index);
    if (end === -1) {
      continue;
    }
    try {
      return JSON.parse(text.slice(index, end));
    } catch {}
  }

  throw new Error("No valid JSON object or array found");
}

function findJsonEnd(text, start) {
  const stack = [];
  let inString = false;
  let escape = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escape) {
        escape = false;
      } else if (char === "\\") {
        escape = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") {
      stack.push("}");
      continue;
    }
    if (char === "[") {
      stack.push("]");
      continue;
    }
    if (char === "}" || char === "]") {
      if (stack.pop() !== char) {
        return -1;
      }
      if (stack.length === 0) {
        return index + 1;
      }
    }
  }

  return -1;
}

function runCommand(command, options = {}) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(command, {
      cwd: options.cwd ?? process.cwd(),
      shell: true,
      env: options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let timeoutId = null;
    let killId = null;

    if (options.timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        killId = setTimeout(() => child.kill("SIGKILL"), 2000);
      }, options.timeoutMs);
    }

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timeoutId);
      clearTimeout(killId);
      error.transient = true;
      reject(error);
    });

    child.on("close", (exitCode, signal) => {
      clearTimeout(timeoutId);
      clearTimeout(killId);
      resolve({
        exitCode,
        signal,
        stdout,
        stderr,
        timedOut,
        durationMs: Date.now() - started
      });
    });

    child.stdin.on("error", () => {});

    try {
      child.stdin.end(options.input ?? "");
    } catch {}
  });
}

function buildProcessEnv(adapter = {}) {
  const env = adapter.inheritEnv === false ? {} : { ...process.env };
  for (const [key, value] of Object.entries(adapter.env ?? {})) {
    if (value !== undefined) {
      env[key] = String(value);
    }
  }
  return env;
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  if (Number.isInteger(number) && number > 0) {
    return number;
  }
  return fallback;
}

function transientError(message, data = {}) {
  const error = new Error(message);
  error.transient = true;
  error.data = data;
  return error;
}

function serializeError(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      data: error.data ?? undefined
    };
  }
  if (error && typeof error === "object") {
    return error;
  }
  return { message: String(error) };
}

function errorToString(error) {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  if (error && typeof error === "object") {
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function toPosixPath(filePath) {
  return filePath.split(path.sep).join("/");
}

function ensureTrailingNewline(text) {
  const value = String(text);
  return value.endsWith("\n") ? value : `${value}\n`;
}

function now() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
