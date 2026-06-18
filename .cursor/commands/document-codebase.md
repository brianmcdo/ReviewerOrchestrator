# /document-codebase

Run the initial whole-codebase Reviewer pass. Use this once when onboarding the
Reviewer to a repo (or after a large change) to populate the shared memory.

## What to do

Launch a **separate reviewer subagent** (fresh, isolated context) so the review is
independent of this conversation. Instruct that subagent to:

1. Adopt the Reviewer persona in `.cursor/rules/reviewer.mdc`.
2. Survey the whole codebase: map modules, responsibilities, data flow, and
   boundaries. Skip vendored/generated dirs (`node_modules`, `dist`, `build`,
   `.git`, lockfiles).
3. Populate the memory files:
   - `.cursor/memory/architecture.md` - the system map.
   - `.cursor/memory/patterns.md` - recurring patterns (good and anti).
   - `.cursor/memory/playbook.md` - edge cases + recommended handling.
4. Record an initial baseline entry in `.cursor/memory/concerns.md` for `codebase`.
5. Do NOT modify any source code. Only the memory files may be written.

When the subagent finishes, summarize for me: how many modules were mapped, the top
patterns found, and the highest-severity concerns.

## Notes

- For a large repo, the subagent may review in batches by directory; it should still
  end with a single coherent `architecture.md`.
- This is the "Stage 3 step 1" initial pass. Incremental per-file reviews after
  changes are driven automatically by the `stop` hook.
