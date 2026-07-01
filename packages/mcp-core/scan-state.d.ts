export type ScanFeature = "dead-code" | "duplicates" | "type-escapes";

export function ackFilePath(repoPath: string, feature: ScanFeature): string;
export function excludeFilePath(repoPath: string, feature: ScanFeature): string;
export function readAcks(
  repoPath: string,
  feature: ScanFeature,
): Promise<string[]>;
export function writeAcks(
  repoPath: string,
  feature: ScanFeature,
  fingerprints: string[],
): Promise<void>;
export function readExcludeDirs(
  repoPath: string,
  feature: ScanFeature,
): Promise<string[]>;
export function writeExcludeDirs(
  repoPath: string,
  feature: ScanFeature,
  dirs: string[],
): Promise<void>;
