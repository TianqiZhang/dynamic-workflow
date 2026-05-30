import fs from "node:fs/promises";
import path from "node:path";
import {
  agent,
  appendJsonl,
  artifactName,
  createWorkflow,
  diffText,
  ensureDir,
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
  const evalCommand =
    process.env.DW_RESEARCH_EVAL_COMMAND ??
    'node -e "console.log(JSON.stringify({ metric: 0, higherIsBetter: true }))"';
  const iterations = Number(process.env.DW_RESEARCH_ITERATIONS ?? 3);
  const commandTimeoutMs = Number(process.env.DW_COMMAND_TIMEOUT_MS ?? 600000);
  const agentTimeoutMs = Number(process.env.DW_AGENT_TIMEOUT_MS ?? 1800000);
  const minImprovementPct = Number(process.env.DW_MIN_IMPROVEMENT_PCT ?? 0);

  const sandbox = path.join(wf.runDir, "artifacts", "research-sandbox");
  await fs.rm(sandbox, { recursive: true, force: true });
  await ensureDir(sandbox);

  await Promise.all(
    targetFiles.map(async (file) => {
      try {
        await fs.cp(file, path.join(sandbox, file), { recursive: true });
      } catch (error) {
        if (error.code === "ENOENT") {
          throw new Error(`Configured research target does not exist: ${file}`);
        }
        throw error;
      }
    })
  );

  const baseline = await shell(evalCommand, {
    cwd: sandbox,
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
    const snapshot = await snapshotFiles(sandbox, targetFiles);
    let record;

    try {
      const proposal = await agent("coder", {
        label: `research-proposal-${iteration}`,
        cwd: sandbox,
        timeoutMs: agentTimeoutMs,
        prompt: proposalPrompt(iteration, targetFiles, await fileContext(sandbox, targetFiles), {
          evalCommand,
          bestMetric,
          higherIsBetter
        })
      });

      validateProposal(proposal, targetFiles);
      const targetFile = proposal.targetFile;
      const targetPath = path.join(sandbox, targetFile);
      const before = snapshot[targetFile] ?? "";
      await writeText(targetPath, proposal.newText);

      const evaluation = await shell(evalCommand, {
        cwd: sandbox,
        label: `research-eval-${iteration}`,
        json: true,
        timeoutMs: commandTimeoutMs
      });
      const metric = metricFromShell(evaluation, `iteration ${iteration} evaluation`);
      const improvementPct = improvementPercent(bestMetric, metric, higherIsBetter);
      const accepted = evaluation.ok && improvementPct >= minImprovementPct;

      await writeText(
        path.join(wf.runDir, "diffs", `iteration-${iteration}-${artifactName(targetFile)}.diff`),
        diffText(before, proposal.newText)
      );

      if (accepted) {
        bestMetric = metric;
      } else {
        await restoreSnapshot(sandbox, snapshot);
      }

      record = {
        iteration,
        status: accepted ? "accepted" : "rejected",
        hypothesis: proposal.hypothesis ?? "",
        targetFile,
        metric,
        bestMetric,
        improvementPct,
        summary: proposal.summary ?? ""
      };
    } catch (error) {
      await restoreSnapshot(sandbox, snapshot);
      record = { iteration, status: "failed", error: error.message };
    }

    records.push(record);
    await appendJsonl(path.join(wf.runDir, "artifacts", "experiments.jsonl"), record);
  }

  const summary = { bestMetric, higherIsBetter, iterations: records };
  await writeJson(path.join(wf.runDir, "artifacts", "research-summary.json"), summary);
  await wf.writeReport(report(summary, evalCommand, targetFiles));
});

function proposalPrompt(iteration, targetFiles, files, context) {
  return `You are running a simple auto-research experiment loop.

This is iteration ${iteration}. Auto Research is only one pattern built on Dynamic Workflow. Do not edit the workflow or strategy code.

Sandbox rules:
- Your current working directory is the sandbox.
- Propose and return one bounded replacement for one allowed target file.
- Allowed target files: ${targetFiles.join(", ")}
- Do not modify files directly. Return the new file text in JSON.
- Do not commit changes.
- Return JSON only.

Evaluation:
- Command: ${context.evalCommand}
- Current best metric: ${context.bestMetric}
- Higher is better: ${context.higherIsBetter}

Return shape:
{
  "hypothesis": "why this change may improve the metric",
  "targetFile": "one allowed target file",
  "newText": "full replacement text for targetFile",
  "summary": "short summary"
}

Current files:
${files}`;
}

async function fileContext(root, files) {
  const chunks = await Promise.all(
    files.map(async (file) => `<<<FILE ${file}\n${await readText(path.join(root, file))}\nFILE`)
  );
  return chunks.join("\n\n");
}

function validateProposal(proposal, targetFiles) {
  if (!proposal || typeof proposal !== "object") {
    throw new Error("proposal must be a JSON object");
  }
  if (!targetFiles.includes(proposal.targetFile)) {
    throw new Error(`proposal targetFile is not allowed: ${proposal.targetFile}`);
  }
  if (typeof proposal.newText !== "string") {
    throw new Error("proposal newText must be a string");
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
- Target files: ${targetFiles.join(", ")}
- Higher is better: ${summary.higherIsBetter}
- Final best metric: ${summary.bestMetric}
- Accepted experiments: ${accepted.length}
- Rejected experiments: ${rejected.length}
- Failed experiments: ${failed.length}

## Experiments

${markdownTable(
  ["Iteration", "Status", "Metric", "Improvement", "Target", "Summary"],
  summary.iterations.map((record) => [
    record.iteration,
    record.status,
    record.metric ?? "",
    formatPercent(record.improvementPct),
    record.targetFile ?? "",
    record.summary ?? record.error ?? ""
  ])
)}
`;
}
