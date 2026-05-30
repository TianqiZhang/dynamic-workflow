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

## Required Behavior

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

## Key Principle

The workflow owns the loop. Agents own local reasoning or local edits. The current chat session only creates, starts, monitors, and summarizes the workflow.

## Default Implementation Sequence

1. Copy `runtime/workflow-runtime.mjs` into `.dynamic-workflows/runtime/workflow-runtime.mjs`.
2. Create `.dynamic-workflows/agents.json` if missing and adapt the commands to the available local agent CLIs.
3. Pick the closest example from `examples/` and copy it to `.dynamic-workflows/workflows/<task-name>.workflow.mjs`.
4. Make the workflow enumerate inputs deterministically.
5. Make each agent prompt specify objective, input, allowed actions, forbidden actions, required output shape, and acceptance criteria.
6. Use `wf.isItemDone(key)` and `wf.markItemDone(key, result)` for resumable item workflows.
7. Run with `node .dynamic-workflows/workflows/<task-name>.workflow.mjs`.
8. Inspect `.dynamic-workflows/runs/<task-name>/report.md`, `events.jsonl`, and artifacts before summarizing.

## References

Read these before writing a workflow:

- `references/concepts.md`
- `references/when-to-use.md`
- `references/runtime-contract.md`
- `references/agent-contract.md`
- `references/patterns.md`
- `references/safety-and-isolation.md`

Use examples as templates, not as a hidden framework.

## Safety And State

The default agent adapter inherits environment variables for local CLI compatibility. That can expose secrets to subprocesses. Set `inheritEnv: false` in `.dynamic-workflows/agents.json` when a workflow does not need the user's environment; use absolute command paths or provide `PATH` in `env` when environment inheritance is disabled.

Do not let generated workflows run arbitrary destructive commands. For code edits, prefer sandboxed copies, explicit allowed paths, tests, objective metrics, and auditable diffs.
