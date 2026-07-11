export interface BundledAgent {
  /** Agent name — also the installed `<name>.md` file name. */
  name: string;
  /** Full agent .md file contents, including frontmatter. */
  body: string;
}

/** Every agent definition the workbench installs. */
export const BUNDLED_AGENTS: BundledAgent[];

/** Agent file names shipped by older versions — removed on (re)install. */
export const LEGACY_AGENT_NAMES: string[];
