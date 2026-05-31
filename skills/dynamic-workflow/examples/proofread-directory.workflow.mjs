import path from "node:path";
import {
  agent,
  artifactName,
  createWorkflow,
  diffText,
  globFiles,
  markdownTable,
  parseList,
  pipeline,
  readText,
  writeText
} from "../runtime/workflow-runtime.mjs";

const wf = createWorkflow({
  name: process.env.DW_WORKFLOW_NAME ?? "proofread-directory",
  concurrency: Number(process.env.DW_CONCURRENCY ?? 4),
  resume: process.env.DW_RESUME !== "false"
});

await wf.run(async () => {
  const root = process.env.DW_PROOFREAD_ROOT ?? "docs";
  const extensions = parseList(process.env.DW_PROOFREAD_EXTENSIONS, [".md", ".txt"]);
  const files = await globFiles({ root, extensions });
  const pending = files.filter((file) => !wf.isItemDone(file));

  await pipeline(pending, [processFile], {
    concurrency: wf.concurrency,
    stopOnError: false
  });

  await wf.writeReport(buildReport(files));
});

async function processFile(file) {
  try {
    await wf.setItemState(file, { status: "running" });

    const original = await readText(file);
    const edit = await agent("editor", {
      label: `edit:${file}`,
      cwd: process.cwd(),
      prompt: editorPrompt(file),
      retries: 1
    });

    if (typeof edit.correctedText !== "string") {
      throw new Error("editor returned no correctedText");
    }

    if (edit.correctedText === original) {
      return wf.markItemDone(file, {
        status: "unchanged",
        summary: edit.summary ?? "No changes"
      });
    }

    const proposedDiff = diffText(original, edit.correctedText);
    const proposalPath = path.join(
      wf.runDir,
      "artifacts",
      "proposals",
      `${artifactName(file)}.corrected.txt`
    );
    const proposedDiffPath = path.join(wf.runDir, "diffs", `${artifactName(file)}.proposed.diff`);
    await writeText(proposalPath, edit.correctedText);
    await writeText(proposedDiffPath, proposedDiff);

    const review = await agent("reviewer", {
      label: `review:${file}`,
      cwd: process.cwd(),
      prompt: reviewerPrompt(file, proposalPath, proposedDiffPath),
      retries: 1
    });

    if (review.accept) {
      const finalText =
        typeof review.finalText === "string" ? review.finalText : edit.correctedText;
      const finalDiff = finalText === edit.correctedText ? proposedDiff : diffText(original, finalText);
      await writeText(file, finalText);
      await writeText(path.join(wf.runDir, "diffs", `${artifactName(file)}.diff`), finalDiff);
      return wf.markItemDone(file, {
        status: "updated",
        summary: edit.summary ?? review.reason ?? "Updated",
        reason: review.reason ?? null
      });
    }

    await writeText(
      path.join(wf.runDir, "diffs", `${artifactName(file)}.rejected.diff`),
      proposedDiff
    );
    return wf.markItemDone(file, {
      status: "rejected",
      summary: edit.summary ?? "Rejected",
      reason: review.reason ?? "Reviewer rejected the edit"
    });
  } catch (error) {
    await wf.markItemFailed(file, error);
    throw error;
  }
}

function editorPrompt(file) {
  return `You are proofreading one Markdown or text file.

File: ${file}

Context:
- Your current working directory is the repository root.
- Read the file from the path above.

Rules:
- Fix spelling, grammar, punctuation, and obvious typos.
- Preserve meaning, tone, headings, links, front matter, and Markdown structure.
- Do not modify code blocks or command examples.
- Do not rewrite style unnecessarily.
- Return JSON only.

Return shape:
{
  "correctedText": "full file text with corrections applied (or unchanged original if nothing to fix)",
  "summary": "short summary of what was fixed, or 'No changes' if nothing to fix"
}
`;
}

function reviewerPrompt(file, proposalPath, proposedDiffPath) {
  return `You are reviewing a proposed proofreading edit.

File: ${file}
Proposed corrected text artifact: ${proposalPath}
Proposed diff artifact: ${proposedDiffPath}

Context:
- Your current working directory is the repository root.
- Read the original file from File.
- Read the proposed corrected text and diff from the artifact paths above.

Acceptance criteria:
- Meaning is preserved.
- Markdown structure is preserved.
- Code blocks and command examples are not rewritten.
- The edit fixes real proofreading issues and avoids unnecessary style churn.
- Return JSON only.

Return shape:
{
  "accept": boolean,
  "reason": "short reason",
  "finalText": "full final file text if accepted"
}
`;
}

function buildReport(files) {
  const rows = files.map((file) => ({ file, state: wf.getItemState(file) }));
  const updated = rows.filter((row) => row.state?.result?.status === "updated");
  const unchanged = rows.filter((row) => row.state?.result?.status === "unchanged");
  const rejected = rows.filter((row) => row.state?.result?.status === "rejected");
  const failed = rows.filter((row) => row.state?.status === "failed");

  return `# Proofread Directory Report

- Total files: ${files.length}
- Updated: ${updated.length}
- Unchanged: ${unchanged.length}
- Rejected: ${rejected.length}
- Failed: ${failed.length}

## Updated Files

${markdownTable(["File", "Summary"], updated.map((row) => [row.file, row.state.result.summary]))}

## Rejected Files

${markdownTable(["File", "Reason"], rejected.map((row) => [row.file, row.state.result.reason]))}

## Failed Files

${markdownTable(["File", "Error"], failed.map((row) => [row.file, row.state.error?.message ?? "Failed"]))}
`;
}
