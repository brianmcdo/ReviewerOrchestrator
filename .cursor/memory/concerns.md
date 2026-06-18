# Concerns log

Append-only log of concerns from each Reviewer run. Newest entries go at the
bottom. Never rewrite history. One block per review.

Severity: `BLOCKER` > `MAJOR` > `MINOR` > `NIT`. Use `NONE` when clean.

Format:

```
## <UTC timestamp> - <file path or "codebase">
- [SEV] <concern> -> <suggested action>
```

---

<!-- reviewer appends below this line -->

## 2026-06-18T21:32:28Z - orchestrated review (tools/reviewer/)

### tools/reviewer/src/git.ts
- [MAJOR] `git()` swallows every failure as `""`, so a missing binary, repo lock, credential prompt, or `maxBuffer` overflow is indistinguishable from "no changes" and the reviewer silently reviews nothing -> surface git errors (throw or discriminated result) and pass an explicit large `maxBuffer` + `timeout`.
- [MINOR] The `EXCLUDE` regex claims to mirror `review-changed.sh` but has already drifted (TS adds `target/` and `tools/reviewer/(node_modules|dist)/`) -> single-source the exclusion list or drop the "mirrors" claim.
- [MINOR] Splitting git output on `\n` + `existsSync` mishandles quoted/non-ASCII paths (`core.quotePath`) and drops them as "deletions" -> use `-z` NUL-delimited output with `-c core.quotePath=false`.
- [NIT] `git hash-object -t tree /dev/null` is non-portable (Windows) -> use the constant empty-tree SHA `4b825dc642cb6eb9a060e54bf8d69288fbee4904`.

### tools/reviewer/src/orchestrator.ts
- [MAJOR] Parallel reviewers are invited to write `patterns.md`/`playbook.md` (`reviewerPrompt.ts`), but only `concerns.md` is serialized through the orchestrator -> concurrent writes can corrupt shared memory; route ALL memory writes through the single orchestrator (return them as text, like concerns).
- [MAJOR] `Promise.all` is fail-fast and the non-`CursorAgentError` re-throw rejects the whole batch, discarding all other completed reviews -> use `Promise.allSettled` / wrap each task to always resolve.
- [MAJOR] The durable implementor agent leaks on error paths (dispose only happens on happy paths) -> dispose in a `finally`.
- [MINOR] Unbounded fan-out: one agent per changed file with no concurrency cap risks rate limits on large diffs -> add a concurrency pool.
- [MINOR] `appendFileSync` runs before the consolidated concerns are printed/fed back and has no try/catch -> wrap it so review output is never lost on a write failure.
- [MINOR] No timeouts on `run.wait()` / `Agent.prompt` -> add per-agent timeout/abort.
- [NIT] Final feedback `run.wait()` status is unchecked -> log on error status.

### tools/reviewer/src/reviewerPrompt.ts
- [MAJOR] `parseConcerns` falls back to returning the reviewer's ENTIRE prose when the `<CONCERNS>` block is missing, so a full transcript gets persisted into `concerns.md` -> on no-match return a sentinel / signal parse failure.
- [MINOR] `CONCERNS_RE` is non-global and grabs the FIRST match, so an echoed example tag is parsed instead of the real block -> match the last block or assert exactly one.
- [MINOR] `file`/`root` are interpolated unescaped into the prompt and the `<CONCERNS file="...">` tag -> validate/escape `file` or drop the unused attribute.
- [NIT] No unit tests for `parseConcerns` (missing/duplicate block, paths with `>`/quotes) -> add them.

### tools/reviewer/package.json + tsconfig.json
- [MINOR] `moduleResolution: "bundler"` for a Node-executed ESM CLI makes `.js` import extensions optional; current code is correct but a future extension-less import would type-check yet crash at runtime -> use `node16`/`nodenext`.
- [NIT] `bin` target only exists after `npm run build`; no `prepare` script -> add `"prepare": "tsc -p tsconfig.json"` or document the build step.
- [NIT] No `engines.node` pin despite ESM + `node:` specifiers -> add `"engines": { "node": ">=18" }`.

### tools/reviewer/.gitignore, README.md (reviewed inline)
- [NONE] reviewed, no concerns.

### tools/reviewer/package-lock.json (reviewed inline)
- [MINOR] A generated lockfile was sent through the review loop at all -> add lockfiles (`*-lock.json`, `*.lock`) and other generated artifacts to the hook's `EXCLUDE_RE` so reviewers aren't spent on them.

## 2026-06-18T21:43:07Z - orchestrated review (post-fix verification)

Prior BLOCKER/MAJOR/MINOR items from the 2026-06-18T21:32:28Z entry were verified as genuinely fixed (silent git failure, parallel-write race, Promise.all fail-fast, finally-dispose, parse-miss transcript leak, bundler moduleResolution, lockfile exclusion). New findings below.

### tools/reviewer/src/orchestrator.ts
- [MAJOR] Implementor timeout is fatal: `waitWithTimeout` throws `TimeoutError` which is uncaught, unwinds `main`, and exits 1 - discarding the whole review. This contradicts the adjacent non-`finished` branch that explicitly "reviews what changed anyway" -> catch `TimeoutError` around the implementor wait and fall through to the review step.
- [MINOR] `waitWithTimeout` never cancels the losing run despite its docstring ("cancelling it best-effort"); the run keeps executing until agent disposal -> call `run.cancel()` (guard with `run.supports("cancel")`) on timeout, or fix the misleading comment.
- [MINOR] Single-writer invariant is prompt-enforced only: reviewer agents are created with full write capability and `local.cwd = root`, so "reviewers never write memory" relies on prompt compliance -> spawn reviewers in a permission-restricted/read-only mode if the SDK supports it, so the invariant is mechanical.
- [MINOR] Final feedback-delivery `waitWithTimeout` can throw `TimeoutError` -> exit 1 even though concerns were already printed -> wrap in try/catch consistent with the "log on error" intent.
- [NIT] A dispose failure in `reviewFile`'s `finally` after a successful review converts a good result into a `[MAJOR] retry` concern -> swallow/log dispose errors so they don't mask a completed review.
- [NIT] Implementor reuses the reviewers' `settingSources: []`, so it loads no project rules/AGENTS.md -> give the implementor its own options if it should follow repo conventions.

### tools/reviewer/src/reviewerPrompt.ts
- [MINOR] Empty `<CONCERNS></CONCERNS>` yields `concerns = sentinel` but `parseOk = true` - a contradictory state (flagged by two reviewers) -> gate `parseOk` on non-empty trimmed content.
- [MINOR] Frontmatter strip `^---\n[\s\S]*?\n---\n` assumes LF + trailing newline; a CRLF or no-trailing-newline `.mdc` leaks frontmatter into the prompt -> tolerate `\r?\n` and optional trailing newline.
- [MINOR] Prompt lists memory paths as bare relative (`.cursor/memory/...`) while only `root` is given as an anchor; if reviewer cwd != root it reads the wrong/no files -> anchor each path under `root` or state they are root-relative.
- [NIT] `lastBlock` terminates at the first literal `</TAG>` inside content, so a concern quoting `</CONCERNS>` truncates the block -> document the contract assumption.

### tools/reviewer/src/git.ts
- [MINOR] An explicit, non-resolvable `--base` silently falls back to `EMPTY_TREE` (whole-repo diff) because `hasBase` uses non-throwing `tryGit`; a typo'd base "reviews everything" instead of erroring -> when `base !== "HEAD"` and doesn't resolve, throw.
- [NIT] `--cached` diff is redundant when `base === "HEAD"` and mixes bases for a custom base (`--cached` is always index-vs-HEAD) -> derive staged set relative to the base or document HEAD-only semantics.
- [NIT] No `--` separator between revision and pathspec in `diff`/`ls-files` -> add `--` after `diffBase`.
- [NIT] `existsSync` follows symlinks, so a changed dangling symlink is dropped as a "deletion" -> use `lstat` if symlink changes should be reviewed.
- [NIT] `\.lock$` excludes any `*.lock` (e.g. `Cargo.lock`) beyond the named lockfiles -> confirm no reviewable `.lock` source exists, or tighten.

### tools/reviewer/src/reviewerPrompt.test.ts + package.json + tsconfig.json
- [MINOR] `test` script runs only the hardcoded `dist/reviewerPrompt.test.js`; `orchestrator.ts`/`git.ts` have no tests and wouldn't run even if added -> use `node --test "dist/**/*.test.js"` and add git/orchestrator tests.
- [MINOR] `buildReviewerPrompt` is uncovered - nothing verifies the `JSON.stringify(file)` escaping that fixed the prior injection concern -> add a test asserting a filename with `>`/`"`/newline is safely quoted.
- [NIT] `readPersona` (frontmatter strip + missing-file fallback) and the all-empty `memory` branch are untested -> add cases.
- [NONE] NodeNext config + test path resolution confirmed coherent.

### tools/reviewer/.gitignore, README.md (reviewed inline)
- [NONE] reviewed, no concerns (README updated to match read-only reviewer + env vars).

## 2026-06-18T21:50:50Z - README.md

- [MINOR] Doc/code drift: `README.md` (SDK section) and `tools/reviewer/README.md` both say each reviewer runs via `Agent.prompt(...)`, but `orchestrator.ts` (`reviewFile`) actually uses `Agent.create(...)` + `agent.send(...)` + `waitWithTimeout` (changed during the timeout/dispose refactor). `architecture.md` carries the same stale phrasing -> reword all three to `Agent.create(...)` + `agent.send(...)`.
- [NIT] In-IDE step 1 lists `/document-codebase` as populating architecture/patterns/playbook but omits that the command also records a baseline `concerns.md` entry -> optionally mention `concerns.md`.
- Everything else verified accurate: all links/paths resolve, `npm run review` + flags match `parseArgs`, hook behavior (loop_limit 3, signature state, exclusions, followup_message) correct, memory table + severity scale + single-writer + hand-synced exclude lists + Node>=18 all correct.
