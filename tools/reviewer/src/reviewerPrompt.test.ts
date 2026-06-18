import assert from "node:assert/strict";
import { test } from "node:test";

import { NO_PARSEABLE_CONCERNS, parseReview } from "./reviewerPrompt.js";

test("parses a well-formed concerns block", () => {
  const out = parseReview(
    "preamble\n<CONCERNS>\n- [MINOR] foo -> bar\n</CONCERNS>\n<ARCH>none</ARCH>\n<PATTERNS>none</PATTERNS>\n<PLAYBOOK>none</PLAYBOOK>",
  );
  assert.equal(out.parseOk, true);
  assert.equal(out.concerns, "- [MINOR] foo -> bar");
  assert.deepEqual(out.memory, { architecture: "", patterns: "", playbook: "" });
});

test("missing concerns block returns sentinel, never the transcript", () => {
  const out = parseReview("Here is a long prose review with no tagged block at all.");
  assert.equal(out.parseOk, false);
  assert.equal(out.concerns, NO_PARSEABLE_CONCERNS);
  assert.ok(!out.concerns.includes("long prose"));
});

test("takes the LAST concerns block when the example tag is echoed", () => {
  const text =
    "I will use this format:\n<CONCERNS>\n- [SEV] example -> action\n</CONCERNS>\n" +
    "Now my real review:\n<CONCERNS>\n- [BLOCKER] real issue -> fix\n</CONCERNS>";
  const out = parseReview(text);
  assert.equal(out.concerns, "- [BLOCKER] real issue -> fix");
});

test('"none" and empty memory blocks normalize to empty string', () => {
  const out = parseReview(
    "<CONCERNS>- [NONE] reviewed, no concerns</CONCERNS><ARCH>None</ARCH><PATTERNS>\n\n</PATTERNS><PLAYBOOK>none</PLAYBOOK>",
  );
  assert.deepEqual(out.memory, { architecture: "", patterns: "", playbook: "" });
});

test("captures real memory additions", () => {
  const out = parseReview(
    "<CONCERNS>- [NIT] x -> y</CONCERNS>\n<ARCH>leaf util</ARCH>\n<PATTERNS>### P\n- Kind: good</PATTERNS>\n<PLAYBOOK>### When you touch X</PLAYBOOK>",
  );
  assert.equal(out.memory.architecture, "leaf util");
  assert.equal(out.memory.patterns, "### P\n- Kind: good");
  assert.equal(out.memory.playbook, "### When you touch X");
});

test("concerns text containing > and quotes is preserved", () => {
  const out = parseReview('<CONCERNS>\n- [MINOR] `a > b` and "quoted" -> handle it\n</CONCERNS>');
  assert.equal(out.parseOk, true);
  assert.equal(out.concerns, '- [MINOR] `a > b` and "quoted" -> handle it');
});
