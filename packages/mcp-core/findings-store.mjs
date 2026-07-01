// ESM re-export shim for findings-store.cjs — persisted scan findings.
export {
  SCHEMA_VERSION,
  findingsFilePath,
  readFindings,
  writeFindings,
} from "./findings-store.cjs";
