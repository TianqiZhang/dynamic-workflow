# Dynamic Workflow

**Run large AI coding-agent tasks as inspectable JavaScript workflows.** Fan out parallel subagents, persist progress to disk, verify results before accepting, and produce audit-ready reports — with Claude Code, Codex, Pi, or any CLI agent.

Dynamic workflows move large agentic tasks out of one chat thread and into code. A workflow script owns the loop, state, fan-out, retries, verification, and report generation, while subagents handle local reasoning or local edits. Anthropic [introduced this idea](https://claude.com/blog/introducing-dynamic-workflows-in-claude-code) in Claude Code as a research preview. This repository implements the same core pattern in a portable, vendor-neutral form as a dependency-free Node.js runtime and reusable coding-agent skill.

## What You Can Do With It

- **Codebase-wide bug hunts** — review every source file in parallel, aggregate findings by severity
- **Docs proofreading at scale** — editor agent proposes fixes, reviewer agent accepts or rejects, workflow writes changes
- **Benchmark-guided optimization** — sandbox a candidate change, run tests + benchmarks, accept only if metrics improve
- **Security and correctness sweeps** — structured findings across hundreds of files with schema-validated output
- **Iterative experiment loops** — propose a hypothesis, edit code, evaluate, keep or rollback, repeat
- **Large migrations** — enumerate files, apply changes per file, verify, resume from where you left off

## Quick Start

Install the skill:

```bash
npx skills add TianqiZhang/dynamic-workflow
```

Or manually copy the `skills/dynamic-workflow/` folder into your local skills directory.

Once installed, ask your coding agent to create a workflow for your task. The agent reads `SKILL.md`, copies the runtime and a matching example into your repo under `.dynamic-workflows/`, configures `agents.json`, and runs the workflow. For example:

> "Proofread all Markdown files in docs/ using a dynamic workflow."

The agent will set up and run the workflow, then summarize the results from the generated artifacts.

After a run completes, the artifact tree looks like:

```text
.dynamic-workflows/runs/proofread-directory/
  run.json                          # run metadata (id, timestamps, cwd)
  events.jsonl                      # every agent call, shell command, and state change
  items.json                        # per-file status for resume
  report.md                         # human-readable summary (example below)
  prompts/                          # exact prompt sent to each agent
  outputs/                          # raw stdout from each agent
  errors/                           # stderr captures
  diffs/                            # proposed and accepted diffs per file
  artifacts/proposals/              # full proposed text before review
```

<details>
<summary><b>Example report output</b></summary>

```markdown
# Proofread Directory Report

- Total files: 12
- Updated: 4
- Unchanged: 6
- Rejected: 1
- Failed: 1

## Updated Files

| File              | Summary                              |
|-------------------|--------------------------------------|
| docs/getting-started.md | Fixed 3 typos, corrected grammar |
| docs/api-reference.md   | Removed duplicate sentence       |
| docs/faq.md             | Fixed broken Markdown link       |
| docs/changelog.md       | Corrected date format            |

## Rejected Files

| File          | Reason                                    |
|---------------|-------------------------------------------|
| docs/style.md | Edit rewrote tone beyond proofreading scope |
```

</details>

## How It Works

```text
┌─────────────────┐
│   current chat   │  creates, starts, monitors, summarizes
└────────┬────────┘
         │
┌────────▼────────┐
│  workflow script │  enumerates work, manages state, runs commands,
│    (your .mjs)   │  calls agents, verifies, writes reports
└────────┬────────┘
         │  fan-out with bounded concurrency
   ┌─────┼─────┬─────┐
   ▼     ▼     ▼     ▼
┌──────┐┌──────┐┌──────┐┌──────┐
│agent ││agent ││agent ││agent │  bounded reasoning, review,
│  1   ││  2   ││  3   ││  N   │  editing, or coding tasks
└──────┘└──────┘└──────┘└──────┘
```

**Code owns orchestration.** Deterministic JavaScript handles enumeration, batching, concurrency, state, shell commands, diffs, metrics, and reports. **Agents own judgment.** Subagents handle proofreading, reviewing, proposing changes, summarizing, or coding — one bounded task at a time.

## What Is In This Repo

```text
skills/dynamic-workflow/
  SKILL.md                         # Instructions for a coding agent
  runtime/workflow-runtime.mjs     # Dependency-free Node.js runtime (~900 lines)
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

dynamic_workflow_skill_mvp_tech_spec.md   # Full design spec
```

This is a skill package, not a polished CLI product. A coding agent reads the skill, copies the runtime and an example workflow into a target repo, configures local agent commands, runs the workflow, and summarizes the generated artifacts.

## Core Ideas

Every agent call defines a **contract**: `cwd` (where the agent starts), a prompt (objective, allowed/forbidden actions, acceptance criteria), and an optional `schema` (machine-readable output shape). Schema validation checks shape, not truth — the workflow still computes deterministic facts like diffs, exit codes, and metrics itself.

For **information-producing stages** (review findings, classifications, summaries), agents return schema-validated JSON that the workflow aggregates. For **file-producing stages** (code changes, refactors, optimization), agents edit files directly while the workflow snapshots before, diffs after, runs tests, and accepts or restores.

All state lives on disk — `run.json`, `events.jsonl`, `items.json`, prompts, outputs, diffs, and artifacts — making long-running work auditable and resumable without relying on chat memory.

## Built-In Agent Presets

Agents are configured in a target repo at `.dynamic-workflows/agents.json`. The snippet below is an example only; map the names to your own workflow roles.

```json
{
  "agents": {
    "primary": { "preset": "claude" },
    "secondary": { "preset": "codex" },
    "assistant": { "preset": "copilot" },
    "builder": { "preset": "pi", "timeoutMs": 1800000 }
  }
}
```

Supported presets:

- `claude`: uses `claude -p`; structured calls use `--output-format json`; schema calls use `--json-schema`.
- `codex`: uses `codex exec`; structured calls use `--json`; the runtime extracts the final `agent_message` from Codex JSONL events.
- `copilot`: uses `copilot -p -s`; it is text-first by default, and you can override `jsonCommand` or `schemaCommand` in `.dynamic-workflows/agents.json` if you need a different structured-output wrapper.
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

| Workflow | Pattern | What It Does |
|----------|---------|-------------|
| **Proofread Directory** | map → review → write | Editor agent proposes fixes per file, reviewer accepts/rejects, workflow writes changes and produces a report |
| **Review Codebase** | map → aggregate | Reviewer agent returns structured findings per source file, workflow aggregates by severity |
| **Benchmark Optimize** | sandbox → optimize → measure | Copies code to sandbox, coder agent optimizes, tests + benchmarks gate acceptance |
| **Auto Research Simple** | loop → edit → evaluate → keep/rollback | Coder agent edits target files, eval command scores the result, accepted changes accumulate |

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

## Relation To Claude Code Dynamic Workflows

Anthropic's [Claude Code dynamic workflows](https://claude.com/blog/introducing-dynamic-workflows-in-claude-code) are a product feature released in research preview on May 28, 2026. This repo is an independent, portable implementation of the same architectural idea — code for control flow, agents for judgment, disk artifacts for state, schemas for machine-consumed outputs, verification before acceptance.

Use Claude Code's built-in dynamic workflows when you want the native product experience. Use this repo when you want:

- a small runtime you can inspect and change
- workflows that run through any CLI agent, not only Claude
- explicit state files and artifacts in your repo
- schema contracts at the runtime boundary
- examples that can be copied into other agent environments
- a place to experiment with the pattern itself

The goal is not to compete with Claude Code. The goal is to make the pattern concrete, portable, and easy to reason about.

## Status

Early preview. The runtime and all four example workflows are functional and tested against real agent CLIs.

**Implemented:**

- Dependency-free Node.js ESM runtime (~900 lines)
- Stable run directories with event logs and artifacts
- Item state and resume helpers
- Bounded `parallel()` and `pipeline()`
- Shell command execution with JSON parsing
- CLI agent adapters with built-in `claude`, `codex`, and `pi` presets
- Lightweight schema validation
- Four example workflows: proofread, review, benchmark, auto-research

**Not yet implemented:**

- Standalone CLI
- Distributed workers
- Full JSON Schema validation
- Provider SDKs / token accounting
- UI

## Further Reading

- [Anthropic: Introducing dynamic workflows in Claude Code](https://claude.com/blog/introducing-dynamic-workflows-in-claude-code)
- [Runtime contract](skills/dynamic-workflow/references/runtime-contract.md)
- [Agent contract](skills/dynamic-workflow/references/agent-contract.md)
- [Patterns](skills/dynamic-workflow/references/patterns.md)
- [Safety and isolation](skills/dynamic-workflow/references/safety-and-isolation.md)
