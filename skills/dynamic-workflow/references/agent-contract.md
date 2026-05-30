# Agent Contract

Every agent prompt should include:

1. Local objective.
2. Input data.
3. Allowed actions.
4. Forbidden actions.
5. Required output format.
6. JSON shape when possible.
7. Acceptance criteria.

Keep the prompt local. Give the agent only the item or context needed for this stage, not the whole task history.

Prefer JSON output. The runtime can parse exact JSON, fenced JSON, or the first valid object or array in stdout. It does not validate JSON Schema in the MVP, so the prompt must state the required shape clearly.

Example:

```text
You are proofreading one Markdown file.

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
