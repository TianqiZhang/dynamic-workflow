# Agent Contract

Every agent prompt should include:

1. Local objective.
2. Input data or paths to input data.
3. Allowed actions.
4. Forbidden actions.
5. Required output format.
6. JSON shape when possible.
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

## Prompt Size

Do not paste entire files into prompts by default. If the agent has file-read capability, pass the file path and the rules. Put shared context in files or artifacts that the agent can read. Pass content inline only when the agent command has no file tools, the snippet is small, or the exact text must be frozen as stage input.

For review stages, prefer writing proposed edits, diffs, summaries, or metrics to artifacts and passing those artifact paths.

## Context Planning

Before writing a complex workflow, decide:

- What global context is stable enough to write to files.
- What state must be passed directly from one stage to another.
- What each agent can see through `cwd` and local instruction files.
- What each agent is allowed to modify.
- Whether files modified by one agent can affect later workflow code or agent behavior.
- Whether that effect should be avoided through sandboxing or intentionally used as part of the workflow.

Prefer JSON output. The runtime can parse exact JSON, fenced JSON, or the first valid object or array in stdout. It does not validate JSON Schema in the MVP, so the prompt must state the required shape clearly.

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
- Return JSON only.

Return shape:
{
  "changed": boolean,
  "correctedText": string,
  "summary": string
}
```

Agent subprocesses are configured in `.dynamic-workflows/agents.json`:

```json
{
  "agents": {
    "editor": {
      "command": "claude -p --output-format json",
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
