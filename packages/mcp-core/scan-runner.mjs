// ESM re-export shim for scan-runner.cjs — shared scan execution + groupFingerprint.
export {
  groupFingerprint,
  runDeadCodeScan,
  runDuplicateScan,
  runTypeEscapeScan,
  runCodeSearch,
  runArchSearch,
} from "./scan-runner.cjs";
