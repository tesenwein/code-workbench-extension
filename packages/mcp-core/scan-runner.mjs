// ESM re-export shim for scan-runner.cjs — shared scan execution + groupFingerprint.
export {
  groupFingerprint,
  runDeadCodeScan,
  runDuplicateScan,
  runTypeEscapeScan,
  runCodeSearch,
} from "./scan-runner.cjs";
