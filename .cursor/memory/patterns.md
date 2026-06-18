# Patterns

Recurring logical and structural patterns the Reviewer has extracted from the
codebase. Each entry names a pattern so it can be referenced in concerns and the
playbook. Patterns can be "good" (follow this) or "anti" (avoid this).

## Template

### <pattern name>
- **Kind**: good | anti
- **Where**: files/modules where it appears
- **What**: one-paragraph description
- **Why it matters**: consequence of following / breaking it

---

### Single-writer aggregation for shared state
- **Kind**: good
- **Where**: `tools/reviewer/src/orchestrator.ts`, `reviewerPrompt.ts`
- **What**: Parallel read-only reviewer agents emit machine-parseable `<CONCERNS>`/`<ARCH>`/`<PATTERNS>`/`<PLAYBOOK>` blocks; the orchestrator is the sole writer of ALL memory files and persists serially.
- **Why it matters**: Avoids interleaved/corrupted appends from concurrent agents. As of 2026-06-18T21:43 this discipline covers every memory file, not just `concerns.md` - the earlier race is closed. Residual caveat: the read-only invariant is currently prompt-enforced for SDK reviewers, not mechanically enforced.

### Throwing-by-default subprocess wrapper with explicit probe
- **Kind**: good (remediation of the former fail-silent anti-pattern)
- **Where**: `tools/reviewer/src/git.ts` (`git()` throws `GitError`; `tryGit()` returns null)
- **What**: The default wrapper throws on failure so real errors propagate; a separate non-throwing `tryGit()` is used only for existence/probe checks.
- **Why it matters**: Callers can distinguish a genuine failure (missing binary, lock, buffer overflow) from "no changes", instead of collapsing both into `""`. Replaces the prior "fail-silent subprocess wrapper" anti-pattern, which no longer applies to `git.ts`.

### Sentinel-on-parse-miss
- **Kind**: good
- **Where**: `tools/reviewer/src/reviewerPrompt.ts` (`parseReview` / `NO_PARSEABLE_CONCERNS`)
- **What**: A missing tagged block returns a fixed sentinel string, never the raw model transcript.
- **Why it matters**: Prevents persisting a whole reviewer reply into `concerns.md` on a malformed response. Caveat: an empty-but-present block currently reports `parseOk: true` while substituting the sentinel - gate `parseOk` on non-empty content.

### ESM CLI compiled by tsc
- **Kind**: good
- **Where**: `tools/reviewer/` (`package.json` + `tsconfig.json`)
- **What**: `"type":"module"` + `module: ES2022`, relative imports carry explicit `.js`, a shebang in the entry `.ts` is preserved by tsc, and `bin` points at `dist/*.js`.
- **Why it matters**: Lets TS source compile to a directly Node-runnable ESM CLI - but pair it with `moduleResolution: node16/nodenext` so Node's `.js`-extension requirement is enforced at compile time (`bundler` mode does not).
