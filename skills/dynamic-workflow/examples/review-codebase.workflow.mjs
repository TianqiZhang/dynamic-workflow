import {
  agent,
  createWorkflow,
  globFiles,
  markdownTable,
  parseList,
  pipeline,
  readText
} from "../runtime/workflow-runtime.mjs";

const wf = createWorkflow({
  name: process.env.DW_WORKFLOW_NAME ?? "review-codebase",
  concurrency: Number(process.env.DW_CONCURRENCY ?? 4),
  resume: process.env.DW_RESUME !== "false"
});

await wf.run(async () => {
  const root = process.env.DW_REVIEW_ROOT ?? ".";
  const extensions = parseList(process.env.DW_REVIEW_EXTENSIONS, [
    ".js",
    ".mjs",
    ".cjs",
    ".ts",
    ".tsx",
    ".jsx",
    ".py",
    ".rb",
    ".go",
    ".rs",
    ".java",
    ".cs",
    ".php",
    ".swift"
  ]);
  const files = await globFiles({ root, extensions });
  const pending = files.filter((file) => !wf.isItemDone(file));

  await pipeline(pending, [reviewFile], {
    concurrency: wf.concurrency,
    stopOnError: false
  });

  await wf.writeReport(buildReport(files));
});

async function reviewFile(file) {
  try {
    await wf.setItemState(file, { status: "running" });

    const content = await readText(file);
    const result = await agent("reviewer", {
      label: `review:${file}`,
      prompt: reviewPrompt(file, content),
      retries: 1
    });

    const findings = Array.isArray(result.findings) ? result.findings : [];
    return wf.markItemDone(file, {
      status: "reviewed",
      findings
    });
  } catch (error) {
    await wf.markItemFailed(file, error);
    throw error;
  }
}

function reviewPrompt(file, content) {
  return `You are reviewing one source file for concrete defects.

File: ${file}

Rules:
- Report only actionable bugs, behavioral regressions, security issues, data-loss risks, or missing tests that materially affect correctness.
- Do not report style preferences.
- Do not invent line numbers. If unsure, omit the line or use null.
- Return JSON only.

Return shape:
{
  "findings": [
    {
      "severity": "low|medium|high",
      "file": "${file}",
      "line": 123,
      "title": "short title",
      "description": "why this is a real issue",
      "suggestion": "specific fix or test"
    }
  ]
}

File content:
<<<FILE
${content}
FILE`;
}

function buildReport(files) {
  const findings = [];
  const failed = [];

  for (const file of files) {
    const state = wf.getItemState(file);
    if (state?.status === "failed") {
      failed.push([file, state.error?.message ?? "Failed"]);
      continue;
    }
    for (const finding of state?.result?.findings ?? []) {
      findings.push({
        severity: normalizeSeverity(finding.severity),
        file: finding.file ?? file,
        line: finding.line ?? "",
        title: finding.title ?? "Finding",
        description: finding.description ?? "",
        suggestion: finding.suggestion ?? ""
      });
    }
  }

  const high = findings.filter((finding) => finding.severity === "high");
  const medium = findings.filter((finding) => finding.severity === "medium");
  const low = findings.filter((finding) => finding.severity === "low");

  return `# Codebase Review Report

- Files reviewed: ${files.length}
- Findings: ${findings.length}
- High: ${high.length}
- Medium: ${medium.length}
- Low: ${low.length}
- Failed files: ${failed.length}

## High Severity

${findingTable(high)}

## Medium Severity

${findingTable(medium)}

## Low Severity

${findingTable(low)}

## Failed Files

${markdownTable(["File", "Error"], failed)}
`;
}

function findingTable(findings) {
  return markdownTable(
    ["File", "Line", "Title", "Description", "Suggestion"],
    findings.map((finding) => [
      finding.file,
      finding.line,
      finding.title,
      finding.description,
      finding.suggestion
    ])
  );
}

function normalizeSeverity(value) {
  const severity = String(value ?? "low").toLowerCase();
  return ["high", "medium", "low"].includes(severity) ? severity : "low";
}
