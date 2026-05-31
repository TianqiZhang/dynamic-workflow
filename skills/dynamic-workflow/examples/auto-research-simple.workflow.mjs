import fs from "node:fs/promises";
import path from "node:path";
import {
  agent,
  appendJsonl,
  artifactName,
  createWorkflow,
  diffText,
  formatPercent,
  markdownTable,
  parseBoolean,
  parseList,
  readText,
  shell,
  writeJson,
  writeText
} from "../runtime/workflow-runtime.mjs";

const wf = createWorkflow({
  name: process.env.DW_WORKFLOW_NAME ?? "auto-research-simple",
  concurrency: 1,
  resume: false
});

await wf.run(async () => {
  const targetFiles = parseList(process.env.DW_RESEARCH_TARGET_FILES, ["src/index.js"]);
  const researchCwd = path.resolve(process.env.DW_RESEARCH_CWD ?? process.cwd());
  const evalCommand =
    process.env.DW_RESEARCH_EVAL_COMMAND ??
    'node -e "console.log(JSON.stringify({ metric: 0, higherIsBetter: true }))"';
  const iterations = Number(process.env.DW_RESEARCH_ITERATIONS ?? 3);
  const commandTimeoutMs = Number(process.env.DW_COMMAND_TIMEOUT_MS ?? 600000);
  const agentTimeoutMs = Number(process.env.DW_AGENT_TIMEOUT_MS ?? 1800000);
  const minImprovementPct = Number(process.env.DW_MIN_IMPROVEMENT_PCT ?? 0);

  const baseline = await shell(evalCommand, {
    cwd: researchCwd,
    label: "research-baseline",
    json: true,
    timeoutMs: commandTimeoutMs
  });
  let bestMetric = metricFromShell(baseline, "baseline evaluation");
  const higherIsBetter = parseBoolean(
    process.env.DW_HIGHER_IS_BETTER,
    baseline.json?.higherIsBetter ?? true
  );

  const records = [];
  for (let iteration = 1; iteration <= iterations; iteration += 1) {
    const snapshot = await snapshotFiles(researchCwd, targetFiles);
    let record;

    try {
      const editResult = await agent("coder", {
        label: `research-proposal-${iteration}`,
        cwd: researchCwd,
        timeoutMs: agentTimeoutMs,
        schema: editResultSchema(targetFiles),
        prompt: editPrompt(iteration, targetFiles, {
          researchCwd,
          evalCommand,
          bestMetric,
          higherIsBetter
        })
      });

      validateEditResult(editResult, targetFiles);
      const after = await snapshotFiles(researchCwd, targetFiles);
      const changedFiles = changedSnapshotFiles(snapshot, after);

      for (const file of changedFiles) {
        await writeText(
          path.join(wf.runDir, "diffs", `iteration-${iteration}-${artifactName(file)}.diff`),
          diffText(snapshot[file] ?? "", after[file] ?? "")
        );
      }

      if (changedFiles.length === 0) {
        record = {
          iteration,
          status: "rejected",
          hypothesis: editResult.hypothesis ?? "",
          filesChanged: [],
          metric: null,
          bestMetric,
          improvementPct: null,
          summary: editResult.summary ?? "Agent made no changes"
        };
        records.push(record);
        await appendJsonl(path.join(wf.runDir, "artifacts", "experiments.jsonl"), record);
        continue;
      }

      const evaluation = await shell(evalCommand, {
        cwd: researchCwd,
        label: `research-eval-${iteration}`,
        json: true,
        timeoutMs: commandTimeoutMs
      });
      const metric = metricFromShell(evaluation, `iteration ${iteration} evaluation`);
      const improvementPct = improvementPercent(bestMetric, metric, higherIsBetter);
      const accepted = evaluation.ok && improvementPct >= minImprovementPct;

      if (accepted) {
        bestMetric = metric;
      } else {
        await restoreSnapshot(researchCwd, snapshot);
      }

      record = {
        iteration,
        status: accepted ? "accepted" : "rejected",
        hypothesis: editResult.hypothesis ?? "",
        filesChanged: changedFiles,
        reportedFilesChanged: editResult.filesChanged ?? [],
        metric,
        bestMetric,
        improvementPct,
        summary: editResult.summary ?? ""
      };
    } catch (error) {
      await restoreSnapshot(researchCwd, snapshot);
      record = { iteration, status: "failed", error: error.message };
    }

    records.push(record);
    await appendJsonl(path.join(wf.runDir, "artifacts", "experiments.jsonl"), record);
  }

  const summary = { researchCwd, bestMetric, higherIsBetter, iterations: records };
  await writeJson(path.join(wf.runDir, "artifacts", "research-summary.json"), summary);
  await wf.writeReport(report(summary, evalCommand, targetFiles));
});

function editPrompt(iteration, targetFiles, context) {
  return `You are running a simple auto-research experiment loop.

This is iteration ${iteration}. Auto Research is only one pattern built on Dynamic Workflow. Do not edit the workflow or strategy code.

Workspace rules:
- Your current working directory is: ${context.researchCwd}
- You may inspect the repository or folder context from this working directory.
- Make one bounded direct edit to the allowed target files listed below.
- Allowed target files: ${targetFiles.join(", ")}
- Do not modify files outside the allowed target files.
- Do not edit workflow/runtime files.
- Do not commit changes.
- After editing files, return the requested structured result.

Evaluation:
- Command: ${context.evalCommand}
- Current best metric: ${context.bestMetric}
- Higher is better: ${context.higherIsBetter}

Return your hypothesis, the files you believe you changed, a short summary, and risk.
`;
}

function editResultSchema(targetFiles) {
  return {
    type: "object",
    required: ["hypothesis", "filesChanged", "summary", "risk"],
    properties: {
      hypothesis: { type: "string" },
      filesChanged: {
        type: "array",
        items: { type: "string", enum: targetFiles }
      },
      summary: { type: "string" },
      risk: { type: "string", enum: ["low", "medium", "high"] }
    },
    additionalProperties: false
  };
}

function validateEditResult(result, targetFiles) {
  if (!result || typeof result !== "object") {
    throw new Error("agent result must be a JSON object");
  }
  if (result.filesChanged !== undefined && !Array.isArray(result.filesChanged)) {
    throw new Error("agent result filesChanged must be an array when provided");
  }
  for (const file of result.filesChanged ?? []) {
    if (!targetFiles.includes(file)) {
      throw new Error(`agent reported a file outside the allowed target files: ${file}`);
    }
  }
}

async function snapshotFiles(root, files) {
  const entries = await Promise.all(
    files.map(async (file) => {
      try {
        return [file, await readText(path.join(root, file))];
      } catch (error) {
        if (error.code === "ENOENT") {
          return [file, null];
        }
        throw error;
      }
    })
  );
  return Object.fromEntries(entries);
}

function changedSnapshotFiles(before, after) {
  const files = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...files].filter((file) => before[file] !== after[file]).sort();
}

async function restoreSnapshot(root, snapshot) {
  await Promise.all(
    Object.entries(snapshot).map(async ([file, content]) => {
      const filePath = path.join(root, file);
      if (content === null) {
        await fs.rm(filePath, { force: true });
      } else {
        await writeText(filePath, content);
      }
    })
  );
}

function metricFromShell(result, label) {
  if (!result.ok) {
    throw new Error(`${label} failed: ${result.stderr || result.error || result.stdout}`);
  }
  const metric = result.json?.metric ?? result.json?.score ?? result.json?.value;
  if (typeof metric !== "number" || Number.isNaN(metric)) {
    throw new Error(`${label} did not return numeric json.metric, json.score, or json.value`);
  }
  return metric;
}

function improvementPercent(baseline, candidate, higherIsBetter) {
  if (baseline === 0) {
    if (candidate === baseline) {
      return 0;
    }
    return higherIsBetter ? Infinity : -Infinity;
  }
  const delta = higherIsBetter ? candidate - baseline : baseline - candidate;
  return (delta / Math.abs(baseline)) * 100;
}

function report(summary, evalCommand, targetFiles) {
  const accepted = summary.iterations.filter((record) => record.status === "accepted");
  const rejected = summary.iterations.filter((record) => record.status === "rejected");
  const failed = summary.iterations.filter((record) => record.status === "failed");

  return `# Simple Auto Research Report

- Evaluation command: ${evalCommand}
- Working directory: ${summary.researchCwd}
- Mode: in-place cumulative loop
- Target files: ${targetFiles.join(", ")}
- Higher is better: ${summary.higherIsBetter}
- Final best metric: ${summary.bestMetric}
- Accepted experiments: ${accepted.length}
- Rejected experiments: ${rejected.length}
- Failed experiments: ${failed.length}

## Experiments

${markdownTable(
  ["Iteration", "Status", "Metric", "Improvement", "Files Changed", "Summary"],
  summary.iterations.map((record) => [
    record.iteration,
    record.status,
    record.metric ?? "",
    formatPercent(record.improvementPct),
    (record.filesChanged ?? []).join(", "),
    record.summary ?? record.error ?? ""
  ])
)}
`;
}
