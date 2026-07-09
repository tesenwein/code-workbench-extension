import { describe, it, expect } from "vitest";
import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { BUNDLED_WORKFLOWS } from "../workflows.cjs";

const execFileAsync = promisify(execFile);

/**
 * Split a bundled script into its `export const meta = {...}` literal and the
 * remainder of the body. The Workflow tool runtime executes the body inside
 * an async function, so a bare `return` at the top level is valid there but
 * not in a standalone module — brace-match `meta` out before syntax-checking
 * the rest.
 */
function splitMeta(script) {
  const marker = "export const meta = {";
  const start = script.indexOf(marker);
  expect(start, "script must start with export const meta = {").toBeGreaterThanOrEqual(0);
  let depth = 0;
  let end = -1;
  for (let i = start + marker.length - 1; i < script.length; i++) {
    if (script[i] === "{") depth++;
    else if (script[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  expect(end, "meta object literal must be closed").toBeGreaterThan(0);
  // Skip a trailing statement terminator if present.
  let bodyStart = end;
  if (script[bodyStart] === ";") bodyStart++;
  return { metaSource: script.slice(start, end), body: script.slice(bodyStart) };
}

describe("BUNDLED_WORKFLOWS", () => {
  it("has non-empty, unique names", () => {
    expect(BUNDLED_WORKFLOWS.length).toBeGreaterThan(0);
    const names = BUNDLED_WORKFLOWS.map(w => w.name);
    expect(names.every(n => typeof n === "string" && n.length > 0)).toBe(true);
    expect(new Set(names).size).toBe(names.length);
  });

  for (const workflow of BUNDLED_WORKFLOWS) {
    describe(workflow.name, () => {
      it("starts with a pure-literal export const meta", () => {
        expect(workflow.script.startsWith("export const meta = {")).toBe(true);
      });

      it("contains no Date.now/Math.random/argless new Date (they break resume)", () => {
        expect(workflow.script).not.toMatch(/Date\.now\(/);
        expect(workflow.script).not.toMatch(/Math\.random\(/);
        expect(workflow.script).not.toMatch(/new Date\(\)/);
      });

      it("every phase() call title has a matching meta.phases entry", () => {
        const { metaSource } = splitMeta(workflow.script);
        const metaFn = new Function(`return (${metaSource.replace(/^export const meta = /, "")});`);
        const meta = metaFn();
        const phaseTitles = new Set((meta.phases || []).map(p => p.title));
        const calledTitles = [...workflow.script.matchAll(/\bphase\('([^']+)'\)/g)].map(m => m[1]);
        for (const title of calledTitles) {
          expect(phaseTitles.has(title), `phase('${title}') has no meta.phases entry`).toBe(true);
        }
      });

      it("syntax-checks clean", async () => {
        const { body } = splitMeta(workflow.script);
        const wrapped = `export async function __run(agent, parallel, pipeline, phase, log, workflow, args, budget) {\n${body}\n}`;
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cw-workflow-"));
        const file = path.join(tmp, `${workflow.name}.mjs`);
        try {
          await fs.writeFile(file, wrapped);
          await expect(execFileAsync(process.execPath, ["--check", file])).resolves.toBeDefined();
        } finally {
          await fs.rm(tmp, { recursive: true, force: true });
        }
      });
    });
  }
});
