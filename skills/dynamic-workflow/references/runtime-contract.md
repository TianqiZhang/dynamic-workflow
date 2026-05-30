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
  prompt,
  retries: 1
});
```

The runtime loads `.dynamic-workflows/agents.json`, writes the prompt under `prompts/`, runs the configured command, captures stdout and stderr, writes artifacts, and returns either parsed JSON or stdout text based on the adapter's `output`.

Supported adapter fields:

- `command`: shell command string.
- `input`: `stdin` or `file`.
- `output`: `text` or `json`.
- `timeoutMs`: default command timeout.
- `inheritEnv`: default `true`.
- `env`: extra environment variables.

For `input: "file"`, the command must include `{promptFile}`. The runtime replaces it with a shell-quoted absolute prompt-file path.

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
- `parseList(envValue, fallback)` - split comma-separated env strings
- `parseBoolean(envValue, fallback)` - accept `1`/`true`/`yes`/`y`
- `formatPercent(value, { whenNullish })` - format numbers as `12.34%`
- `markdownTable(headers, rows)` - render a Markdown table; returns `_None._` for empty rows

Use `safeName(name)` for stable workflow names and run directories. Use `artifactName(label)` for prompt, output, shell, diff, and other artifact files because it appends a short hash to avoid collisions between labels such as `Foo.md` and `foo.md`.
