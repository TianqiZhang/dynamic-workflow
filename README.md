# Dynamic Workflow

A small, inspectable implementation of the dynamic workflow pattern for local coding agents.

Dynamic workflows are a way to move large agentic tasks out of one chat thread and into code: a workflow script owns the loop, state, fan-out, retries, verification, and report generation, while subagents handle local reasoning or local edits. Anthropic recently introduced this idea in Claude Code as a research preview: Claude can write orchestration scripts, fan work out across many parallel subagents, verify results, and persist progress outside the main conversation.

This repository explores the same core pattern in a portable form. It is not an official Anthropic implementation. It is a Codex/Claude/Pi-friendly skill plus a dependency-free Node.js runtime that can be copied into a target repo and adapted by a coding agent.

## Why This Exists

Single-chat agents are awkward for work that has hundreds of items, long loops, repeated verification, or too much intermediate state. They either overload context, lose track of decisions after compaction, or force the human to manually coordinate each step.

Dynamic workflow flips the shape:

```text
current chat
  creates, starts, monitors, summarizes

workflow script
  enumerates work, manages state, runs commands, calls agents, verifies, reports

subagents
  do bounded reasoning, review, editing, summarization, or coding tasks
```

The workflow owns the control flow. Agents own fuzzy judgment and local changes.

## What Is In This Repo

```text
skills/dynamic-workflow/
  SKILL.md                         # Instructions for a coding agent
  runtime/workflow-runtime.mjs     # Dependency-free Node.js runtime
  examples/
    proofread-directory.workflow.mjs
    review-codebase.workflow.mjs
    benchmark-optimize.workflow.mjs
    auto-research-simple.workflow.mjs
  references/
    concepts.md
    runtime-contract.md
    agent-contract.md
    patterns.md
    safety-and-isolation.md
    when-to-use.md

dynamic_workflow_skill_mvp_tech_spec.md
```

This is a skill package, not a polished CLI product. A coding agent reads the skill, copies the runtime and an example workflow into a target repo, configures local agent commands, runs the workflow, and summarizes the generated artifacts.

## Core Ideas

### 1. Code Owns Orchestration

Use deterministic JavaScript for:

- enumerating files, tests, modules, issues, candidates, or URLs
- batching and bounded concurrency
- resumable item state
- shell commands
- diff generation
- metrics and acceptance checks
- artifact and report writing

Use agents for:

- proofreading one file
- reviewing one module
- proposing or applying one bounded code change
- summarizing one result
- generating a hypothesis
- judging whether a proposed change should be accepted

### 2. Agent Calls Have Contracts

Every agent call should define:

- `cwd`: where the agent starts and what context it naturally sees
- prompt: objective, paths, allowed actions, forbidden actions, acceptance criteria
- `schema`: machine-readable output shape when the workflow needs to consume the result

Example:

```js
const result = await agent("reviewer", {
  label: `review:${file}`,
  cwd: process.cwd(),
  prompt: `Review ${file} for concrete correctness issues. Do not edit files.`,
  schema: {
    type: "object",
    required: ["findings"],
    properties: {
      findings: {
        type: "array",
        items: {
          type: "object",
          required: ["severity", "file", "title", "description", "suggestion"],
          properties: {
            severity: { type: "string", enum: ["low", "medium", "high"] },
            file: { type: "string" },
            line: { type: ["integer", "null"] },
            title: { type: "string" },
            description: { type: "string" },
            suggestion: { type: "string" }
          },
          additionalProperties: false
        }
      }
    },
    additionalProperties: false
  }
});
```

Schema validation checks shape, not truth. The workflow should still compute deterministic facts itself: actual changed files, diffs, command exit codes, parsed metrics, report counts, and whether text changed.

### 3. Direct Edits Are Fine When The Stage Produces Files

For code changes, refactors, optimization, and research loops, it is often less fragile to let the subagent edit files directly. The workflow should snapshot first, run the agent in a deliberate `cwd`, compute diffs after, run tests or metrics, and accept or restore.

For information-producing stages, structured output is better: findings, classifications, summaries, plans, review decisions, and extracted fields should be returned as JSON and aggregated by the workflow.

### 4. State Lives On Disk

Workflow runs write to:

```text
.dynamic-workflows/runs/<workflow-name>/
  run.json
  events.jsonl
  items.json
  report.md
  prompts/
  outputs/
  errors/
  shell/
  diffs/
  artifacts/
```

This makes long-running work auditable and resumable. The chat does not need to remember hundreds of intermediate outputs.

## Built-In Agent Presets

Agents are configured in a target repo at `.dynamic-workflows/agents.json`.

```json
{
  "agents": {
    "editor": { "preset": "claude" },
    "reviewer": { "preset": "codex" },
    "coder": { "preset": "pi", "timeoutMs": 1800000 }
  }
}
```

Supported presets:

- `claude`: uses `claude -p`; structured calls use `--output-format json`; schema calls use `--json-schema`.
- `codex`: uses `codex exec`; structured calls use `--json`; the runtime extracts the final `agent_message` from Codex JSONL events.
- `pi`: uses `pi -p`; schema calls rely on the prompt contract plus runtime validation.

Any preset can be overridden:

```json
{
  "agents": {
    "coder": {
      "preset": "codex",
      "command": "codex exec --ephemeral --skip-git-repo-check -s workspace-write -",
      "jsonCommand": "codex exec --ephemeral --skip-git-repo-check -s workspace-write --json -",
      "timeoutMs": 1800000
    }
  }
}
```

By default, adapters inherit the local environment for CLI compatibility. That is convenient, but it can expose secrets to subprocesses. Set `inheritEnv: false` and provide a narrow `env` when needed.

## Example Workflows

### Proofread Directory

Maps over Markdown/text files. An editor agent proposes corrected full text; a reviewer agent accepts or rejects; the workflow writes accepted changes and produces a report.

Good for:

- docs cleanup
- style-preserving proofreading
- large folders of Markdown files

### Review Codebase

Maps over source files. A reviewer agent returns structured findings; the workflow aggregates by severity.

Good for:

- broad bug hunts
- security or correctness sweeps
- missing-test audits

### Benchmark Optimize

Copies target paths to a sandbox, asks a coder agent for one optimization candidate, runs tests and benchmarks, computes improvement, and writes a candidate diff.

Good for:

- objective performance experiments
- isolated candidate evaluation
- code changes that should not touch the original repo until accepted

### Auto Research Simple

Runs an in-place experiment loop. A coder agent edits allowed target files directly, a shell command evaluates the result, accepted changes remain for later iterations, and rejected changes are restored from snapshots.

Good for:

- iterative prompt/heuristic/code experiments
- small optimization loops
- cases where later iterations should see previous accepted changes

## Quick Start

In a target repository:

```bash
mkdir -p .dynamic-workflows/runtime .dynamic-workflows/workflows
cp /path/to/dynamic-workflow/skills/dynamic-workflow/runtime/workflow-runtime.mjs \
  .dynamic-workflows/runtime/workflow-runtime.mjs
cp /path/to/dynamic-workflow/skills/dynamic-workflow/examples/proofread-directory.workflow.mjs \
  .dynamic-workflows/workflows/proofread-directory.workflow.mjs
```

Create `.dynamic-workflows/agents.json`:

```json
{
  "agents": {
    "editor": { "preset": "codex" },
    "reviewer": { "preset": "codex" }
  }
}
```

Run:

```bash
DW_PROOFREAD_ROOT=docs node .dynamic-workflows/workflows/proofread-directory.workflow.mjs
```

Inspect:

```bash
sed -n '1,160p' .dynamic-workflows/runs/proofread-directory/report.md
sed -n '1,20p' .dynamic-workflows/runs/proofread-directory/events.jsonl
```

## Minimal Workflow Shape

```js
import {
  agent,
  createWorkflow,
  globFiles,
  markdownTable,
  pipeline
} from "../runtime/workflow-runtime.mjs";

const wf = createWorkflow({
  name: "check-docs",
  concurrency: 4,
  resume: true
});

const schema = {
  type: "object",
  required: ["file", "hasIssue", "summary"],
  properties: {
    file: { type: "string" },
    hasIssue: { type: "boolean" },
    summary: { type: "string" }
  },
  additionalProperties: false
};

await wf.run(async () => {
  const files = await globFiles({ root: "docs", extensions: [".md"] });
  const pending = files.filter((file) => !wf.isItemDone(file));

  await pipeline(pending, [checkFile], {
    concurrency: wf.concurrency,
    stopOnError: false
  });

  const rows = files.map((file) => {
    const state = wf.getItemState(file);
    return [file, state?.result?.hasIssue ?? "", state?.result?.summary ?? ""];
  });

  await wf.writeReport(`# Docs Check\n\n${markdownTable(["File", "Issue", "Summary"], rows)}\n`);
});

async function checkFile(file) {
  await wf.setItemState(file, { status: "running" });
  const result = await agent("checker", {
    label: `check:${file}`,
    cwd: process.cwd(),
    schema,
    prompt: `Read ${file}. Return whether it has a spelling or grammar issue. Do not edit files.`
  });
  await wf.markItemDone(file, result);
  return result;
}
```

## When To Use This Pattern

Use dynamic workflow when the task is:

- many independent items
- parallelizable
- long-running
- verification-heavy
- too large for one model context
- resumable by natural item keys
- better summarized from artifacts than from chat memory

Do not use it for a small one-off edit, a single question, or a task where writing orchestration code would cost more than doing the work directly.

## Safety Model

This runtime intentionally keeps safety explicit rather than magical:

- Agent commands are trusted local configuration.
- Commands run through the shell.
- Agent subprocesses may inherit your environment.
- `cwd` defines the workspace context the agent naturally sees.
- The workflow must define allowed write boundaries in the prompt.
- For direct edits, snapshot and diff before accepting.
- For high-stakes changes, run tests, benchmarks, or reviewer stages before writing results.

The point is not to pretend subagents are perfectly reliable. The point is to make the orchestration auditable and to compute the facts that can be computed.

## Relation To Anthropic Dynamic Workflows

Anthropic's Claude Code dynamic workflows are a product feature released in research preview on May 28, 2026. Anthropic describes them as Claude dynamically writing orchestration scripts, fanning work out across tens to hundreds of parallel subagents, checking work, saving progress, and coordinating results outside the conversation.

This repo is an independent, small implementation of the same architectural idea:

- code for control flow
- agents for judgment and edits
- disk artifacts for state
- schemas for machine-consumed outputs
- verification before acceptance

It is intentionally vendor-neutral. It can call Claude, Codex, Pi, or any CLI agent that can read a prompt and produce text or JSON.

## Why Not Just Use Built-In Claude Workflows?

Use Claude Code's built-in dynamic workflows when you want the native product experience.

Use this repo when you want:

- a small runtime you can inspect and change
- workflows that run through any CLI agent, not only Claude
- explicit state files and artifacts in your repo
- schema contracts at the runtime boundary
- examples that can be copied into other agent environments
- a place to experiment with the pattern itself

The goal is not to compete with Claude Code. The goal is to make the pattern concrete, portable, and easy to reason about.

## Current Status

MVP / research code.

Implemented:

- dependency-free Node.js runtime
- stable run directories
- event logs and artifacts
- item state and resume helpers
- bounded `parallel()` and `pipeline()`
- shell command execution
- CLI agent adapters
- built-in `claude`, `codex`, and `pi` presets
- lightweight schema validation
- example workflows for proofreading, review, benchmark optimization, and auto research

Not implemented:

- standalone CLI
- distributed workers
- durable database
- full JSON Schema
- provider SDKs
- token/cost accounting
- UI

## Further Reading

- [Anthropic: Introducing dynamic workflows in Claude Code](https://claude.com/blog/introducing-dynamic-workflows-in-claude-code)
- [Runtime contract](skills/dynamic-workflow/references/runtime-contract.md)
- [Agent contract](skills/dynamic-workflow/references/agent-contract.md)
- [Patterns](skills/dynamic-workflow/references/patterns.md)
- [Safety and isolation](skills/dynamic-workflow/references/safety-and-isolation.md)
