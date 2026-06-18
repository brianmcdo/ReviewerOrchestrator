# Edge-case Playbook

Actionable guidance for the implementor: "if you touch X, watch for Y." Each entry
captures an edge case the Reviewer found and the recommended way to handle it.

## Template

### When you touch <area / file / pattern>
- **Edge case**: what can go wrong
- **Why**: the underlying reason
- **Do**: the recommended handling
- **Don't**: the trap to avoid
- **Seen in**: file references

---

### When you touch git change-detection (`git.ts` / `review-changed.sh`)
- **Edge case**: special/quoted filenames, large changesets (maxBuffer), git failures returning empty, and the duplicated EXCLUDE list drifting between the TS and shell copies.
- **Why**: output is split on `\n` and git errors are swallowed to `""`; two hand-maintained exclude regexes diverge over time.
- **Do**: use `-z` NUL-delimiting + `core.quotePath=false`, set `maxBuffer`/`timeout`, surface git errors, and keep the two exclude lists in sync (or single-source them).
- **Don't**: split on `\n`, treat `""` as authoritative "no changes", or assume the regexes match.
- **Seen in**: `tools/reviewer/src/git.ts`, `.cursor/hooks/review-changed.sh`
- **Update (2026-06-18T21:43)**: the above are done. Residual: an explicit non-resolvable `--base` silently degrades to the empty-tree diff (reviews everything) - throw when a caller-supplied base doesn't resolve; `--cached` mixes bases for a non-HEAD base; add a `--` revision/pathspec separator; `existsSync` follows symlinks (dangling symlink looks like a deletion); `\.lock$` is broad (excludes `Cargo.lock` etc.).

### When you touch the orchestrator fan-out (`orchestrator.ts`)
- **Edge case**: parallel reviewers corrupt shared memory; one thrown error aborts the whole batch; the durable implementor agent leaks.
- **Why**: `Promise.all` is fail-fast, dispose only runs on happy paths, and reviewers are allowed to write shared markdown concurrently.
- **Do**: use `Promise.allSettled`, cap concurrency, dispose the implementor in `finally`, and route all memory writes through the single orchestrator.
- **Don't**: let reviewers write shared markdown directly or rely on `Promise.all`.
- **Seen in**: `tools/reviewer/src/orchestrator.ts`, `reviewerPrompt.ts`
- **Update (2026-06-18T21:43)**: the above are done, but: (1) a timeout must call `run.cancel()` (guarded by `run.supports("cancel")`), not just abandon the promise; (2) a timeout must NOT be fatal - a slow/incomplete implementor should still fall through to the review; (3) enforce reviewer read-only MECHANICALLY (permission-restricted agent) rather than via the prompt; (4) swallow/log dispose errors so a `finally` failure can't discard a completed review.

### When you touch the reviewer prompt/parse contract (`reviewerPrompt.ts`)
- **Edge case**: the reviewer omits or duplicates the `<CONCERNS>` block, or `file` contains `>`/`"`.
- **Why**: `parseConcerns` falls back to dumping full prose, the regex is non-global (first match), and `[^>]*` is used on the tag.
- **Do**: keep the contract strict - match the last block, escape `file`, and fail loud on no-match.
- **Don't**: persist raw prose into `concerns.md` on a parse miss.
- **Seen in**: `tools/reviewer/src/reviewerPrompt.ts`
- **Update (2026-06-18T21:43)**: sentinel/last-block/escaping are done. Residual: an empty `<CONCERNS></CONCERNS>` reports `parseOk: true` but substitutes the sentinel (gate `parseOk` on non-empty); the frontmatter strip assumes LF + trailing newline (tolerate `\r?\n`); the prompt lists memory paths as bare relative while only `root` is anchored (join under `root`); unit-test `buildReviewerPrompt` escaping, not just `parseReview`.

### When you configure a Node-executed ESM CLI (`tsconfig.json`)
- **Edge case**: `moduleResolution: "bundler"` silently drops the `.js`-extension requirement that Node ESM enforces at runtime, so a bad import type-checks but crashes.
- **Why**: bundler mode assumes a bundler, not Node's resolver.
- **Do**: prefer `node16`/`nodenext` for Node-executed output and always keep `.js` on relative imports.
- **Don't**: rely on `bundler` mode to validate runtime import paths.
- **Seen in**: `tools/reviewer/tsconfig.json`, `src/orchestrator.ts`
