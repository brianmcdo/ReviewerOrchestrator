#!/usr/bin/env node
/**
 * Reviewer orchestrator (SDK graduation of the in-IDE hook loop).
 *
 * Flow:
 *   1. (optional) A durable IMPLEMENTOR agent performs a change described by the
 *      task passed on the CLI.
 *   2. We compute the changed files via git.
 *   3. For EACH changed file we spawn a fresh, isolated REVIEWER agent in
 *      parallel (bounded by a concurrency cap) - true per-file isolation.
 *   4. The orchestrator is the SOLE writer of all memory files: it aggregates
 *      concerns + reviewer-suggested memory and persists them serially, then
 *      feeds the consolidated concerns back to the implementor.
 *
 * Usage:
 *   CURSOR_API_KEY=... node dist/orchestrator.js "Add input validation to add()"
 *   CURSOR_API_KEY=... node dist/orchestrator.js --review-only
 *
 * Flags:
 *   --review-only        Skip the implementor; just review the current diff.
 *   --model <id>         Model id (default: composer-2.5).
 *   --base <ref>         Diff base (default: HEAD).
 *
 * Env:
 *   REVIEWER_CONCURRENCY     Max parallel reviewers (default 4).
 *   REVIEWER_TIMEOUT_MS      Per-reviewer timeout (default 300000).
 *   IMPLEMENTOR_TIMEOUT_MS   Per-implementor-run timeout (default 600000).
 */
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { Agent, CursorAgentError, type AgentOptions, type RunResult, type Run } from "@cursor/sdk";

import { changedFiles, repoRoot } from "./git.js";
import { buildReviewerPrompt, parseReview, type ReviewOutput } from "./reviewerPrompt.js";

const CONCURRENCY = Math.max(1, Number(process.env.REVIEWER_CONCURRENCY) || 4);
const REVIEWER_TIMEOUT_MS = Number(process.env.REVIEWER_TIMEOUT_MS) || 300_000;
const IMPLEMENTOR_TIMEOUT_MS = Number(process.env.IMPLEMENTOR_TIMEOUT_MS) || 600_000;

const EMPTY_MEMORY = { architecture: "", patterns: "", playbook: "" };

class TimeoutError extends Error {}

interface Cli {
  task: string;
  reviewOnly: boolean;
  model: string;
  base: string;
}

function parseArgs(argv: string[]): Cli {
  const cli: Cli = { task: "", reviewOnly: false, model: "composer-2.5", base: "HEAD" };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--review-only") cli.reviewOnly = true;
    else if (a === "--model") cli.model = argv[++i] ?? cli.model;
    else if (a === "--base") cli.base = argv[++i] ?? cli.base;
    else rest.push(a);
  }
  cli.task = rest.join(" ").trim();
  return cli;
}

/** Awaits a run, cancelling it (best-effort) and throwing if it exceeds `ms`. */
async function waitWithTimeout(run: Run, ms: number, label: string): Promise<RunResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([run.wait(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Reviews one file in a fresh isolated agent. Always disposes the agent. */
async function reviewFile(
  common: AgentOptions,
  root: string,
  file: string,
): Promise<{ file: string; review: ReviewOutput }> {
  const agent = await Agent.create(common);
  try {
    const run = await agent.send(buildReviewerPrompt(root, file));
    const result = await waitWithTimeout(run, REVIEWER_TIMEOUT_MS, `reviewer ${file}`);
    if (result.status !== "finished") {
      return {
        file,
        review: { concerns: `- [MAJOR] reviewer run ${result.status} -> retry review of ${file}`, parseOk: false, memory: EMPTY_MEMORY },
      };
    }
    return { file, review: parseReview(result.result ?? "") };
  } finally {
    // Disposing the agent also stops any still-running local executor.
    await agent[Symbol.asyncDispose]();
  }
}

/** Reviews one file but NEVER rejects - failures become a MAJOR concern entry. */
async function safeReview(
  common: AgentOptions,
  root: string,
  file: string,
): Promise<{ file: string; review: ReviewOutput }> {
  try {
    return await reviewFile(common, root, file);
  } catch (err) {
    const why =
      err instanceof CursorAgentError ? `failed to start (${err.message})`
      : err instanceof TimeoutError ? err.message
      : `errored (${err instanceof Error ? err.message : String(err)})`;
    return { file, review: { concerns: `- [MAJOR] reviewer ${why} -> retry`, parseOk: false, memory: EMPTY_MEMORY } };
  }
}

/** Runs `fn` over `items` with at most `limit` in flight. `fn` must not reject. */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (true) {
      const idx = next++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Appends to a memory file; logs (never throws) so review output is never lost. */
function appendMemory(root: string, rel: string, content: string): void {
  try {
    appendFileSync(join(root, rel), content);
  } catch (err) {
    console.error(`warning: failed to write ${rel}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function main(): Promise<number> {
  const apiKey = process.env.CURSOR_API_KEY;
  if (!apiKey) {
    console.error("CURSOR_API_KEY is not set.");
    return 1;
  }

  const cli = parseArgs(process.argv.slice(2));
  const root = repoRoot(process.cwd());
  const common: AgentOptions = {
    apiKey,
    model: { id: cli.model },
    local: { cwd: root, settingSources: [] },
  };

  let implementor: Awaited<ReturnType<typeof Agent.create>> | undefined;
  try {
    // 1. Implementor (durable) performs the change, if a task was given.
    if (cli.task && !cli.reviewOnly) {
      implementor = await Agent.create(common);
      console.error(`implementor agent: ${implementor.agentId}`);
      const run = await implementor.send(cli.task);
      console.error(`implementor run: ${run.id}`);
      const result = await waitWithTimeout(run, IMPLEMENTOR_TIMEOUT_MS, "implementor");
      if (result.status !== "finished") {
        console.error(`implementor run ${result.status}; reviewing what changed anyway.`);
      }
    }

    // 2. Which files changed? (throws GitError on a real git failure)
    const files = changedFiles(root, cli.base);
    if (files.length === 0) {
      console.error("No changed files to review.");
      return 0;
    }
    console.error(`reviewing ${files.length} file(s) with concurrency ${CONCURRENCY}: ${files.join(", ")}`);

    // 3. One isolated reviewer per file, bounded concurrency, never-rejecting.
    const reviews = await mapPool(files, CONCURRENCY, (file) => safeReview(common, root, file));

    // 4. Orchestrator is the SOLE writer of memory. Persist serially.
    const ts = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    const concernsBlock =
      `\n## ${ts} - orchestrated review (${files.length} file(s))\n` +
      reviews.map((r) => `### ${r.file}\n${r.review.concerns}`).join("\n\n") +
      "\n";
    appendMemory(root, ".cursor/memory/concerns.md", concernsBlock);

    for (const { file, review } of reviews) {
      if (review.memory.architecture)
        appendMemory(root, ".cursor/memory/architecture.md", `\n- ${file}: ${review.memory.architecture}\n`);
      if (review.memory.patterns)
        appendMemory(root, ".cursor/memory/patterns.md", `\n${review.memory.patterns}\n`);
      if (review.memory.playbook)
        appendMemory(root, ".cursor/memory/playbook.md", `\n${review.memory.playbook}\n`);
    }

    // 5. Feed consolidated concerns back to the implementor (and always print).
    const consolidated =
      "Reviewer concerns from the latest change (address before continuing):\n" +
      reviews.map((r) => `\n[${r.file}]\n${r.review.concerns}`).join("\n");
    console.log(consolidated);

    if (implementor) {
      const run = await implementor.send(consolidated);
      const result = await waitWithTimeout(run, IMPLEMENTOR_TIMEOUT_MS, "implementor-feedback");
      if (result.status !== "finished") {
        console.error(`feedback delivery run ${result.status}.`);
      }
    }

    return 0;
  } finally {
    if (implementor) await implementor[Symbol.asyncDispose]();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
