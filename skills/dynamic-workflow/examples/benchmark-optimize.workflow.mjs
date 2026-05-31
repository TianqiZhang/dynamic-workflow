import fs from "node:fs/promises";
import path from "node:path";
import {
  agent,
  createWorkflow,
  diffText,
  ensureDir,
  formatPercent,
  parseBoolean,
  parseList,
  readText,
  shell,
  writeJson,
  writeText
} from "../runtime/workflow-runtime.mjs";

const wf = createWorkflow({
  name: process.env.DW_WORKFLOW_NAME ?? "benchmark-optimize",
  concurrency: 1,
  resume: false
});

await wf.run(async () => {
  const targetPaths = parseList(process.env.DW_TARGET_PATHS, ["src"]);
  const benchmarkCommand =
    process.env.DW_BENCHMARK_COMMAND ??
    'node -e "console.log(JSON.stringify({ metric: 0, higherIsBetter: true }))"';
  const testCommand = process.env.DW_TEST_COMMAND ?? 'node -e "process.exit(0)"';
  const minImprovementPct = Number(process.env.DW_MIN_IMPROVEMENT_PCT ?? 1);
  const commandTimeoutMs = Number(process.env.DW_COMMAND_TIMEOUT_MS ?? 600000);
  const agentTimeoutMs = Number(process.env.DW_AGENT_TIMEOUT_MS ?? 1800000);

  const baseline = await shell(benchmarkCommand, {
    label: "baseline-benchmark",
    json: true,
    timeoutMs: commandTimeoutMs
  });
  const baselineMetric = metricFromShell(baseline, "baseline benchmark");
  const higherIsBetter = parseBoolean(
    process.env.DW_HIGHER_IS_BETTER,
    baseline.json?.higherIsBetter ?? true
  );

  const sandbox = path.join(wf.runDir, "artifacts", "benchmark-sandbox");
  await fs.rm(sandbox, { recursive: true, force: true });
  await ensureDir(sandbox);

  const copyResults = await Promise.all(
    targetPaths.map(async (targetPath) => {
      try {
        await fs.cp(targetPath, path.join(sandbox, targetPath), { recursive: true });
        return targetPath;
      } catch (error) {
        if (error.code === "ENOENT") {
          return null;
        }
        throw error;
      }
    })
  );
  const copiedPaths = copyResults.filter(Boolean);
  if (copiedPaths.length === 0) {
    throw new Error(`None of the configured target paths exist: ${targetPaths.join(", ")}`);
  }

  const coderResult = await agent("coder", {
    label: "benchmark-optimize-candidate",
    cwd: sandbox,
    timeoutMs: agentTimeoutMs,
    schema: coderResultSchema(),
    prompt: coderPrompt(copiedPaths, benchmarkCommand, testCommand, baselineMetric, higherIsBetter)
  });

  const tests = await shell(testCommand, {
    cwd: sandbox,
    label: "sandbox-tests",
    timeoutMs: commandTimeoutMs
  });

  let candidateBenchmark = null;
  let candidateMetric = null;
  if (tests.ok) {
    candidateBenchmark = await shell(benchmarkCommand, {
      cwd: sandbox,
      label: "sandbox-benchmark",
      json: true,
      timeoutMs: commandTimeoutMs
    });
    candidateMetric = metricFromShell(candidateBenchmark, "candidate benchmark");
  }

  const candidateDiff = await diffTargetPaths(copiedPaths, process.cwd(), sandbox);
  const diffPath = path.join(wf.runDir, "diffs", "candidate.diff");
  await writeText(diffPath, candidateDiff || "No changes\n");

  const improvementPct =
    tests.ok && candidateMetric !== null
      ? improvementPercent(baselineMetric, candidateMetric, higherIsBetter)
      : null;
  const accepted = tests.ok && improvementPct !== null && improvementPct >= minImprovementPct;

  const result = {
    accepted,
    baselineMetric,
    candidateMetric,
    higherIsBetter,
    improvementPct,
    minImprovementPct,
    testsOk: tests.ok,
    coderResult,
    diffPath
  };
  await writeJson(path.join(wf.runDir, "artifacts", "benchmark-result.json"), result);
  await wf.writeReport(report(result, tests, candidateBenchmark));
});

function coderPrompt(targetPaths, benchmarkCommand, testCommand, baselineMetric, higherIsBetter) {
  return `You are implementing one optimization candidate inside a sandbox copy.

Sandbox rules:
- Your current working directory is the sandbox.
- Modify only these paths: ${targetPaths.join(", ")}
- Do not modify files outside those paths.
- Do not commit changes.
- Do not apply changes to the original repository.
- Keep the change small and focused.
- Return the requested structured result when finished.

Baseline:
- Benchmark command: ${benchmarkCommand}
- Test command: ${testCommand}
- Baseline metric: ${baselineMetric}
- Higher is better: ${higherIsBetter}

Return what changed, the files you believe you changed, and risk.`;
}

function coderResultSchema() {
  return {
    type: "object",
    required: ["summary", "filesChanged", "risk"],
    properties: {
      summary: { type: "string" },
      filesChanged: {
        type: "array",
        items: { type: "string" }
      },
      risk: { type: "string", enum: ["low", "medium", "high"] }
    },
    additionalProperties: false
  };
}

function report(result, tests, candidateBenchmark) {
  return `# Benchmark Optimize Report

- Accepted: ${result.accepted}
- Baseline metric: ${formatMetric(result.baselineMetric)}
- Candidate metric: ${formatMetric(result.candidateMetric)}
- Higher is better: ${result.higherIsBetter}
- Improvement: ${formatPercent(result.improvementPct, { whenNullish: "n/a" })}
- Required improvement: ${formatPercent(result.minImprovementPct, { whenNullish: "n/a" })}
- Tests passed: ${tests.ok}
- Candidate diff: ${result.diffPath}

## Test Output

Exit code: ${tests.exitCode}

\`\`\`text
${tests.stdout || tests.stderr || ""}
\`\`\`

## Candidate Benchmark Output

\`\`\`text
${candidateBenchmark?.stdout ?? "Benchmark did not run because tests failed."}
\`\`\`

## Decision

${result.accepted ? "Candidate met the configured threshold." : "Candidate was rejected or needs human review."}
`;
}

async function diffTargetPaths(targetPaths, originalRoot, sandboxRoot) {
  const allFiles = new Set();

  for (const targetPath of targetPaths) {
    for (const file of await collectFiles(originalRoot, targetPath)) {
      allFiles.add(file);
    }
    for (const file of await collectFiles(sandboxRoot, targetPath)) {
      allFiles.add(file);
    }
  }

  const sections = [];
  for (const file of [...allFiles].sort()) {
    const before = await readOrEmpty(path.join(originalRoot, file));
    const after = await readOrEmpty(path.join(sandboxRoot, file));
    if (before !== after) {
      sections.push(`--- ${file}\n+++ ${file}\n${diffText(before, after)}`);
    }
  }

  return sections.join("\n");
}

async function collectFiles(root, targetPath) {
  const out = [];
  await walk(path.join(root, targetPath), root, out);
  return out;
}

async function walk(current, root, out) {
  let stat;
  try {
    stat = await fs.stat(current);
  } catch (error) {
    if (error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  if (stat.isFile()) {
    out.push(toPosix(path.relative(root, current)));
    return;
  }
  if (!stat.isDirectory()) {
    return;
  }
  const entries = await fs.readdir(current);
  for (const entry of entries) {
    await walk(path.join(current, entry), root, out);
  }
}

async function readOrEmpty(filePath) {
  try {
    return await readText(filePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return "";
    }
    throw error;
  }
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

function formatMetric(value) {
  return value === null || value === undefined ? "n/a" : String(value);
}

function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}
