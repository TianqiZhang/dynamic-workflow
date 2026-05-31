# Runtime Contract

The runtime is a single dependency-free Node.js ESM file. Copy it to:

```text
.dynamic-workflows/runtime/workflow-runtime.mjs
```

Workflow scripts usually live in:

```text
.dynamic-workflows/workflows/<task-name>.workflow.mjs
```

They import the runtime with:

```js
import {
  createWorkflow,
  agent,
  shell,
  parallel,
  pipeline,
  globFiles,
  readText,
  writeText,
  diffText
} from "../runtime/workflow-runtime.mjs";
```

## `createWorkflow(options)`

```js
const wf = createWorkflow({
  name: "proofread-directory",
  concurrency: 4,
  resume: true
});
```

Defaults:

- `concurrency`: `4`
- `resume`: `true`
- `runDir`: `.dynamic-workflows/runs/${safeName(name)}`

The default run directory is stable per workflow name. Re-running the same workflow reuses the same directory and can resume from `items.json`.

`resume: true` loads existing item state when present. `resume: false` starts with empty item state for this invocation and overwrites `items.json` on the first item-state write.

The runtime does not delete old run artifacts automatically. Remove the run directory yourself or pass a custom `runDir` when a clean run is required.

## Workflow Object

`createWorkflow()` returns:

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

Use item-state helpers only for workflows with stable item keys. `isItemDone(key)` returns true only when the item has top-level `status: "done"`. Failed items are retried on the next resumed run unless the workflow chooses another policy.

Item-state writes are serialized within one Node.js process so parallel workers do not overwrite each other. Cross-process locking is not implemented.

## `agent(agentName, options)`

```js
const result = await agent("editor", {
  label: "edit:docs/a.md",
  cwd: process.cwd(),
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

The runtime loads `.dynamic-workflows/agents.json`, writes the prompt under `prompts/`, runs the configured command, captures stdout and stderr, writes artifacts, and returns either parsed JSON or stdout text.

When `schema` is provided, the runtime treats the call as structured output even if the adapter's default `output` is `text`: it appends the schema to the prompt, parses JSON from stdout, validates the result, and retries transient parse or validation failures according to `retries`.

`cwd` is part of the agent context contract. It controls the subprocess working directory, which many CLI agents use as their workspace and source of local instructions. Set it explicitly when the agent should run in the repo root, a sandbox, or a narrow module directory.

Supported adapter fields:

- `preset`: built-in adapter preset: `claude`, `codex`, or `pi`.
- `command`: shell command string.
- `jsonCommand`: optional shell command string used instead of `command` for structured output calls. Use this for CLI flags such as `--json` or `--output-format json` when the local agent supports them.
- `schemaCommand`: optional shell command string used instead of `jsonCommand` when `schema` is provided. Use `{schema}` to inject the shell-quoted schema JSON.
- `input`: `stdin` or `file`.
- `output`: `text`, `json`, `codex-json`, or `claude-json`.
- `timeoutMs`: default command timeout.
- `inheritEnv`: default `true`.
- `env`: extra environment variables.

Built-in presets:

```json
{
  "agents": {
    "editor": { "preset": "claude" },
    "reviewer": { "preset": "codex" },
    "coder": { "preset": "pi", "timeoutMs": 1800000 }
  }
}
```

Preset defaults can be overridden by setting any adapter field on the same object. A string value is shorthand, so `"editor": "codex"` is equivalent to `"editor": { "preset": "codex" }`.

For `input: "file"`, the command must include `{promptFile}`. The runtime replaces it with a shell-quoted absolute prompt-file path.

Use `output: "codex-json"` for `codex exec --json` event streams. The runtime reads the last completed `agent_message` event and then applies normal schema parsing and validation when `schema` is provided.

Use `output: "claude-json"` for `claude -p --output-format json`. The runtime returns `structured_output` when present, otherwise `result`.

Supported schema keywords are intentionally small: `type`, `required`, `properties`, `items`, `enum`, `additionalProperties`, `nullable`, `minItems`, `maxItems`, `minLength`, and `maxLength`. `type` may be a string or an array of strings. This validates shape only; workflows should still compute deterministic facts such as changed files, diffs, command exit codes, and parsed metrics themselves.

The MVP runs command strings through the shell. Treat adapter commands as trusted local configuration, not untrusted user input.

## `shell(command, options)`

```js
const result = await shell("npm test -- --json", {
  label: "test",
  timeoutMs: 120000,
  json: true
});
```

Returns:

```js
{
  ok,
  exitCode,
  stdout,
  stderr,
  json,
  durationMs
}
```

When `json: true`, stdout is parsed as JSON, with loose extraction for common agent-style wrappers.

## `parallel(tasks, options)`

Runs async task functions with bounded concurrency and preserves input order. With `stopOnError: false`, every result is an envelope:

```js
{ "ok": true, "index": 0, "value": "..." }
{ "ok": false, "index": 1, "error": "..." }
```

With `stopOnError: true`, the first observed task failure throws and the runtime stops scheduling new tasks. Tasks that are already running are not cancelled or killed.

## `pipeline(items, stages, options)`

Runs a sequence of async stages for each item. Items are processed concurrently, but stages for one item are sequential. With `stopOnError: false`, failures identify the item index and zero-based failed stage.

With `stopOnError: true`, the first observed item failure throws and the runtime stops scheduling new item pipelines. Item pipelines that are already running are not cancelled or killed.

## File Helpers

The runtime exports:

- `globFiles(options)`
- `readText(filePath)`
- `writeText(filePath, content)`
- `appendText(filePath, content)`
- `readJson(filePath, fallback)`
- `writeJson(filePath, value)`
- `appendJsonl(filePath, value)`
- `ensureDir(dirPath)`
- `fileExists(filePath)`
- `safeName(name)`
- `artifactName(label)`
- `diffText(before, after)`
- `validateSchema(value, schema)` - return schema validation errors for the runtime's lightweight schema subset
- `parseList(envValue, fallback)` - split comma-separated env strings
- `parseBoolean(envValue, fallback)` - accept `1`/`true`/`yes`/`y`
- `formatPercent(value, { whenNullish })` - format numbers as `12.34%`
- `markdownTable(headers, rows)` - render a Markdown table; returns `_None._` for empty rows

Use `safeName(name)` for stable workflow names and run directories. Use `artifactName(label)` for prompt, output, shell, diff, and other artifact files because it appends a short hash to avoid collisions between labels such as `Foo.md` and `foo.md`.
