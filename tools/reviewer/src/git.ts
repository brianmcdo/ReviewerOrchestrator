import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/** Stable SHA of the empty tree object; portable replacement for /dev/null. */
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

const GIT_OPTS = {
  encoding: "utf8" as const,
  maxBuffer: 64 * 1024 * 1024, // 64MB: a large changeset must not look like "no output"
  timeout: 30_000, // ms: a hung git (e.g. credential prompt) must not block forever
};

/**
 * Paths the reviewer must never loop on or care about.
 *
 * NOTE: this list is kept in sync BY HAND with EXCLUDE_RE in
 * .cursor/hooks/review-changed.sh. The two cannot literally share a source
 * (one is TypeScript, one is bash). If you change one, change the other.
 */
export const EXCLUDE = new RegExp(
  [
    "^(\\.cursor/|\\.git/|node_modules/|dist/|build/|out/|\\.next/|coverage/|vendor/|target/|tools/reviewer/(node_modules|dist)/)",
    "(^|/)(package-lock\\.json|yarn\\.lock|pnpm-lock\\.yaml|bun\\.lockb)$", // generated lockfiles
    "\\.lock$",
  ].join("|"),
);

export class GitError extends Error {}

/** Runs git, THROWING GitError on failure so callers can distinguish error from empty. */
function git(repoRoot: string, args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: repoRoot, ...GIT_OPTS });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new GitError(`git ${args.join(" ")} failed: ${detail}`);
  }
}

/** Non-throwing git for existence/probe checks; returns null on failure. */
function tryGit(repoRoot: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, { cwd: repoRoot, ...GIT_OPTS });
  } catch {
    return null;
  }
}

export function repoRoot(start: string): string {
  const out = tryGit(start, ["rev-parse", "--show-toplevel"]);
  return out ? out.trim() : start;
}

/** Splits NUL-delimited git output into entries. */
function splitNul(out: string): string[] {
  return out.split("\0").filter((s) => s.length > 0);
}

/**
 * Files changed since `base` (default HEAD), including staged and untracked,
 * minus excluded/vendored paths and deletions.
 *
 * Uses NUL-delimited output (`-z`) with `core.quotePath=false` so paths with
 * spaces, quotes, or non-ASCII characters survive intact. Throws GitError on a
 * real git failure rather than silently reporting "no changes".
 */
export function changedFiles(root: string, base = "HEAD"): string[] {
  const hasBase = tryGit(root, ["rev-parse", "--verify", "-q", base]) !== null;
  const diffBase = hasBase ? base : EMPTY_TREE;

  const quote = ["-c", "core.quotePath=false"];
  const lines = [
    ...splitNul(git(root, [...quote, "diff", "--name-only", "-z", diffBase])),
    ...splitNul(git(root, [...quote, "diff", "--name-only", "-z", "--cached"])),
    ...splitNul(git(root, [...quote, "ls-files", "--others", "--exclude-standard", "-z"])),
  ];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of lines) {
    if (!f || seen.has(f)) continue;
    seen.add(f);
    if (EXCLUDE.test(f)) continue;
    if (!existsSync(join(root, f))) continue; // skip deletions
    out.push(f);
  }
  return out.sort();
}
