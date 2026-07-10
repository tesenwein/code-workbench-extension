import { describe, it, expect } from "vitest";
import {
  PHASE_ORDER,
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
  it("names the phase and carries the task's title and description", () => {
    const prompt = phasePrompt("implement", TASK);
    expect(prompt.startsWith("IMPLEMENT phase.")).toBe(true);
    expect(prompt).toContain(TASK.title);
    expect(prompt).toContain(TASK.description);
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
