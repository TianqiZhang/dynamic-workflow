# Safety And Isolation

Dynamic workflows can run many commands and touch many files. Keep the workflow explicit and auditable.

Rules:

- Prefer workflows that read input, ask agents for structured output, and let deterministic code write results.
- Do not let agents directly modify many files unless necessary.
- For text proofreading, have agents return corrected text; workflow code writes it.
- For code changes, require tests before accepting.
- For optimization, require objective metrics before accepting.
- Do not expose secrets to agent subprocesses unless explicitly required.
- Do not put API keys in prompts.
- Be explicit about whether agent subprocesses inherit environment variables.
- Do not allow arbitrary destructive shell commands in generated workflows.
- For code-edit workflows, prefer patch or edit-plan generation over uncontrolled direct edits.
- Keep run artifacts for auditability.
- Make workflows resumable when they process many items or long loops.
- Set agent `cwd` deliberately. It defines the workspace the agent can naturally inspect and may determine which local instruction files it reads.
- Prefer passing file paths and artifact paths instead of large file contents when the agent can read files.
- Decide whether files modified by one agent can affect later workflow stages; sandbox or isolate when that would be unsafe.

The MVP runs configured commands through the shell. Treat `.dynamic-workflows/agents.json` and workflow command strings as trusted local code.

For benchmark and research workflows, copy allowed paths into `artifacts/` and run agents with `cwd` set to the sandbox. Never automatically apply sandbox changes to the original repository.
