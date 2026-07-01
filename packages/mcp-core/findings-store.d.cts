import type { ScanFeature } from "./scan-state.cjs";
import type { DeadCodeItem, DuplicateGroup } from "./scan-types";

export const SCHEMA_VERSION: number;

export interface DeadCodeFindings {
  schemaVersion: number;
  generatedAt: number;
  root: string;
  items: DeadCodeItem[];
}

export interface DuplicateFindings {
  schemaVersion: number;
  generatedAt: number;
  root: string;
  groups: DuplicateGroup[];
}

export type Findings = DeadCodeFindings | DuplicateFindings;

export function findingsFilePath(
  repoPath: string,
  feature: ScanFeature,
): string;
export function readFindings(
  repoPath: string,
  feature: ScanFeature,
): Promise<Findings | null>;
export function writeFindings(
  repoPath: string,
  feature: ScanFeature,
  payload: { root: string; items?: DeadCodeItem[]; groups?: DuplicateGroup[] },
): Promise<void>;
