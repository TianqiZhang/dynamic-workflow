# Patterns

## Map Only

Use for read-only classification or summarization. Enumerate items, call one agent per item with a deliberate `cwd` and item path, store structured results, and aggregate a report.

## Map Review Write

Use when edits need verification. An editor agent reads the target path from its working directory and proposes a full replacement, patch, or structured edit. The workflow writes the proposal and diff to artifacts. A reviewer agent reads the original file and proposal artifacts, then checks the proposal. Deterministic workflow code writes accepted changes and records rejected changes.

## Planner Reviewer Coder

Use for larger code tasks. A planner proposes small units, a reviewer checks scope and risk, then a coder performs one bounded unit at a time. Tests or static checks gate acceptance.

## Test Fix Loop

Use when a command fails and the task is to converge on green tests. The workflow runs the failing command, sends relevant output to a coder agent, reruns the command, and stops at a max iteration count or success.

## Benchmark Accept Reject

Use when objective metrics matter. The workflow records a baseline, creates a sandbox, asks an agent for one optimization, runs tests and benchmarks, computes improvement, writes a candidate diff, and accepts or rejects based on configured thresholds.

## Auto Research Loop

Use for small experiment loops. An agent proposes a hypothesis and one bounded change, deterministic code applies it in a sandbox, a shell command evaluates it, and the workflow records the result. Keep strategy simple in the MVP.

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

For complex workflows, sketch the context boundary first. Decide each agent's `cwd`, the instruction files it may see, the artifacts it reads, the files it may modify, and whether those modifications can influence later stages. Use sandbox directories when agent writes must not affect the root workflow or original repo.
