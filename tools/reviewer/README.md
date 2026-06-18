# Reviewer Orchestrator (SDK)

Standalone version of the in-IDE reviewer loop, built on the [Cursor SDK](https://cursor.com/docs/sdk/typescript).
Use this when you want the loop to run from a terminal or CI instead of inside a
Cursor chat. It reuses the same reviewer persona (`.cursor/rules/reviewer.mdc`)
and the same memory files (`.cursor/memory/*.md`) as the IDE flow.

## How it relates to the in-IDE loop

| Concern              | In-IDE                                   | SDK (here)                                  |
| -------------------- | ---------------------------------------- | ------------------------------------------- |
| Trigger              | `stop` hook (`.cursor/hooks.json`)       | you run `orchestrator.js`                   |
| "Fresh session/file" | reviewer subagent (Task tool)            | `Agent.prompt(...)` one-shot per file       |
| Reviewer persona     | `.cursor/rules/reviewer.mdc`             | same file, injected into the prompt         |
| Memory               | `.cursor/memory/*.md`                    | same files                                  |
| Concerns back to dev | followup message in chat                 | `implementor.send(consolidatedConcerns)`    |

## Setup

```bash
cd tools/reviewer
npm install
export CURSOR_API_KEY="cursor_..."   # from Cursor Dashboard -> Integrations
```

## Run

Implement a change, then review every file it touched and feed concerns back:

```bash
npm run review -- "Add input validation to the add() helper"
```

Review the current working-tree diff without making changes:

```bash
npm run review -- --review-only
```

Options: `--model <id>` (default `composer-2.5`), `--base <ref>` (default `HEAD`).

## Notes

- Each file is reviewed by a genuinely separate agent (hard isolation), run in
  parallel up to `REVIEWER_CONCURRENCY` (default 4).
- Reviewers are read-only: they return tagged `<CONCERNS>` / `<ARCH>` /
  `<PATTERNS>` / `<PLAYBOOK>` blocks and write nothing. The orchestrator is the
  SOLE writer of every memory file and persists serially, so there are no
  concurrent-write races.
- A reviewer that fails or times out becomes a `MAJOR` concern instead of
  crashing the batch; `git` failures are surfaced (not silently treated as "no
  changes").
- The exclusion list (mirrored by hand with `.cursor/hooks/review-changed.sh`)
  keeps `.cursor/`, `node_modules`, build output, and lockfiles out of scope.

## Tuning (env)

| Var                      | Default  | Meaning                          |
| ------------------------ | -------- | -------------------------------- |
| `REVIEWER_CONCURRENCY`   | `4`      | max parallel reviewers           |
| `REVIEWER_TIMEOUT_MS`    | `300000` | per-reviewer timeout             |
| `IMPLEMENTOR_TIMEOUT_MS` | `600000` | per-implementor-run timeout      |

Run `npm test` to exercise the prompt parser edge cases.
