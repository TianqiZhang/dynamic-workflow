# Patterns

## Map Only

Use for read-only classification or summarization. Enumerate items, call one agent per item with a deliberate `cwd` and item path, store structured results, and aggregate a report.

## Map Review Write

Use when edits need verification. An editor agent reads the target path from its working directory and proposes a full replacement, patch, or structured edit. The workflow writes the proposal and diff to artifacts. A reviewer agent reads the original file and proposal artifacts, then checks the proposal. Deterministic workflow code writes accepted changes and records rejected changes.

## Planner Reviewer Coder

Use for larger code tasks. A planner proposes small units, a reviewer checks scope and risk, then a coder performs one bounded unit at a time. For coding stages, prefer direct edits in the configured `cwd`; the workflow snapshots, diffs, tests, records, and restores when needed. Tests or static checks gate acceptance.

## Test Fix Loop

Use when a command fails and the task is to converge on green tests. The workflow runs the failing command, sends relevant output to a coder agent, lets the coder edit files directly within allowed paths, reruns the command, and stops at a max iteration count or success.

## Benchmark Accept Reject

Use when objective metrics matter. The workflow records a baseline, creates a sandbox, asks an agent for one optimization, runs tests and benchmarks, computes improvement, writes a candidate diff, and accepts or rejects based on configured thresholds.

## Auto Research Loop

Use for small experiment loops. An agent proposes a hypothesis, directly edits allowed files in the current repo or configured working directory, a shell command evaluates it, and the workflow records the result. Accepted changes remain in place so the next iteration can inspect the accumulated state. Rejected or failed changes can be restored from per-iteration snapshots. Keep strategy simple in the MVP.

## Structured Output Pattern

Use when the agent stage produces information rather than file changes. Examples include audit findings, summaries, classifications, extracted fields, plans, hypotheses, or review decisions. The workflow aggregates the JSON outputs or passes them to later agents.

## Direct Edit Pattern

Use when the agent stage produces code or file changes. The agent edits allowed files directly in `cwd`. The workflow snapshots before the edit, computes diffs afterward, runs verification, records artifacts, and restores rejected or failed changes.

## Strategy Self Improvement Future Pattern

Do not fully implement self-modifying workflows in the MVP.

The future pattern is:

```text
root workflow: stable, not edited during current run
strategy modules: allowed to be edited by agents after validation
target files: edited as part of experiments
```

Agents may propose edits to strategy modules for the next generation, but the root workflow should not mutate itself while running.

## Context Boundary Planning

For complex workflows, sketch the context boundary first. Decide each agent's `cwd`, the instruction files it may see, the artifacts it reads, the files it may modify, and whether those modifications can influence later stages. Prefer the repo or folder root when full context and cumulative state matter. Use sandbox directories when agent writes must not affect the root workflow or original repo.
