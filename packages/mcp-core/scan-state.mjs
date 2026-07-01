// ESM re-export shim for scan-state.cjs — shared ack/exclude state for scans.
export {
  ackFilePath,
  excludeFilePath,
  readAcks,
  writeAcks,
  readExcludeDirs,
  writeExcludeDirs,
} from "./scan-state.cjs";
