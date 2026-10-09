import { describe, it, expect } from "vitest";
import {
  PHASE_ORDER,
  phasePromptBulk,
  PHASE_META,
  phaseProcedure,
  phasePrompt,
  phaseSkill,
} from "../phase-prompts.cjs";

const TASK = { id: "abc123def456", title: "Fix login", description: "401 after SSO", memo: "plan…" };

describe("phaseProcedure", () => {
  it("substitutes the task id everywhere the placeholder appears", () => {
    for (const phase of PHASE_ORDER) {
      const text = phaseProcedure(phase, TASK.id);
      expect(text).not.toContain("{{TASK_ID}}");
      expect(text).toContain(TASK.id);
    }
  });

  it("rejects an unknown phase rather than emitting a placeholder-laden prompt", () => {
    expect(() => phaseProcedure("deploy", TASK.id)).toThrow(/Unknown phase/);
  });
});

describe("phasePrompt", () => {
  it("names the phase and carries the task's id, title, and description", () => {
    const prompt = phasePrompt("implement", TASK);
    expect(prompt.startsWith(`IMPLEMENT phase for task ${TASK.id}.`)).toBe(true);
    expect(prompt).toContain(`Task ${TASK.id}: ${TASK.title}`);
    expect(prompt).toContain(TASK.description);
  });

  it("names the task id in the header of every phase", () => {
    for (const phase of PHASE_ORDER) {
      expect(phasePrompt(phase, TASK)).toContain(`phase for task ${TASK.id}.`);
    }
  });

  it("includes the plan memo only for the Implement phase", () => {
    expect(phasePrompt("implement", TASK)).toContain("Plan memo:");
    expect(phasePrompt("review", TASK)).not.toContain("Plan memo:");
  });

  it("hands off to the next phase in the flow", () => {
    expect(phasePrompt("plan", TASK)).toContain('phase: "implement"');
    expect(phasePrompt("implement", TASK)).toContain('phase: "review"');
    expect(phasePrompt("review", TASK)).toContain('phase: "fix"');
  });

  it("hands Fix and a clean Review off to Ship, and Ship closes the task out", () => {
    expect(phasePrompt("fix", TASK)).toContain('phase: "ship"');
    expect(phasePrompt("review", TASK)).toContain('phase: "ship"');
    const ship = phasePrompt("ship", TASK);
    expect(ship).toContain("gh pr create");
    expect(ship).toContain("gh pr checks");
    expect(ship).toContain("prUrl");
    expect(ship).toContain('phase: "" (clear it), status: "done"');
  });

  it("routes Fix back to Review when new findings were filed", () => {
    expect(phasePrompt("fix", TASK)).toContain('phase: "review"');
  });

  it("gives every phase a blocked escape hatch that never advances the phase", () => {
    for (const phase of PHASE_ORDER) {
      expect(phasePrompt(phase, TASK)).toContain("If you get blocked");
    }
  });
});

describe("phaseSkill", () => {
  it("builds a cw-<phase> SKILL.md with frontmatter driven by $ARGUMENTS", () => {
    const skill = phaseSkill("review");
    expect(skill.name).toBe("cw-review");
    expect(skill.body).toContain("name: cw-review");
    expect(skill.body).toContain("$ARGUMENTS");
    expect(skill.body).not.toContain("{{TASK_ID}}");
  });

  it("shares its procedure text with the spawned phase prompt", () => {
    // The whole point of the shared module: a hand-run skill and a Start button
    // must give the session the same instructions.
    const skill = phaseSkill("fix");
    expect(skill.body).toContain(phaseProcedure("fix", "$ARGUMENTS"));
  });
});

describe("PHASE_META", () => {
  it("plans on opus and executes on sonnet", () => {
    expect(PHASE_META.plan.model).toBe("opus");
    for (const phase of ["implement", "review", "fix"]) {
      expect(PHASE_META[phase].model).toBe("sonnet");
    }
  });
});

describe("Ship phase wiring", () => {
  it("is the last phase and generates a cw-ship skill", () => {
    expect(PHASE_ORDER[PHASE_ORDER.length - 1]).toBe("ship");
    expect(phaseSkill("ship").name).toBe("cw-ship");
  });
});

describe("prefetched context", () => {
  it("adds a Context section before the procedure only when given", () => {
    const withCtx = phasePrompt("implement", TASK, "- card-a — A");
    expect(withCtx).toContain("## Context (prefetched, verify before relying on it)");
    expect(withCtx.indexOf("card-a")).toBeLessThan(withCtx.indexOf("If you get blocked"));
    expect(phasePrompt("implement", TASK)).not.toContain("## Context");
    expect(phasePrompt("implement", TASK, "   ")).not.toContain("## Context");
  });

  it("gives each bulk task its own context block", () => {
    const other = { ...TASK, id: "zzz999" };
    const prompt = phasePromptBulk("review", [TASK, other], { [other.id]: "ctx-for-other" });
    expect(prompt).toContain("ctx-for-other");
    expect(prompt.split("## Context").length).toBe(2);
  });
});

describe("code-health gate", () => {
  it("tells Review to file a finding per positive code-health regression", () => {
    const review = phasePrompt("review", TASK);
    expect(review).toContain('"Code health:"');
    expect(review).toContain("one \"review-finding\" subtask per regression");
    expect(phasePrompt("fix", TASK)).not.toContain('"Code health:"');
  });
});

describe("ship batching", () => {
  it("refuses a multi-task Ship prompt", () => {
    expect(() => phasePromptBulk("ship", [TASK, { ...TASK, id: "other" }])).toThrow(/one task/i);
  });
});
