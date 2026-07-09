export interface BundledWorkflow {
  /** Workflow name, passed as scriptPath basename and Workflow tool name. */
  name: string;
  /** Full workflow script source (plain JS, per the Workflow tool contract). */
  script: string;
}

/** Every workflow the workbench bundles. */
export const BUNDLED_WORKFLOWS: BundledWorkflow[];
