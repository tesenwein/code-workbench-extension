export interface BundledSkill {
  /** Skill folder name and slash-command name. */
  name: string;
  /** Full SKILL.md file contents, including frontmatter. */
  body: string;
}

/** Every skill the workbench installs. */
export const BUNDLED_SKILLS: BundledSkill[];

/** Skill folder names shipped by older versions — removed on (re)install. */
export const LEGACY_SKILL_NAMES: string[];
