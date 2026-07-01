export interface RegisterResult {
  configPath: string;
  registered: string[];
  skipped: { name: string; reason: string }[];
}

export interface RegisterIntoOpts {
  resolveScript: (filename: string) => string | null | undefined;
  wsl?: boolean;
  repoPath?: string | null;
  astGrammarsAvailable?: () => boolean;
}

export interface RegisterDualArgs extends RegisterIntoOpts {
  primaryConfigPath: string;
  mirrorToWsl?: boolean;
}

export declare const CODE_KEY: string;
export declare const MCP_SERVER_FILES: Record<string, string>;

export declare function windowsPathToWslPath(p: string): string;
export declare function pathForClaude(
  p: string,
  opts?: { wsl?: boolean },
): string;
export declare function getWslHomeWinPath(): Promise<string | null>;
export declare function registerStaticServersInto(
  configPath: string,
  opts: RegisterIntoOpts,
): Promise<RegisterResult>;
export declare function registerStaticServersDual(
  args: RegisterDualArgs,
): Promise<RegisterResult>;
