// Bundled Claude Workbench skills (slash-command scripts), shared by the
// Electron app and the VS Code extension. ONE source of truth — each consumer
// installs these into a `.claude/skills/<name>/SKILL.md` directory.
//
// CommonJS implementation so synced consumers can `require` it; `skills.mjs`
// is a thin ESM re-export shim.
//
// Each skill lives in its own file under `./skills/`; this module is just the
// index that assembles them. To add a skill: create `./skills/<name>.cjs`
// exporting `{ name, body }` and add it to BUNDLED_SKILLS below.

"use strict";

const CW_WORK = require("./skills/cw-work.cjs");
const CW_PLAN = require("./skills/cw-plan.cjs");
const CW_ARCH = require("./skills/cw-arch.cjs");
const CW_ARCH_AUDIT = require("./skills/cw-arch-audit.cjs");
const DUPLICATE_CLEANUP = require("./skills/cw-duplicate-cleanup.cjs");
const CW_DEAD_CODE = require("./skills/cw-dead-code.cjs");
const CW_TYPE_SAFETY = require("./skills/cw-type-safety.cjs");

/** Every skill the workbench installs. */
const BUNDLED_SKILLS = [
  CW_WORK,
  CW_PLAN,
  CW_ARCH,
  CW_ARCH_AUDIT,
  DUPLICATE_CLEANUP,
  CW_DEAD_CODE,
  CW_TYPE_SAFETY,
];

/**
 * Skill folder names shipped by older versions. Removed on (re)install so a
 * stale copy can't shadow the current skill under a legacy name.
 */
const LEGACY_SKILL_NAMES = [
  "claudeworkbench-plan",
  "claudeworkbench-tasks",
  "claudeworkbench-task-execute",
  "cwb-plan",
  "cwb-work",
  "cwb-duplicate-cleanup",
  "duplicate-cleanup",
  "wb-plan",
  "wb-work",
];

module.exports = { BUNDLED_SKILLS, LEGACY_SKILL_NAMES };
