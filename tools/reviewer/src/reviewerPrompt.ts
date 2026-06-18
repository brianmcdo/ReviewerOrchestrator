import { readFileSync } from "node:fs";
import { join } from "node:path";

const MEMORY_FILES = [
  ".cursor/memory/architecture.md",
  ".cursor/memory/patterns.md",
  ".cursor/memory/playbook.md",
  ".cursor/memory/concerns.md",
];

/** Sentinel returned when a reviewer's output has no parseable concerns block. */
export const NO_PARSEABLE_CONCERNS = "- [MAJOR] reviewer output had no parseable <CONCERNS> block -> re-run the review";

/** Memory additions a reviewer suggests; the orchestrator (sole writer) persists them. */
export interface MemoryAdditions {
  architecture: string;
  patterns: string;
  playbook: string;
}

export interface ReviewOutput {
  concerns: string;
  parseOk: boolean;
  memory: MemoryAdditions;
}

function readPersona(root: string): string {
  try {
    const raw = readFileSync(join(root, ".cursor/rules/reviewer.mdc"), "utf8");
    // Strip only a leading MDC frontmatter fence pair; keep the persona body.
    return raw.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
  } catch {
    return "You are an isolated code reviewer. Do not modify source code.";
  }
}

/**
 * Builds the prompt for a single fresh reviewer agent. Each call is its own
 * isolated session (no shared memory), so the persona + memory context is
 * injected explicitly. The same persona text powers the in-IDE rule, keeping
 * the two runtimes aligned.
 *
 * Reviewers are READ-ONLY: they return tagged blocks and never write files.
 * The orchestrator is the single writer for ALL memory files, which avoids the
 * write races that parallel reviewers would otherwise cause.
 */
export function buildReviewerPrompt(root: string, file: string): string {
  const persona = readPersona(root);
  return `${persona}

---

You are running as a standalone reviewer process. There is NO shared chat context;
everything you need is below or on disk under ${JSON.stringify(root)}.

Shared memory to read for prior context (READ-ONLY):
${MEMORY_FILES.map((m) => `- ${m}`).join("\n")}

Review ONLY this one file: ${JSON.stringify(file)}

IMPORTANT: You must NOT write or edit ANY file, including the memory files. The
orchestrator persists everything. Return your findings as the tagged blocks below.

End your response with EXACTLY these four blocks, in this order. For a memory block
that has nothing to add, put the single word "none" inside it.

<CONCERNS>
- [SEV] <one-line concern> -> <suggested action>
</CONCERNS>
<ARCH>
<one line: where this file fits in the architecture, or "none">
</ARCH>
<PATTERNS>
<a markdown pattern entry, or "none">
</PATTERNS>
<PLAYBOOK>
<a markdown playbook entry, or "none">
</PLAYBOOK>

SEV is one of BLOCKER, MAJOR, MINOR, NIT. If there are no concerns, the CONCERNS
block must contain exactly: - [NONE] reviewed, no concerns`;
}

/** Returns the content of the LAST occurrence of <TAG>...</TAG>, or null. */
function lastBlock(text: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g");
  let match: RegExpExecArray | null;
  let last: string | null = null;
  while ((match = re.exec(text)) !== null) last = match[1];
  return last === null ? null : last.trim();
}

/** Normalizes a memory block: "none"/empty -> "" (nothing to persist). */
function memoryValue(raw: string | null): string {
  if (raw === null) return "";
  const v = raw.trim();
  return v === "" || v.toLowerCase() === "none" ? "" : v;
}

/**
 * Parses a reviewer's final text into concerns + memory additions. On a missing
 * concerns block we return a sentinel (never the raw transcript) so the
 * orchestrator can't accidentally persist a full reply into concerns.md.
 */
export function parseReview(text: string): ReviewOutput {
  const concernsBlock = lastBlock(text, "CONCERNS");
  return {
    concerns: concernsBlock && concernsBlock.length > 0 ? concernsBlock : NO_PARSEABLE_CONCERNS,
    parseOk: concernsBlock !== null,
    memory: {
      architecture: memoryValue(lastBlock(text, "ARCH")),
      patterns: memoryValue(lastBlock(text, "PATTERNS")),
      playbook: memoryValue(lastBlock(text, "PLAYBOOK")),
    },
  };
}
