# Concepts

Dynamic Workflow separates orchestration from judgment.

The current chat is not the worker. It should not hold hundreds of intermediate decisions, file contents, retries, or partial results in memory. The chat creates the workflow, starts it, monitors it, and summarizes artifacts.

The workflow script is the manager. It enumerates inputs, batches work, controls concurrency, persists state, writes artifacts, runs tests, compares metrics, and produces a report.

Agents are workers. They handle local reasoning: proofreading one file, reviewing one module, proposing one optimization, summarizing one result, or suggesting one edit.

State lives on disk. A resumable workflow records progress in `.dynamic-workflows/runs/<workflow-name>/items.json`, events in `events.jsonl`, and larger outputs under `prompts/`, `outputs/`, `errors/`, `shell/`, `diffs/`, and `artifacts/`.

Results are structured. Prefer schema-validated JSON outputs from agents so deterministic workflow code can decide what to write, skip, retry, accept, or reject without parsing prose.

Verification is a stage, not a vibe. A reviewer prompt, test command, benchmark command, or deterministic acceptance check should be part of the workflow before changes are accepted.
