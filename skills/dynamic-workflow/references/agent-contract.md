# Agent Contract

Every agent prompt should include:

1. Local objective.
2. Input data or paths to input data.
3. Allowed actions.
4. Forbidden actions.
5. Required output format.
6. Semantic payload fields expected by the workflow.
7. Acceptance criteria.

Keep the prompt local. Give the agent only the item or context needed for this stage, not the whole task history. Prefer passing stable paths and artifact names instead of large file contents when the agent CLI can read files from its working directory.

## Working Directory Is Context

`agent(..., { cwd })` controls where the subprocess starts. This matters because many local agent CLIs treat the current working directory as the workspace and may read local instruction files such as `AGENTS.md`, repository metadata, config files, or tool state from that tree.

Choose `cwd` deliberately:

- Use the repository root when the agent should see normal project context and root-level instructions.
- Use a sandbox directory when the agent may edit files but must not touch the original repo.
- Use a narrow subdirectory when the agent should focus on a module and avoid unrelated context.
- Pass absolute or cwd-relative artifact paths when a later stage needs outputs from an earlier stage.

The runtime does not infer context. The workflow decides `cwd`, prompt text, artifact paths, and allowed file boundaries.

Sandboxing is optional. For iterative research or broad code work, running agents in the real repo root can be the right default because they can inspect complete context and later iterations can read accepted changes from the working tree. Use sandboxing when isolation matters more than continuity.

## Prompt Size

Do not paste entire files into prompts by default. If the agent has file-read capability, pass the file path and the rules. Put shared context in files or artifacts that the agent can read. Pass content inline only when the agent command has no file tools, the snippet is small, or the exact text must be frozen as stage input.

For review stages, prefer writing proposed edits, diffs, summaries, or metrics to artifacts and passing those artifact paths.

## Output Or Edit Boundary

Choose the stage boundary deliberately.

Use structured output when the stage produces information:

- findings for aggregation
- labels, scores, or classifications
- summaries
- plans or hypotheses
- extracted fields
- proposals that another agent or human must review

Use direct edits when the stage produces code or file changes:

- coding tasks
- refactors
- optimization experiments
- multi-file changes
- research loops where later iterations should see accepted changes

For direct-edit stages, the workflow should still control the loop. It should set `cwd`, state the allowed write paths, snapshot files before the agent runs, compute diffs afterward, run tests or evaluation commands, record artifacts, and restore rejected or failed changes when appropriate.

## Context Planning

Before writing a complex workflow, decide:

- What global context is stable enough to write to files.
- What state must be passed directly from one stage to another.
- What each agent can see through `cwd` and local instruction files.
- What each agent is allowed to modify.
- Whether files modified by one agent can affect later workflow code or agent behavior.
- Whether that effect should be avoided through sandboxing or intentionally used as part of the workflow.

Prefer schema-backed JSON output. Put the machine-readable shape in `agent(..., { schema })`; keep the prompt focused on objective, context, allowed actions, forbidden actions, and acceptance criteria. When a schema is provided, the runtime asks for JSON, parses exact JSON or common wrapped JSON, validates the result, and retries parse or validation failures when `retries` allows it.

Schemas are shape contracts, not truth contracts. They can require a `filesChanged` array to exist, but they cannot prove those files were actually modified. Keep using workflow-computed facts for deterministic claims.

Example:

```text
You are proofreading one Markdown file.

File: docs/a.md

Context:
- Your current working directory is the repository root.
- Read the file from the path above.

Rules:
- Fix spelling and grammar errors.
- Preserve meaning.
- Preserve Markdown structure.
- Do not modify code blocks.
- Do not rewrite style unnecessarily.
- Return the corrected full file text and a short summary.
```

And call the agent with a schema:

```js
const edit = await agent("editor", {
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

In this pattern, `correctedText` is the payload. The schema validates that the field exists and is a string. The workflow still determines whether anything changed by comparing that payload against the original text.

## Output Trust Boundaries

Treat agent output fields differently based on what kind of contract they represent.

Payload fields are the actual product of the agent stage. Examples:

- `correctedText` from a proofreading stage
- `findings` from a review stage
- `plan` from a planning stage
- `hypothesis` from a research stage
- `reason` from a reviewer stage

Self-report fields describe what the agent thinks it did. Examples:

- `changed`
- `filesChanged`
- `count`
- `testsPassed`
- `confidence`

Self-reports are useful for summaries and audit trails, but they can be wrong. The agent may hallucinate a count, misjudge whether text changed, list files it did not modify, or report a test result that the workflow has not actually run.

Workflow-computed facts are facts the workflow can verify mechanically. Examples:

- whether text changed
- actual changed files
- diffs
- command exit codes
- parsed metrics
- report counts

When the workflow can compute a fact deterministically, it should compute it instead of trusting an agent self-report. For example, compare `correctedText` against the original instead of trusting a `changed` flag, diff files before and after instead of trusting `filesChanged`, and run tests directly instead of trusting `testsPassed`.

It is still fine for agents to return self-report fields. Keep them separate from workflow-computed fields when both are useful. For example, `auto-research-simple` records `filesChanged` from the workflow's own snapshot diff and `reportedFilesChanged` from the agent's JSON.

Reserve unverified agent fields for things that are genuinely semantic or judgment-based, such as summaries, hypotheses, risk notes, severity, confidence, or review reasons.

Agent subprocesses are configured in `.dynamic-workflows/agents.json`:

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
    }
  }
}
```

`inheritEnv: true` is convenient for local CLIs, but it may expose secrets to subprocesses. Set it to `false` unless the agent command needs the current environment. When inheritance is disabled, use absolute command paths or provide `PATH` in `env`.

Do not put API keys, tokens, passwords, or unrelated secrets in prompts.
