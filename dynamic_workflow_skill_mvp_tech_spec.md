# Dynamic Workflow Skill MVP Tech Spec

## 1. Purpose

Build an MVP of a `dynamic-workflow` skill that teaches a local coding agent to create and run code-based orchestration workflows for large, repetitive, long-running, parallelizable, or verification-heavy tasks.

The MVP is not a standalone product and not a full CLI framework. It is a skill folder containing:

1. `SKILL.md`: instructions that tell a coding agent when and how to use the dynamic workflow pattern.
2. A minimal JavaScript runtime template: `workflow-runtime.mjs`.
3. A small set of reference docs.
4. A few sample workflows that a coding agent can copy and adapt.

The coding agent should be able to read this skill, copy the runtime into the target repo, write a task-specific workflow script, run it, and summarize the results from the generated artifacts.

---

## 2. Core Idea

The dynamic workflow pattern separates deterministic orchestration from fuzzy agent work.

### Deterministic workflow code handles

- File enumeration
- Batching
- Queueing
- Parallelism
- State persistence
- Resume behavior
- Shell command execution
- Serialized state writes
- Diff generation
- Writing results
- Test or benchmark execution
- Acceptance checks based on objective metrics
- Report generation

### Agents handle

- Local reasoning
- Text editing
- Code editing
- Review
- Hypothesis generation
- Summarization
- Strategy suggestions

### Key principle

The workflow owns the loop. Agents own local reasoning or local edits. The current chat session should not hold all intermediate state.

---

## 3. MVP Goals

The MVP should allow a coding agent to perform workflows like:

1. Proofread hundreds of Markdown/text files.
2. Review many files in a codebase and produce structured findings.
3. Run repeated code/test/build/benchmark optimization loops.
4. Run simple auto-research style loops where an agent proposes a change, deterministic commands evaluate it, and the workflow accepts or rejects the result.

The MVP must support:

- A skill folder layout.
- A single-file Node.js runtime with no required npm dependencies.
- Task-specific workflow scripts written as `.mjs` files.
- Configurable CLI agents.
- Agent prompt input via stdin or prompt file.
- Agent output as text or JSON.
- Basic JSON extraction/parsing.
- Lightweight schema validation for machine-consumed agent JSON.
- Parallel execution with bounded concurrency.
- Pipeline execution over many items.
- Optional per-item state persistence for workflows that need item-level resume.
- Resume by skipping completed items when the workflow uses item state.
- Shell command execution with timeout.
- Run artifact directory with logs, prompts, outputs, state, and report.
- Example workflows.

---

## 4. Non-goals for MVP

Do not implement these in the MVP:

- A polished standalone CLI.
- A web UI or TUI.
- Distributed workers.
- Durable database beyond JSON/JSONL files.
- Full JSON Schema validation library dependency; the runtime should keep a small dependency-free schema subset.
- Complex sandboxing.
- Full git worktree management.
- Automated dependency installation.
- Full self-modifying workflow runtime.
- Cross-machine execution.
- Token/cost accounting.
- Model provider SDK integration.

The MVP should remain simple enough that a coding agent can inspect and modify it easily.

---

## 5. Expected Skill Folder Structure

Create the following folder:

```text
skills/dynamic-workflow/
  SKILL.md
  references/
    concepts.md
    when-to-use.md
    runtime-contract.md
    agent-contract.md
    patterns.md
    safety-and-isolation.md
  runtime/
    workflow-runtime.mjs
  examples/
    proofread-directory.workflow.mjs
    review-codebase.workflow.mjs
    benchmark-optimize.workflow.mjs
    auto-research-simple.workflow.mjs
```

The exact parent folder may depend on the local coding agent's skill system. The implementation should keep the internal structure above.

This `skills/dynamic-workflow/` folder is the reusable skill installation. It is separate from `.dynamic-workflows/`, which is created inside each target repo when the skill is used.

---

## 6. Target Project Runtime Layout

When a coding agent uses this skill in a target repo, it should create:

```text
.dynamic-workflows/
  agents.json
  runtime/
    workflow-runtime.mjs
  workflows/
    <task-name>.workflow.mjs
  runs/
    <workflow-name>/
      run.json
      events.jsonl
      items.json         # optional item checkpoint
      report.md
      prompts/
      outputs/
      errors/
      shell/
      diffs/
      artifacts/
```

For the earliest MVP, the default run directory should be stable per workflow, not timestamped per invocation. Reusing one directory makes resume behavior obvious and avoids requiring a separate run registry.

`<workflow-name>` means `safeName(name)`, not the raw workflow name.

`items.json` is a standard optional checkpoint file. It is needed for workflows that want item-level resume, such as "process these 400 files and skip the 217 already completed files." Workflows that only run a single command, produce one report, or manage custom state do not need to use item state. The runtime may create an empty `items.json` for consistency, but workflow correctness should not depend on every workflow using it.

### `agents.json`

The target repo should contain a configurable agent adapter file:

```json
{
  "agents": {
    "editor": {
      "command": "claude -p",
      "jsonCommand": "claude -p --output-format json",
      "input": "stdin",
      "output": "json",
      "timeoutMs": 900000,
      "inheritEnv": true,
      "env": {}
    },
    "reviewer": {
      "command": "claude -p",
      "jsonCommand": "claude -p --output-format json",
      "input": "stdin",
      "output": "json",
      "timeoutMs": 900000,
      "inheritEnv": true,
      "env": {}
    },
    "coder": {
      "command": "claude -p",
      "jsonCommand": "claude -p --output-format json",
      "input": "stdin",
      "output": "json",
      "timeoutMs": 1800000,
      "inheritEnv": true,
      "env": {}
    }
  }
}
```

The command values are examples. The skill must explain that the user or coding agent should adapt them to the locally available agent CLI.

Supported `input` values:

- `stdin`
- `file`

Supported `output` values:

- `text`
- `json`

Optional adapter fields:

- `jsonCommand`: optional shell command to use for structured output calls. Use this for local agent CLI JSON flags such as `--json` or `--output-format json`.
- `timeoutMs`: default timeout for this agent.
- `inheritEnv`: whether the subprocess inherits the current environment. Default `true` for local CLI compatibility.
- `env`: extra environment variables to add or override.

The skill must warn that inherited environment variables can expose secrets to agent subprocesses.

---

## 7. Main User Flow

When the user asks for a large task, the coding agent should:

1. Detect that the task is suitable for dynamic workflow.
2. Create `.dynamic-workflows/` in the target repo if missing.
3. Copy `runtime/workflow-runtime.mjs` from the skill into `.dynamic-workflows/runtime/`.
4. Create `.dynamic-workflows/agents.json` if missing.
5. Create a task-specific workflow under `.dynamic-workflows/workflows/`.
6. Run the workflow using Node.js:

```bash
node .dynamic-workflows/workflows/<task-name>.workflow.mjs
```

7. Inspect `.dynamic-workflows/runs/<task-name>/report.md` and other artifacts.
8. Summarize what happened to the user.

The coding agent should not try to process hundreds of files directly inside the chat session.

---

## 8. `SKILL.md` Requirements

`SKILL.md` must be short, directive, and optimized for coding-agent behavior.

It should include:

1. A description header.
2. Trigger conditions.
3. Required behavior.
4. The key workflow principle.
5. The default implementation sequence.
6. References to detailed docs.
7. Warnings about safety and state.

### Draft `SKILL.md`

```md
---
name: dynamic-workflow
description: Use when a task is too large, repetitive, parallelizable, long-running, or verification-heavy to complete directly in the current chat. Create code-based workflows that call CLI agents, keep state on disk, and resume safely.
---

# Dynamic Workflow Skill

Use this skill when the user's task has one or more of these properties:

- Many independent items: files, tests, documents, issues, URLs, candidates, modules, examples.
- Long-running loops: optimize until a metric improves, run repeated experiments, repeatedly test and fix.
- Parallelizable subtasks: one agent per file, module, candidate, or review dimension.
- Need for verification: writer agent followed by reviewer agent, code change followed by tests, benchmark result followed by acceptance check.
- Context too large for one conversation.
- The user explicitly asks for workflow, orchestration, batching, fan-out, auto research, or dynamic workflow.

Do not try to complete such tasks directly in the current conversation. Instead, create a workflow script.

## Required behavior

1. Create `.dynamic-workflows/` in the current repo if it does not exist.
2. Copy or create the minimal runtime at `.dynamic-workflows/runtime/workflow-runtime.mjs`.
3. Create `.dynamic-workflows/agents.json` if missing.
4. Write a task-specific workflow under `.dynamic-workflows/workflows/`.
5. Use deterministic code for enumeration, batching, state, retries, writing files, shell commands, and report generation.
6. Use agents only for fuzzy judgment, editing, summarization, code changes, hypothesis generation, or review.
7. All agent calls must have explicit input and output contracts.
8. Prefer JSON output from agents when possible.
9. For item-based workflows, persist item status to disk so the workflow can resume.
10. At the end, summarize from workflow artifacts, not from memory.

## Key principle

The workflow owns the loop. Agents own local reasoning or local edits. The current chat session only creates, starts, monitors, and summarizes the workflow.

## Before writing a workflow

Read:

- `references/runtime-contract.md`
- `references/agent-contract.md`
- `references/patterns.md`
- `references/safety-and-isolation.md`

Use examples as templates.
```

---

## 9. Runtime Public API

The MVP runtime should export these functions:

```js
createWorkflow(options)
agent(agentName, options)
shell(command, options)
parallel(tasks, options)
pipeline(items, stages, options)
globFiles(options)
readText(filePath)
writeText(filePath, content)
appendText(filePath, content)
diffText(before, after)
safeName(name)
```

Optional but useful:

```js
readJson(filePath, fallback)
writeJson(filePath, value)
appendJsonl(filePath, value)
fileExists(filePath)
ensureDir(dirPath)
```

---

## 10. `createWorkflow(options)`

### Signature

```js
const wf = createWorkflow({
  name,
  runDir,
  concurrency,
  resume
});
```

### Options

```js
{
  name: string,
  runDir?: string,
  concurrency?: number,
  resume?: boolean
}
```

Defaults:

```js
concurrency = 4
resume = true
runDir = `.dynamic-workflows/runs/${safeName(name)}`
```

MVP run directories are stable per workflow by default. Re-running the same workflow reuses the same artifact directory and can resume from prior item state. A workflow can still pass a custom `runDir` if it wants isolated artifacts for a one-off run.

`resume` controls item-state loading:

- `resume: true`: load existing `items.json` if present.
- `resume: false`: start with empty item state for this invocation and overwrite `items.json` on the first item-state write.

The runtime should not delete the run directory automatically. If a completely clean artifact directory is needed, the user or top-level coding agent can remove it explicitly or provide a different `runDir`.

### Returned object

```js
{
  name,
  runDir,
  concurrency,
  state,
  run(fn),
  event(type, data),
  getItemState(key),
  setItemState(key, value),
  isItemDone(key),
  markItemDone(key, value),
  markItemFailed(key, errorOrValue),
  writeReport(markdown)
}
```

`state` is the in-memory item checkpoint object with the same shape as `items.json`, usually `{ items: {} }`. It is not intended to be a general workflow database. Workflows that need custom state should write explicit artifacts under `artifacts/` or their own files.

### Behavior

`wf.run(fn)` should:

1. Create the run directory.
2. Create subdirectories:
   - `prompts/`
   - `outputs/`
   - `errors/`
   - `shell/`
   - `diffs/`
   - `artifacts/`
3. Load existing item state if `resume` is true and `items.json` exists.
4. Otherwise initialize empty in-memory item state.
5. Write or overwrite `run.json` for the latest invocation.
6. Append `run_started` to `events.jsonl`.
7. Execute `fn`.
8. On success, append `run_completed`.
9. On failure, append `run_failed` and rethrow.

---

## 11. State Model

For item-based workflows, use a simple JSON checkpoint file:

```text
.dynamic-workflows/runs/<workflow-name>/items.json
```

`items.json` is not required for every workflow. It is the runtime's standard per-item progress file for workflows that have stable item keys and need resumable processing. Examples:

- Proofreading many files should use item state.
- Reviewing many source files should use item state.
- A single benchmark command may not need item state.
- An experiment loop may use custom artifacts instead of item state, unless each experiment has a stable key.

Shape:

```json
{
  "items": {
    "docs/file1.md": {
      "status": "done",
      "updatedAt": "2026-05-30T12:00:00.000Z",
      "result": {
        "status": "updated",
        "summary": "Fixed spelling and punctuation."
      }
    }
  }
}
```

Recommended item statuses:

- `pending`
- `running`
- `done`
- `failed`
- `skipped`
- `rejected`

The MVP can keep this simple: only `done` items are skipped on resume.

For terminal outcomes that should not be retried, such as "unchanged", "updated", or "reviewer rejected this edit", prefer top-level `status: "done"` with a detailed `result.status`. Use top-level `failed` for items that should be retried. Use top-level `rejected` or `skipped` only when the workflow explicitly wants those statuses to remain non-done for future policy decisions.

The workflow decides whether to skip an item by calling `wf.isItemDone(key)`. The runtime should not hide items automatically from `pipeline()` or `parallel()` because each workflow may have different retry, rejected, or stale-result rules.

Failed items should be recorded with status `failed`, usually through `wf.markItemFailed(key, errorOrValue)` or `wf.setItemState(key, ...)`. `wf.isItemDone(key)` must return true only for `status: "done"`, so failed items are naturally retried on the next run when `resume: true` unless the workflow explicitly chooses a different policy.

When item-state helpers are used under `parallel()` or `pipeline()`, the runtime should serialize in-process writes to `items.json` so concurrent item completions do not overwrite each other. A simple promise-chained write mutex is enough for MVP: enqueue each state mutation, update the in-memory object, write JSON to a temporary file, then rename it over `items.json`. The MVP does not need cross-process locking; running the same workflow directory from two separate Node.js processes at the same time is unsupported.

---

## 12. Event Log

Every important operation should append a JSON line to:

```text
events.jsonl
```

Example events:

```json
{"type":"run_started","at":"2026-05-30T12:00:00.000Z","name":"proofread-directory"}
{"type":"agent_started","at":"...","agent":"editor","label":"edit:docs/a.md"}
{"type":"agent_completed","at":"...","agent":"editor","label":"edit:docs/a.md","durationMs":12345}
{"type":"item_done","at":"...","key":"docs/a.md","result":{"status":"updated"}}
{"type":"run_completed","at":"..."}
```

The event log is append-only and should be useful for debugging.

Because the default run directory is reused, `events.jsonl` may contain events from multiple invocations of the same workflow. Each invocation should append its own `run_started` and terminal `run_completed` or `run_failed` event.

---

## 13. `agent(agentName, options)`

### Signature

```js
const result = await agent("editor", {
  label,
  prompt,
  cwd,
  schema,
  timeoutMs,
  retries
});
```

### Options

```js
{
  label: string,
  prompt: string,
  cwd?: string,
  schema?: object,
  timeoutMs?: number,
  retries?: number
}
```

### Behavior

1. Load `.dynamic-workflows/agents.json`.
2. Find the named agent.
3. If `schema` is provided, append the schema contract to the prompt and use structured output mode.
4. Write the prompt to `prompts/<safe-label>.md`.
5. Run `jsonCommand` when structured output mode is active and the adapter provides one; otherwise run `command`.
6. If `input` is `stdin`, pass prompt to stdin.
7. If `input` is `file`, create a prompt file and replace `{promptFile}` in the command string. If the placeholder is missing, throw a configuration error.
8. Capture stdout and stderr.
9. Write stdout to `outputs/<safe-label>.stdout.txt`.
10. Write stderr to `errors/<safe-label>.stderr.txt`.
11. If output mode is `json` or `schema` is provided, parse JSON from stdout.
12. If JSON parsing fails, attempt to extract the first JSON object or array from stdout, choosing whichever valid JSON region appears first by position.
13. If `schema` is provided, validate the parsed JSON against the runtime's lightweight schema subset.
14. Return parsed JSON or raw text.

Supported schema keywords are `type`, `required`, `properties`, `items`, `enum`, `additionalProperties`, `nullable`, `minItems`, `maxItems`, `minLength`, and `maxLength`. This validates shape only. Workflow code must still compute deterministic facts such as actual changed files, diffs, command exit codes, and parsed metrics.

### Command parsing

For MVP, support command as a string and run it through the shell:

```js
spawn(command, { shell: true })
```

This is less safe than argv-array execution but simpler. Document the risk.

Future npm package can support argv arrays.

Agent subprocesses inherit the current environment by default unless their adapter sets `inheritEnv: false`. Adapter `env` values should be merged into the spawned process environment.

For `input: "file"`, the runtime should replace every `{promptFile}` occurrence with a shell-quoted absolute prompt-file path. The command string should contain the unquoted placeholder, for example `agent-cli --prompt {promptFile}`.

### Retries

`retries` defaults to `0` and means additional attempts after the first attempt. For example, `retries: 2` allows up to 3 attempts total.

Retry only transient execution failures:

- Non-zero exit code.
- Timeout.
- JSON parse or extraction failure when adapter `output` is `json` or `schema` is provided.
- Schema validation failure when `agent(..., { schema })` is used.

Do not retry configuration errors such as a missing agent name, unsupported adapter option, or missing `{promptFile}` placeholder for `input: "file"`.

Between retries, wait with simple linear backoff such as `500ms * attemptNumber`. If more than one attempt occurs, prompt/stdout/stderr artifacts should include the attempt number so failed attempts are auditable.

### Timeout

If timeout expires:

1. Kill the subprocess.
2. Write an error event.
3. Throw an error.

---

## 14. Agent Output Contract

Every agent prompt should include:

1. Local objective.
2. Input data.
3. Allowed actions.
4. Forbidden actions.
5. Required output format.
6. Semantic payload fields expected by the workflow.
7. Acceptance criteria.

Example:

```text
You are proofreading one Markdown file.

Rules:
- Fix spelling and grammar errors.
- Preserve meaning.
- Preserve Markdown structure.
- Do not modify code blocks.
- Do not rewrite style unnecessarily.
- Return the corrected full file text and a short summary.
```

The workflow should pass the machine-readable shape through `agent(..., { schema })`, for example:

```js
const edit = await agent("editor", {
  label: "edit:docs/a.md",
  prompt,
  schema: {
    type: "object",
    required: ["correctedText", "summary"],
    properties: {
      correctedText: { type: "string" },
      summary: { type: "string" }
    },
    additionalProperties: false
  },
  retries: 1
});
```

Schema validation confirms output shape, not truth. The workflow still computes deterministic facts such as whether text changed, actual changed files, command exit codes, diffs, and metrics.

---

## 15. `shell(command, options)`

### Signature

```js
const result = await shell("npm test -- --json", {
  cwd,
  timeoutMs,
  label,
  json
});
```

### Options

```js
{
  cwd?: string,
  timeoutMs?: number,
  label?: string,
  json?: boolean,
  env?: object
}
```

### Return value

```js
{
  ok: boolean,
  exitCode: number,
  stdout: string,
  stderr: string,
  json?: any,
  durationMs: number
}
```

If `json: true`, parse stdout as JSON or extract JSON from stdout using the same loose JSON parser as `agent()`.

### Behavior

- Write stdout/stderr to `shell/<safe-label>.stdout.txt` and `shell/<safe-label>.stderr.txt` when a workflow context exists.
- Append shell events to `events.jsonl`.

---

## 16. `parallel(tasks, options)`

### Signature

```js
const results = await parallel(
  tasks,
  { concurrency: 4, stopOnError: false }
);
```

### Input

`tasks` is an array of async functions.

### Options

```js
{
  concurrency?: number,
  stopOnError?: boolean
}
```

### Behavior

- Execute up to `concurrency` tasks at a time.
- Preserve result order by input task index.
- Always return result envelopes when `stopOnError` is false:

```js
{
  ok: true,
  index: 0,
  value: "..."
}
```

```js
{
  ok: false,
  index: 0,
  error: "..."
}
```

- If `stopOnError` is true, throw on the first observed task failure. Already-running tasks are not forcibly cancelled, but no ordered result array is returned.

---

## 17. `pipeline(items, stages, options)`

### Signature

```js
const results = await pipeline(items, [stage1, stage2, stage3], {
  concurrency: 4,
  stopOnError: false
});
```

Options match `parallel()`:

```js
{
  concurrency?: number,
  stopOnError?: boolean
}
```

### Behavior

For each item:

1. Run stage 1.
2. Pass result to stage 2.
3. Pass result to stage 3.
4. Return final result.

Across items, run pipelines concurrently with bounded concurrency.

`pipeline()` returns result envelopes in input item order when `stopOnError` is false:

```js
{
  ok: true,
  index: 0,
  item,
  value
}
```

```js
{
  ok: false,
  index: 0,
  item,
  stage: 1,
  error: "..."
}
```

If any stage throws for an item, later stages for that item do not run. `stage` is the zero-based stage index that failed. If `stopOnError` is true, throw on the first observed item failure. Already-running item pipelines are not forcibly cancelled.

This is better than barrier-style parallel stages for large item sets.

---

## 18. `globFiles(options)`

No npm dependency in MVP.

Implement a simple recursive file finder that supports:

- Root directory.
- File extensions.
- Ignore directories.

### Signature

```js
const files = await globFiles({
  root: "docs",
  extensions: [".md", ".txt"],
  ignoreDirs: ["node_modules", ".git", ".dynamic-workflows"]
});
```

Do not implement full glob syntax in MVP unless easy.

---

## 19. File Helpers

Required helpers:

```js
readText(filePath)
writeText(filePath, content)
appendText(filePath, content)
readJson(filePath, fallback)
writeJson(filePath, value)
appendJsonl(filePath, value)
ensureDir(dirPath)
fileExists(filePath)
safeName(name)
```

`safeName` should convert labels into filesystem-safe names.

---

## 20. `diffText(before, after)`

MVP implementation can be simple:

- Write both versions to artifacts if needed.
- Return a rough line-level diff.

No dependency required.

Simple output is acceptable:

```diff
- old line
+ new line
```

This is mainly for reviewer prompts and reports.

`diffText()` output is display-oriented, not a machine-parseable patch contract. Workflows that need to apply changes should use structured JSON, explicit file writes, or a real patch artifact generated by the workflow.

---

## 21. Example Workflow 1: Proofread Directory

File:

```text
examples/proofread-directory.workflow.mjs
```

Purpose:

- Enumerate Markdown/text files.
- For each file, call an editor agent.
- Call reviewer agent on proposed correction.
- Write accepted changes.
- Persist item state.
- Generate report.

Expected workflow behavior:

1. Find files under `docs/` with `.md` and `.txt` extensions.
2. Skip files already marked done.
3. Read original file.
4. Send original content to editor agent.
5. Editor returns:

```json
{
  "changed": true,
  "correctedText": "...",
  "summary": "..."
}
```

6. If unchanged, mark item done.
7. If changed, generate diff.
8. Send original, corrected text, and diff to reviewer agent.
9. Reviewer returns:

```json
{
  "accept": true,
  "reason": "...",
  "finalText": "..."
}
```

10. If accepted, write `finalText` to file.
11. If rejected, do not write.
12. Mark item done with result.
13. Write report with counts:
   - total files
   - updated
   - unchanged
   - rejected
   - failed

---

## 22. Example Workflow 2: Review Codebase

File:

```text
examples/review-codebase.workflow.mjs
```

Purpose:

- Enumerate source files.
- Ask reviewer agents to produce structured findings.
- Aggregate findings.
- Generate report.

The workflow should not modify files.

Agent output:

```json
{
  "findings": [
    {
      "severity": "low|medium|high",
      "file": "src/example.ts",
      "line": 123,
      "title": "...",
      "description": "...",
      "suggestion": "..."
    }
  ]
}
```

Report should group by severity.

---

## 23. Example Workflow 3: Benchmark Optimize

File:

```text
examples/benchmark-optimize.workflow.mjs
```

Purpose:

- Run baseline benchmark command.
- Create an isolated sandbox copy of the target code under the run artifact directory.
- Ask coder agent to implement one optimization inside the sandbox only.
- Run tests in the sandbox.
- Run benchmark in the sandbox.
- Record the candidate diff and accept/reject result based on tests and benchmark improvement.

MVP behavior:

- Do not implement git worktrees.
- Do not modify the original repo.
- Copy only configured target paths into `artifacts/benchmark-sandbox/`.
- Run the coder agent with `cwd` set to the sandbox.
- Restrict the prompt to explicitly allowed files or directories.
- Generate a candidate diff artifact comparing the original target paths to the sandbox.
- Write a report with baseline metric, candidate metric, test result, improvement percentage, and accept/reject decision.
- Never automatically apply, commit, or revert changes in the original repo.

If the candidate is accepted, the example should still leave application to the human or top-level coding agent. Its job is to produce an auditable candidate patch plus benchmark evidence.

---

## 24. Example Workflow 4: Simple Auto Research

File:

```text
examples/auto-research-simple.workflow.mjs
```

Purpose:

- Demonstrate an experiment loop.
- Agent proposes a hypothesis.
- Agent proposes a target-file change or patch.
- Shell runs evaluation command.
- Workflow compares metric.
- Workflow records accept/reject.

MVP should avoid complex self-modifying strategy code. It should document the future pattern but not fully implement it. The example should make clear that Auto Research is only one pattern built on Dynamic Workflow, not the central purpose of the skill.

---

## 25. Safety Rules

The skill and examples must teach these rules:

1. Prefer workflows that read input, ask agents for structured output, and let deterministic code write results.
2. Do not let agents directly modify many files unless necessary.
3. For text proofreading, have agents return corrected text; workflow writes it.
4. For code changes, require tests before accepting.
5. For optimization, require objective metrics before accepting.
6. Do not expose secrets to agent subprocesses unless explicitly required.
7. Do not put API keys in prompts.
8. Be explicit about whether agent subprocesses inherit environment variables.
9. Do not allow arbitrary destructive shell commands in generated workflows.
10. For code-edit workflows, prefer patch/edit-plan generation over uncontrolled direct edits.
11. Keep run artifacts for auditability.
12. Make workflows resumable when they process many items or long loops.

---

## 26. Agent-code Pattern for Future Extension

The MVP should document but not fully implement `agentCode()`.

The intended future pattern:

```text
root workflow: stable, not edited during current run
strategy modules: allowed to be edited by agents after validation
target files: edited as part of experiments
```

Example future structure:

```text
.dynamic-workflows/
  workflows/
    auto-research.workflow.mjs
  strategies/
    propose.mjs
    review.mjs
  prompts/
    propose.md
    review.md
```

Rule:

Agents may propose edits to strategy modules for the next generation of the workflow, but the current root workflow should not mutate itself during execution.

The MVP can include this in `references/patterns.md` as a future pattern.

---

## 27. Implementation Requirements for `workflow-runtime.mjs`

The runtime should be a single ESM file.

Use only Node.js built-in modules:

```js
node:fs/promises
node:path
node:child_process
node:os
node:crypto
```

No external dependencies.

Minimum supported Node.js version: Node 18+.

The runtime should be readable and easy for a coding agent to modify.

---

## 28. Suggested Runtime Implementation Outline

```js
// workflow-runtime.mjs

import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import os from "node:os";
import crypto from "node:crypto";

let currentWorkflow = null;

export function createWorkflow(options) { ... }
export async function agent(agentName, options) { ... }
export async function shell(command, options = {}) { ... }
export async function parallel(tasks, options = {}) { ... }
export async function pipeline(items, stages, options = {}) { ... }
export async function globFiles(options) { ... }
export async function readText(filePath) { ... }
export async function writeText(filePath, content) { ... }
export async function appendText(filePath, content) { ... }
export async function readJson(filePath, fallback = null) { ... }
export async function writeJson(filePath, value) { ... }
export async function appendJsonl(filePath, value) { ... }
export async function ensureDir(dirPath) { ... }
export async function fileExists(filePath) { ... }
export function safeName(name) { ... }
export function diffText(before, after) { ... }
```

Use `currentWorkflow` so helper functions can write logs into the active run directory.

---

## 29. Minimal JSON Extraction

Implement helper:

```js
function parseJsonLoose(text) {
  try {
    return JSON.parse(text);
  } catch {}

  // Try fenced code block first.
  // Then try the first valid {...} or [...] region by position.
  // Throw if still invalid.
}
```

This does not need to be perfect. It should be good enough for common agent outputs.

---

## 30. Reporting

Each workflow should produce `report.md`.

The runtime should provide:

```js
await wf.writeReport(markdown)
```

Example report sections:

```md
# Proofread Directory Report

- Total files: 312
- Updated: 147
- Unchanged: 151
- Rejected: 9
- Failed: 5

## Updated Files

| File | Summary |
|---|---|
| docs/a.md | Fixed spelling and punctuation. |

## Rejected Files

| File | Reason |
|---|---|
| docs/b.md | Reviewer found meaning changed. |

## Failed Files

| File | Error |
|---|---|
```

---

## 31. Reference Docs Content

### `references/concepts.md`

Must explain:

- Current chat is not the worker.
- Workflow script is the manager.
- Agents are workers.
- State lives on disk.
- Results are structured.
- Verification is a stage, not a vibe.

### `references/when-to-use.md`

Must list trigger conditions:

- More than about 20 independent items.
- Repeated experiment loops.
- Benchmark/test/build optimization.
- Broad audit.
- Migration.
- Many files or URLs.
- Need for reviewers.
- Need for resumability.

### `references/runtime-contract.md`

Must document runtime APIs, stable default run directories, `resume` behavior, and optional item-state helpers.

### `references/agent-contract.md`

Must document prompt and output contract rules.

### `references/patterns.md`

Must document these patterns:

- map-only
- map-review-write
- planner-reviewer-coder
- test-fix-loop
- benchmark-accept-reject
- auto-research-loop
- strategy-self-improvement as future pattern

### `references/safety-and-isolation.md`

Must document safety rules and destructive-operation warnings.

---

## 32. Acceptance Criteria

The MVP is complete when all of the following are true.

### Skill structure

- The `dynamic-workflow` skill folder exists.
- `SKILL.md` exists and contains trigger conditions and required behavior.
- All reference docs exist.
- Runtime file exists.
- At least four examples exist.

### Runtime

- `workflow-runtime.mjs` can be imported from an example workflow.
- `createWorkflow().run()` creates or reuses the stable workflow run directory.
- Events are appended to `events.jsonl`.
- Item state is saved to `items.json` when item-state helpers are used.
- Concurrent item-state writes are serialized in process.
- `agent()` can call a configured CLI command.
- `agent()` writes prompt, stdout, and stderr artifacts.
- `agent()` documents and respects adapter environment settings.
- `agent()` uses `jsonCommand` for structured output calls when configured.
- `agent()` validates schema-backed JSON outputs and retries transient validation failures.
- `agent()` retry behavior is defined and auditable through attempt artifacts.
- `shell()` can run a command and capture stdout/stderr/exit code.
- `parallel()` respects concurrency and returns ordered result envelopes.
- `pipeline()` processes many items with bounded concurrency and returns ordered result envelopes.
- `globFiles()` can recursively find files by extension.
- `writeReport()` writes `report.md`.

### Example workflows

- `proofread-directory.workflow.mjs` is runnable after configuring agents.
- `review-codebase.workflow.mjs` is runnable after configuring agents.
- `benchmark-optimize.workflow.mjs` demonstrates baseline/test/benchmark flow in a sandbox and does not modify the original repo.
- `auto-research-simple.workflow.mjs` demonstrates propose/change/evaluate/record flow.

### Resume

- The default run directory is stable per workflow name.
- If `resume` is true and an item is marked done in `items.json`, rerunning the same workflow can skip it.
- If `resume` is false, the workflow starts with empty item state for that invocation.
- Failed items should be marked `failed`, not `done`, and `isItemDone()` should return false for them.

### Documentation

- A coding agent should be able to read `SKILL.md` and examples, then create a new task-specific workflow without needing additional explanation.

---

## 33. Suggested Manual Test Plan

### Test 1: Fake agent

Create a fake agent script:

```js
// fake-agent.mjs
let input = "";
process.stdin.on("data", chunk => input += chunk);
process.stdin.on("end", () => {
  console.log(JSON.stringify({
    changed: false,
    correctedText: input,
    summary: "fake agent did nothing"
  }));
});
```

Create a fake reviewer script:

```js
// fake-reviewer.mjs
let input = "";
process.stdin.on("data", chunk => input += chunk);
process.stdin.on("end", () => {
  console.log(JSON.stringify({
    accept: true,
    reason: "fake reviewer accepted",
    finalText: input
  }));
});
```

Configure:

```json
{
  "agents": {
    "editor": {
      "command": "node .dynamic-workflows/fake-agent.mjs",
      "input": "stdin",
      "output": "json",
      "timeoutMs": 60000
    },
    "reviewer": {
      "command": "node .dynamic-workflows/fake-reviewer.mjs",
      "input": "stdin",
      "output": "json",
      "timeoutMs": 60000
    }
  }
}
```

Run proofread workflow on a small test directory.

Expected:

- No files changed.
- Reviewer should not be called because the fake editor returns `changed: false`.
- Events written.
- Prompts and outputs written.
- Report generated.

### Test 2: Parallelism

Create 10 fake tasks where each sleeps for 1 second. Run with concurrency 5. Expected wall time should be around 2 seconds, not 10 seconds.

### Test 3: Resume

Run proofread workflow over 3 files. Stop after 1 file manually or simulate failure. Rerun the same workflow with the default stable run directory and `resume: true`. Previously done items should be skipped.

### Test 4: Shell

Run a workflow that calls:

```bash
node -e "console.log(JSON.stringify({ok:true, metric:123}))"
```

Expected:

- `shell(..., { json: true })` returns parsed JSON.

---

## 34. Implementation Order

Recommended implementation sequence for the coding agent:

1. Create folder structure.
2. Write `SKILL.md`.
3. Write reference docs as concise markdown.
4. Implement `workflow-runtime.mjs` with file helpers and event logging.
5. Implement stable run directories, `resume`, and serialized item-state writes.
6. Implement `shell()`.
7. Implement `agent()` with prompt artifacts, retries, timeout handling, and JSON extraction.
8. Implement `parallel()` with ordered result envelopes.
9. Implement `pipeline()` with ordered result envelopes and per-item stage failure handling.
10. Implement `globFiles()`.
11. Implement `diffText()`.
12. Write `proofread-directory.workflow.mjs`.
13. Write fake-agent manual tests.
14. Write the remaining examples.
15. Update docs based on examples.

---

## 35. Important Design Constraints

Keep the MVP boring.

Prefer:

- One readable runtime file.
- Plain JavaScript ESM.
- No dependencies.
- Explicit prompts.
- Explicit contracts.
- Simple JSON files.
- Simple run artifacts.
- Examples that coding agents can copy.

Avoid:

- Premature npm package design.
- Complex plugin architecture.
- Hidden magic.
- Runtime self-modification.
- Hard-coding one agent provider.
- Provider SDKs.
- Complex JSON schema validation.

The purpose of the MVP is to validate the pattern: can a coding agent reliably create useful workflow scripts for large tasks?

---

## 36. Future Extensions After MVP

After the MVP works on several real tasks, consider extracting the runtime into an npm package.

Potential future package structure:

```text
@dynamic-workflow/core
@dynamic-workflow/cli
@dynamic-workflow/agents
```

Future features:

- Real CLI: `init`, `run`, `resume`, `report`.
- Explicit run IDs and run history management.
- Better schema validation with Zod or Ajv.
- Git worktree support.
- File locks.
- Resource locks.
- Cost/token tracking.
- HTML report.
- Human approval gates.
- Strategy module hot-swapping.
- Stronger sandboxing.
- Agent provider presets.
- TUI/monitoring UI.

Do not implement these in MVP unless absolutely necessary.
