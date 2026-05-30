# When To Use Dynamic Workflow

Use Dynamic Workflow when the task has one or more of these signals:

- More than about 20 independent items.
- Repeated experiment loops.
- Benchmark, test, or build optimization.
- Broad code, document, issue, URL, or artifact audit.
- Migration across many files.
- Many files or URLs that can be processed independently.
- Need for reviewer agents or verification stages.
- Need for resumability after interruption.
- Need to keep prompts, outputs, diffs, and decisions auditable.
- The task would otherwise require the chat to remember too much intermediate state.

Do not use it for a small one-off edit, a single command, a short explanation, or a task where normal direct coding is simpler and safer.
