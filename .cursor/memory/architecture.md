# Architecture

High-level map of the codebase, maintained by the Reviewer. Describes how modules
fit together, the main data flows, and the boundaries between subsystems.

> Status: partially populated (the `.cursor/` control surface + `tools/reviewer/`).
> Run `/document-codebase` for a full pass once real product code exists.

## Overview

This repo currently contains the "isolated reviewer loop" tooling itself: a Cursor
control surface (`.cursor/`) that runs an isolated reviewer after changes, and an
SDK-based equivalent under `tools/reviewer/`.

## Modules

- `.cursor/rules/reviewer.mdc` - the reviewer persona (isolated rules).
- `.cursor/memory/*.md` - persistent knowledge base (architecture/patterns/playbook/concerns).
- `.cursor/hooks/review-changed.sh` + `.cursor/hooks.json` - `stop` hook that diffs
  changed files and asks the agent to launch one isolated reviewer per file.
- `tools/reviewer/` - SDK graduation of the hook loop. Entry point
  `src/orchestrator.ts`: an optional durable implementor agent makes a change,
  `src/git.ts` computes changed files (unstaged+staged+untracked, minus
  vendored/build/`.cursor` paths and deletions), then one isolated `Agent.prompt`
  reviewer per file runs in parallel via `src/reviewerPrompt.ts`; results aggregate
  into `concerns.md` and feed back to the implementor.

## Data flow

change -> (hook diff | git.ts diff) -> per-file isolated reviewer -> concerns +
memory updates -> consolidated concerns back to implementor.

## Boundaries & integration points

- `git` CLI (change detection).
- `@cursor/sdk` -> Cursor agent API (requires `CURSOR_API_KEY`); the only network
  dependency.
