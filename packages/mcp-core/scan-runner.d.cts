import type {
  CodeSearchResult,
  DeadCodeItem,
  DuplicateGroup,
  TypeEscapeItem,
} from "./scan-types";

export interface DeadCodeScanOpts {
  nodeBin: string;
  scriptPath: string;
  root: string;
  excludeDirs?: string[];
  categories?: string[];
  /** Environment for the spawned detector process. */
  env?: NodeJS.ProcessEnv;
  /** Repo path to persist findings under `.code-workbench/dead-code-findings.json`. */
  persistTo?: string;
}

export interface DuplicateScanOpts {
  nodeBin: string;
  scriptPath: string;
  root: string;
  excludeDirs?: string[];
  /** Environment for the spawned detector process. */
  env?: NodeJS.ProcessEnv;
  /** Repo path to persist findings under `.code-workbench/duplicates-findings.json`. */
  persistTo?: string;
}

export function groupFingerprint(group: {
  cloneType: string;
  members: Array<{
    file: string;
    name: string;
    startLine: number;
    /** Normalized-token hash; preferred (line-independent) identity. */
    normHash?: string;
  }>;
}): string;

export interface TypeEscapeScanOpts {
  nodeBin: string;
  scriptPath: string;
  root: string;
  excludeDirs?: string[];
  categories?: string[];
  /** Environment for the spawned detector process. */
  env?: NodeJS.ProcessEnv;
  /** Repo path to persist findings under `.code-workbench/type-escapes-findings.json`. */
  persistTo?: string;
}

export interface CodeSearchOpts {
  nodeBin: string;
  scriptPath: string;
  /** One or more directories to index and search. */
  roots: string[];
  /** Free-text query — a code fragment or plain-English description. */
  query: string;
  /** Cap on results returned (detector default: 20). */
  limit?: number;
  /** Restrict to these languages (e.g. 'typescript', 'python'). */
  langs?: string[];
  /** Environment for the spawned detector process. */
  env?: NodeJS.ProcessEnv;
}

export function runDeadCodeScan(
  opts: DeadCodeScanOpts,
): Promise<DeadCodeItem[]>;
export function runDuplicateScan(
  opts: DuplicateScanOpts,
): Promise<DuplicateGroup[]>;
export function runTypeEscapeScan(
  opts: TypeEscapeScanOpts,
): Promise<TypeEscapeItem[]>;
export function runCodeSearch(
  opts: CodeSearchOpts,
): Promise<CodeSearchResult[]>;
