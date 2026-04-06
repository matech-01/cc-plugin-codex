/**
 * Copyright 2026 Sendbird, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(
  fileURLToPath(new URL("../", import.meta.url))
);

function read(relativePath) {
  return fs.readFileSync(path.join(PROJECT_ROOT, relativePath), "utf8");
}

test("review skills keep background execution outside the companion command", () => {
  const review = read("skills/review/SKILL.md");
  const adversarial = read("skills/adversarial-review/SKILL.md");

  assert.match(review, /Treat `--wait` and `--background` as Codex-side execution controls only/i);
  assert.match(review, /Strip them before calling the companion command/i);
  assert.match(review, /The companion review process itself always runs in the foreground/i);
  assert.match(review, /Launch the same companion review command in a Codex background command or session/i);
  assert.match(review, /review --view-state on-success/i);
  assert.match(review, /use `--view-state defer` on the companion command/i);
  assert.doesNotMatch(review, /claude-companion\.mjs" review --background/i);
  assert.doesNotMatch(review, /claude-companion\.mjs" review \$ARGUMENTS/i);

  assert.match(adversarial, /Treat `--wait` and `--background` as Codex-side execution controls only/i);
  assert.match(adversarial, /Strip them before calling the companion command/i);
  assert.match(adversarial, /The companion review process itself always runs in the foreground/i);
  assert.match(adversarial, /Launch the same companion adversarial-review command in a Codex background command or session/i);
  assert.match(adversarial, /adversarial-review --view-state on-success/i);
  assert.match(adversarial, /use `--view-state defer` on the companion command/i);
  assert.doesNotMatch(adversarial, /claude-companion\.mjs" adversarial-review --background/i);
  assert.doesNotMatch(adversarial, /claude-companion\.mjs" adversarial-review \$ARGUMENTS/i);
});

test("rescue skill keeps --background and --wait as host-side controls only", () => {
  const rescue = read("skills/rescue/SKILL.md");

  assert.match(rescue, /`--background` and `--wait` are Codex-side execution controls only/i);
  assert.match(rescue, /Never forward either flag to `claude-companion\.mjs task`/i);
  assert.match(rescue, /The main Codex thread owns that execution-mode choice/i);
  assert.match(rescue, /If the user explicitly passed `--background`, run the rescue subagent in the background/i);
  assert.match(rescue, /If neither flag is present and the rescue request is small, clearly bounded, or likely to finish quickly, prefer foreground/i);
  assert.match(rescue, /If neither flag is present and the request looks complicated, open-ended, multi-step, or likely to keep Claude Code running for a while, prefer background execution for the subagent/i);
  assert.match(rescue, /This size-and-scope heuristic belongs to the main Codex thread/i);
  assert.match(rescue, /If the user task text itself begins with a slash command such as `\/simplify`/i);
  assert.match(rescue, /Remove `--background` and `--wait` before spawning the subagent/i);
  assert.match(rescue, /If the free-text task begins with `\/`, preserve it verbatim/i);
  assert.match(rescue, /--quiet-progress/i);
  assert.match(rescue, /--owner-session-id <parent-session-id>/i);
  assert.match(rescue, /Foreground rescue must add `--view-state on-success`/i);
  assert.match(rescue, /Background rescue must add `--view-state defer`/i);
  assert.match(rescue, /Background: spawn the rescue subagent without waiting for it in this turn/i);
  assert.match(rescue, /The subagent still runs the companion `task` command in the foreground/i);
  assert.match(rescue, /tell the user `Claude Code rescue started in the background\. Check \$cc:status for progress\.`/i);
});

test("rescue skill documents the experimental built-in-agent forwarding path", () => {
  const rescue = read("skills/rescue/SKILL.md");
  const rescueAgentMeta = read("skills/rescue/agents/openai.yaml");
  const frontmatter = rescue.split("---")[1] ?? "";
  const supportedArgumentsLine =
    rescue
      .split("\n")
      .find((line) => line.startsWith("Supported arguments:")) ?? "";

  assert.doesNotMatch(frontmatter, /--builtin-agent/i);
  assert.doesNotMatch(supportedArgumentsLine, /--builtin-agent/i);
  assert.doesNotMatch(rescueAgentMeta, /--builtin-agent/i);
  assert.match(rescue, /By default, hand this skill off through Codex's built-in `default` subagent/i);
  assert.match(rescue, /legacy request still includes `--builtin-agent`/i);
  assert.match(rescue, /compatibility alias for the default built-in path/i);
  assert.match(rescue, /must set `model: "gpt-5\.4"` and `reasoning_effort: "medium"` on `spawn_agent`/i);
  assert.match(rescue, /the parent thread owns prompt shaping/i);
  assert.match(rescue, /If the built-in rescue request is vague, chatty, or a follow-up, the parent may tighten only the task text/i);
  assert.match(rescue, /Use the `task-prompt-shaping` internal rules as guidance/i);
  assert.match(rescue, /If the request is already concrete, keep it literal/i);
  assert.match(rescue, /rewrite it into a short delta that names the next thing Claude Code should change or inspect/i);
  assert.match(rescue, /preserve the language mix and only tighten the execution intent/i);
  assert.match(rescue, /make that output contract explicit instead of broadening the task/i);
  assert.match(rescue, /prefer a short delta instruction for resume follow-ups/i);
  assert.match(rescue, /The child must not do an additional interpretation pass/i);
  assert.match(rescue, /prefer `--resume` or `--resume-last` with a short delta instruction/i);
  assert.match(rescue, /compact strict forwarding message/i);
  assert.match(rescue, /transient forwarding worker for Claude Code rescue/i);
  assert.match(rescue, /include exactly one shell command to run/i);
  assert.match(rescue, /not to inspect the repository, read files, grep, or do the task directly/i);
  assert.match(rescue, /return only that command's stdout text exactly/i);
  assert.match(rescue, /copy the resolved rescue task text byte-for-byte/i);
  assert.match(rescue, /forbid appending terminal punctuation, adding quotes, dropping prefixes such as `completed:`/i);
  assert.match(rescue, /completed:\/simplify make the output compact/i);
});

test("rescue runtime guidance forbids task --background", () => {
  const runtimeSkill = read("internal-skills/cli-runtime/SKILL.md");

  assert.match(runtimeSkill, /`--background` and `--wait` are parent-side execution controls only/i);
  assert.match(runtimeSkill, /Strip both before building the `task` command/i);
  assert.match(runtimeSkill, /Never call `task --background` or invent `task --wait`\./i);
  assert.match(runtimeSkill, /The companion task command always runs in the foreground/i);
  assert.match(runtimeSkill, /`--owner-session-id` as routing controls/i);
  assert.match(runtimeSkill, /Treat `--quiet-progress` as an internal routing control/i);
  assert.match(runtimeSkill, /If the free-text task begins with `\/`, treat that slash command as literal Claude Code task text/i);
  assert.match(runtimeSkill, /`--quiet-progress` suppresses companion stderr progress output/i);
  assert.match(runtimeSkill, /It does not change the companion command you build/i);
  assert.match(runtimeSkill, /`--view-state on-success` means the user will see this companion result in the current turn/i);
  assert.match(runtimeSkill, /`--view-state defer` means the parent is not waiting/i);
  assert.match(runtimeSkill, /`--owner-session-id <session-id>` is an internal parent-session routing control/i);
});

test("rescue parent skill owns resume-candidate exploration", () => {
  const rescue = read("skills/rescue/SKILL.md");
  const runtimeSkill = read("internal-skills/cli-runtime/SKILL.md");

  assert.match(rescue, /task-resume-candidate --json/i);
  assert.match(rescue, /Continue current Claude Code thread/i);
  assert.match(rescue, /Start a new Claude Code thread/i);

  assert.doesNotMatch(runtimeSkill, /task-resume-candidate --json/i);
  assert.doesNotMatch(runtimeSkill, /Continue current Claude Code thread/i);
  assert.doesNotMatch(runtimeSkill, /Start a new Claude Code thread/i);
  assert.match(runtimeSkill, /The parent rescue skill already owns that choice/i);
});

test("setup skill auto-installs missing hooks before the final setup report", () => {
  const setup = read("skills/setup/SKILL.md");

  assert.match(setup, /setup --json/i);
  assert.match(setup, /If setup reports missing hooks, run:/i);
  assert.match(setup, /node "<plugin-root>\/scripts\/install-hooks\.mjs"/i);
  assert.match(setup, /rerun the final setup command so the user sees the repaired state immediately/i);
});
