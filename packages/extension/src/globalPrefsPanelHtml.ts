import * as vscode from 'vscode';
import { randomBytes } from 'crypto';
import { CLAUDE_MODELS, EFFORT_LABELS } from './sessions';
import {
  PHASE_DESCRIPTIONS,
  PHASE_META,
  PHASE_ORDER,
} from '@code-workbench/mcp-core/phase-prompts';
import type { GlobalPrefs } from './globalPrefs';
import { themeTokenDecls, hcOverrideCss } from './webviewTheme';

/** Serialize to JSON and escape characters that could break an inline script context. */
function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/-->/g, '\\u002d\\u002d>');
}

export function renderGlobalPrefsHtml(state: GlobalPrefs): string {
  const nonce = randomBytes(16).toString('base64');
  const initial = safeJson(state);
  const models = CLAUDE_MODELS.map(
    (m) => `<option value="${m.value}">${m.label}</option>`,
  ).join('');
  // The phase selects carry their own 'default' option ("inherit the phase's
  // built-in model"), so the concrete models must not repeat that value.
  const phaseModelOptions = CLAUDE_MODELS.filter((m) => m.value !== 'default')
    .map((m) => `<option value="${m.value}">${m.label}</option>`)
    .join('');
  const effortLabels = safeJson(EFFORT_LABELS);
  const modelMeta = safeJson(CLAUDE_MODELS);
  const sessionPanel = vscode.workspace
    .getConfiguration('codeWorkbench')
    .get<string>('sessionPanel', 'panel');
  return /* html */ `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<style>
  :root {${themeTokenDecls('editor')}
    --radius: 6px;
    --radius-sm: 4px;
    --nav-w: 200px;
    --content-max: 640px;
  }
  ${hcOverrideCss()}
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; padding: 0; }
  body {
    font-family: var(--font-ui);
    color: var(--fg-0);
    background: var(--bg-0);
    min-height: 100vh;
    font-feature-settings: 'ss01', 'cv11';
  }
  body::before {
    content: '';
    position: fixed; inset: 0;
    pointer-events: none; z-index: -1;
    background-image:
      radial-gradient(circle at 8% -5%, color-mix(in srgb, var(--clay) 10%, transparent), transparent 38%),
      radial-gradient(circle at 110% 110%, color-mix(in srgb, var(--clay) 6%, transparent), transparent 50%);
    background-repeat: no-repeat;
  }

  .shell {
    display: grid;
    grid-template-columns: var(--nav-w) minmax(0, 1fr);
    max-width: 1080px;
    margin: 0 auto;
    padding: 0 32px;
  }

  /* ── Sidebar ─────────────────────────────────────── */
  .side {
    position: sticky; top: 0; align-self: start;
    height: 100vh; padding: 28px 24px 24px 0;
    border-right: 1px solid var(--rule);
    display: flex; flex-direction: column; gap: 18px;
  }
  .brand { display: flex; align-items: baseline; gap: 8px; }
  .brand .spark {
    font-size: 15px; color: var(--clay);
    animation: spark 4.5s ease-in-out infinite;
    text-shadow: 0 0 14px var(--clay-line);
  }
  @keyframes spark {
    0%,100% { opacity: 0.8; transform: rotate(0) scale(1); }
    50%     { opacity: 1;   transform: rotate(45deg) scale(1.12); }
  }
  .brand .name { font-family: var(--font-serif); font-size: 19px; font-weight: 500; letter-spacing: -0.01em; }
  .brand .name em { font-style: italic; color: var(--clay-bright); font-weight: 400; }
  .kicker {
    font-family: var(--font-mono); font-size: 9.5px;
    letter-spacing: 0.18em; text-transform: uppercase;
    color: var(--fg-3);
  }

  .nav { display: flex; flex-direction: column; gap: 1px; margin-top: 4px; }
  .nav a {
    display: flex; align-items: center; gap: 10px;
    padding: 7px 0; padding-left: 10px;
    border-left: 1px solid var(--rule);
    text-decoration: none;
    font-family: var(--font-ui); font-size: 12.5px;
    color: var(--fg-2); letter-spacing: 0.002em;
    transition: color .14s ease, border-color .14s ease, padding-left .14s ease;
  }
  .nav a .num {
    font-family: var(--font-mono); font-size: 9.5px;
    color: var(--fg-4); letter-spacing: 0.06em;
    width: 20px;
  }
  .nav a:hover { color: var(--fg-0); border-left-color: var(--clay-line); }
  .nav a.active { color: var(--clay-bright); border-left-color: var(--clay); padding-left: 12px; }
  .nav a.active .num { color: var(--clay); }

  .side .foot {
    margin-top: auto; padding-top: 14px;
    border-top: 1px solid var(--rule);
    font-family: var(--font-mono); font-size: 10px;
    color: var(--fg-4); line-height: 1.5;
    word-break: break-all;
  }
  .side .foot .lbl { color: var(--fg-3); letter-spacing: 0.08em; text-transform: uppercase; display: block; margin-bottom: 4px; }

  /* ── Main ─────────────────────────────────────────── */
  main {
    padding: 36px 0 80px 36px;
    max-width: calc(var(--content-max) + 36px);
  }
  .pretitle {
    font-family: var(--font-mono); font-size: 10px;
    letter-spacing: 0.22em; text-transform: uppercase;
    color: var(--fg-3); margin: 0 0 10px;
  }
  .pagetitle {
    font-family: var(--font-serif); font-style: italic;
    font-size: 38px; font-weight: 400; letter-spacing: -0.015em;
    line-height: 1.1; margin: 0 0 8px;
  }
  .pagetitle em { color: var(--clay-bright); font-style: italic; }
  .pagelede {
    font-family: var(--font-serif); font-size: 14px;
    color: var(--fg-2); line-height: 1.55;
    max-width: 480px; margin: 0 0 40px;
  }

  section { scroll-margin-top: 24px; margin-bottom: 44px; }
  .secthead {
    display: flex; align-items: baseline; gap: 12px;
    margin: 0 0 4px;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--rule);
  }
  .secthead .num {
    font-family: var(--font-mono); font-size: 10px;
    color: var(--clay); letter-spacing: 0.1em;
  }
  .secthead h2 {
    font-family: var(--font-ui); font-size: 13px;
    letter-spacing: 0.16em; text-transform: uppercase;
    font-weight: 600; color: var(--fg-0); margin: 0;
  }
  .secthead .tag {
    margin-left: auto; font-family: var(--font-mono); font-size: 10px;
    color: var(--fg-3); letter-spacing: 0.06em;
  }
  .sectlede {
    font-family: var(--font-serif); font-style: italic;
    font-size: 12.5px; color: var(--fg-2);
    margin: 12px 0 18px; max-width: 480px; line-height: 1.5;
  }

  /* Field */
  .field { margin-bottom: 18px; }
  .field:last-child { margin-bottom: 0; }
  .field-head {
    display: flex; align-items: baseline; gap: 10px;
    margin-bottom: 6px;
  }
  .field-head label {
    font-family: var(--font-ui); font-size: 10px;
    letter-spacing: 0.14em; text-transform: uppercase;
    font-weight: 600; color: var(--fg-1); margin: 0;
  }
  .field-head .value {
    font-family: var(--font-mono); font-size: 10.5px;
    color: var(--clay); letter-spacing: 0.04em;
  }
  .field-head .aux {
    margin-left: auto; font-family: var(--font-mono); font-size: 10px;
    color: var(--fg-3);
  }
  .hint {
    font-family: var(--font-serif); font-style: italic;
    font-size: 11.5px; color: var(--fg-3);
    margin-top: 6px; line-height: 1.5;
  }
  .hint code, .sectlede code {
    font-family: var(--font-mono); font-style: normal;
    font-size: 10.5px; color: var(--fg-1);
    background: var(--bg-2); padding: 1px 5px;
    border-radius: 3px;
  }

  select, input[type="text"], textarea {
    width: 100%; padding: 8px 11px;
    font-family: var(--font-mono); font-size: 12px;
    background: var(--bg-1); color: var(--fg-0);
    border: 1px solid var(--border); border-radius: var(--radius-sm);
    transition: border-color .14s ease, box-shadow .14s ease, background .14s ease;
  }
  textarea { resize: vertical; min-height: 96px; line-height: 1.5; }
  select:hover, input[type="text"]:hover, textarea:hover { border-color: var(--clay-line); }
  select:focus, input[type="text"]:focus, textarea:focus {
    outline: none; border-color: var(--clay);
    box-shadow: 0 0 0 3px var(--clay-ghost);
    background: var(--bg-2);
  }
  input[type="range"] { width: 100%; accent-color: var(--clay); margin: 6px 0 4px; }

  /* Two-column grid for compact pairs */
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
  @media (max-width: 760px) { .grid-2 { grid-template-columns: 1fr; } }

  .ticks {
    display: flex; justify-content: space-between;
    font-family: var(--font-mono); font-size: 9px; letter-spacing: 0.06em;
    color: var(--fg-4); margin-top: 2px; user-select: none;
    text-transform: uppercase;
  }
  .ticks span { flex: 1; text-align: center; }
  .ticks span:first-child { text-align: left; }
  .ticks span:last-child { text-align: right; }

  /* Toggle row */
  .toggle {
    display: flex; align-items: center; gap: 12px;
    padding: 11px 13px; background: var(--bg-1);
    border: 1px solid var(--rule); border-radius: var(--radius);
    transition: border-color .14s ease;
  }
  .toggle:hover { border-color: var(--clay-line); }
  .toggle input { margin: 0; accent-color: var(--clay); width: 14px; height: 14px; }
  .toggle .tlabel {
    font-family: var(--font-ui); font-size: 13px; color: var(--fg-0);
    font-weight: 500;
  }
  .toggle .tnote {
    margin-left: auto;
    font-family: var(--font-mono); font-size: 10.5px;
    color: var(--fg-3);
  }
  .toggle .tnote:empty { display: none; }

  .disabled { opacity: 0.42; pointer-events: none; }

  /* Buttons */
  .btnrow { display: flex; gap: 8px; flex-wrap: wrap; }
  .btn {
    background: var(--bg-1); border: 1px solid var(--border);
    color: var(--fg-1); border-radius: var(--radius-sm);
    padding: 7px 13px; cursor: pointer;
    font-family: var(--font-ui); font-size: 12px; font-weight: 500;
    letter-spacing: 0.02em;
    transition: all .14s ease;
  }
  .btn:hover {
    border-color: var(--clay); color: var(--fg-0);
    background: var(--bg-2);
    box-shadow: 0 0 0 3px var(--clay-ghost);
  }
  .btn.primary {
    background: var(--clay); color: #1a0f0a;
    border-color: var(--clay-deep);
    font-weight: 600;
  }
  .btn.primary:hover { background: var(--clay-bright); color: #1a0f0a; }
  .btn.ghost { background: transparent; border-color: var(--rule); }

  /* Prompts */
  .prompt {
    border: 1px solid var(--rule); border-radius: var(--radius);
    padding: 12px 14px; margin-bottom: 10px; background: var(--bg-1);
    transition: border-color .14s ease;
    position: relative;
  }
  .prompt::before {
    content: ''; position: absolute; left: -1px; top: 12px; bottom: 12px;
    width: 2px; background: var(--clay); border-radius: 2px;
    opacity: 0.5; transition: opacity .14s ease;
  }
  .prompt:hover { border-color: var(--border); }
  .prompt:hover::before { opacity: 1; }
  .prompt.disabled-prompt { opacity: 0.55; }
  .prompt.disabled-prompt::before { background: var(--fg-4); }
  .prompt-head {
    display: flex; align-items: center; gap: 10px; margin-bottom: 10px;
  }
  .prompt-head input[type="text"] {
    flex: 1; font-family: var(--font-serif); font-size: 13.5px;
    background: transparent; border-color: transparent;
    padding: 4px 6px;
  }
  .prompt-head input[type="text"]:hover { background: var(--bg-2); border-color: var(--rule); }
  .prompt-head input[type="text"]:focus { background: var(--bg-2); border-color: var(--clay); }
  .prompt-head input[type="checkbox"] { margin: 0; accent-color: var(--clay); width: 14px; height: 14px; }
  .iconbtn {
    background: transparent; border: 1px solid var(--rule);
    color: var(--fg-3); border-radius: var(--radius-sm);
    padding: 4px 9px; cursor: pointer; font-family: var(--font-mono); font-size: 10.5px;
    letter-spacing: 0.04em;
    transition: all .14s ease;
  }
  .iconbtn:hover { border-color: var(--clay-line); color: var(--fg-0); background: var(--bg-2); }
  .iconbtn.danger:hover { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 42%, transparent); }

  .addbtn {
    margin-top: 4px;
    background: transparent;
    border: 1px dashed var(--clay-line);
    color: var(--clay-bright);
    width: 100%; padding: 12px;
    border-radius: var(--radius);
    cursor: pointer;
    font-family: var(--font-ui); font-size: 12px; font-weight: 500;
    letter-spacing: 0.04em;
    transition: background .14s ease, border-color .14s ease;
  }
  .addbtn:hover { background: var(--clay-ghost); border-style: solid; border-color: var(--clay); }

  /* Selection chips for model */
  .chips { display: flex; gap: 6px; flex-wrap: wrap; }
  .chip {
    flex: 1; min-width: 78px;
    text-align: center; cursor: pointer;
    padding: 9px 10px;
    font-family: var(--font-mono); font-size: 11px;
    letter-spacing: 0.06em; text-transform: lowercase;
    background: var(--bg-1); color: var(--fg-2);
    border: 1px solid var(--rule); border-radius: var(--radius-sm);
    transition: all .14s ease;
  }
  .chip:hover { color: var(--fg-0); border-color: var(--clay-line); }
  .chip.on {
    background: var(--clay-ghost); color: var(--clay-bright);
    border-color: var(--clay);
  }
</style>
</head>
<body>
  <div class="shell">
    <aside class="side">
      <div>
        <div class="brand">
          <span class="spark">✳</span>
          <span class="name">Code <em>Workbench</em></span>
        </div>
        <div class="kicker" style="margin-top:6px;">Global Settings</div>
      </div>

      <nav class="nav">
        <a href="#sec-appearance"><span class="num">01</span>Appearance</a>
        <a href="#sec-skills"><span class="num">02</span>Skills</a>
        <a href="#sec-mcp"><span class="num">02b</span>MCP</a>
        <a href="#sec-layout"><span class="num">03</span>Layout</a>
        <a href="#sec-defaults"><span class="num">04</span>Defaults</a>
        <a href="#sec-phases"><span class="num">04b</span>Task Flow</a>
        <a href="#sec-binary"><span class="num">05</span>Binary</a>
        <a href="#sec-prompts"><span class="num">06</span>Prompts</a>
      </nav>

      <div class="foot">
        <span class="lbl">Stored at</span>
        <span id="pathnote">~/.code-workbench/settings.json</span>
      </div>
    </aside>

    <main>
      <div class="pretitle">Workbench / Preferences</div>
      <h1 class="pagetitle">Make it <em>yours.</em></h1>
      <p class="pagelede">Defaults, behavior, and chrome for every worktree you open. Changes save instantly; some VS Code tweaks require a window reload.</p>

      <section id="sec-appearance">
        <div class="secthead">
          <span class="num">01</span><h2>Appearance</h2>
          <span class="tag">vs code</span>
        </div>
        <p class="sectlede">One-shot tweaks that write to your VS Code user settings.</p>
        <div class="btnrow">
          <button class="btn" id="applyMinimalLayout">Apply minimal layout</button>
          <button class="btn" id="applyFonts">Apply Workbench fonts</button>
        </div>
        <div class="hint">Reload the window afterwards to see all changes take effect.</div>

        <div class="field toggle" style="margin-top:18px;">
          <input id="openOnStartup" type="checkbox" />
          <label for="openOnStartup" class="tlabel">Open Workbench on VS Code startup</label>
          <span class="tnote">auto-focus the sidebar</span>
        </div>
      </section>

      <section id="sec-skills">
        <div class="secthead">
          <span class="num">02</span><h2>Workbench Skills</h2>
          <span class="tag">.claude/skills/</span>
        </div>
        <p class="sectlede">Install <code>cw-plan</code> and <code>cw-work</code>. Re-run after upgrades.</p>
        <div class="btnrow">
          <button class="btn primary" id="installSkillsUser">Install skills</button>
        </div>
        <div class="hint">Installs to <code>~/.claude/skills/</code> so every project can use them. Writes SKILL.md files and removes any legacy-named skill folders. Re-run to update.</div>
      </section>

      <section id="sec-mcp">
        <div class="secthead">
          <span class="num">02b</span><h2>Workbench MCP Servers</h2>
          <span class="tag">.claude.json</span>
        </div>
        <p class="sectlede">Register the unified <code>cw-code</code> server so plain <code>claude</code> CLI sessions (outside the workbench) can use every workbench tool.</p>
        <div class="btnrow">
          <button class="btn primary" id="registerMcpUser">Register MCP servers</button>
        </div>
        <div class="hint">Writes <code>cw-code</code> to <code>~/.claude.json</code>, exposing AST, dead-code, type-safety, tasks, and arch tools to plain <code>claude</code> CLI sessions. Session-only tools like notifications stay inert there. Re-run to update.</div>
      </section>

      <section id="sec-layout">
        <div class="secthead">
          <span class="num">03</span><h2>Layout</h2>
          <span class="tag">where sessions open</span>
        </div>
        <div class="field">
          <div class="field-head"><label>Session placement</label></div>
          <select id="sessionPanel">
            <option value="editor"${sessionPanel === 'editor' ? ' selected' : ''}>Editor area — dedicated tab</option>
            <option value="panel"${sessionPanel === 'panel' ? ' selected' : ''}>Bottom terminal panel</option>
            <option value="bottom-group"${sessionPanel === 'bottom-group' ? ' selected' : ''}>Reserved bottom editor group</option>
          </select>
          <div class="hint">The reserved bottom group creates a locked editor group below the main editor on first use and routes new sessions there.</div>
        </div>
      </section>

      <section id="sec-defaults">
        <div class="secthead">
          <span class="num">04</span><h2>Defaults</h2>
          <span class="tag">for new worktrees</span>
        </div>

        <div class="field">
          <div class="field-head">
            <label>Model</label>
            <span class="value" id="modelValue"></span>
          </div>
          <div class="chips" id="modelChips">
            ${CLAUDE_MODELS.map((m) => `<button type="button" class="chip" data-model="${m.value}">${m.label}</button>`).join('')}
          </div>
          <select id="model" style="display:none;">${models}</select>
        </div>

        <div class="field" id="effortRow">
          <div class="field-head">
            <label>Thinking effort</label>
            <span class="value" id="effortValue"></span>
            <span class="aux" id="effortHint"></span>
          </div>
          <input id="effort" type="range" min="0" max="4" step="1" />
          <div class="ticks">
            <span>auto</span><span>think</span><span>hard</span><span>harder</span><span>ultra</span>
          </div>
        </div>

        <div class="field toggle">
          <input id="yolo" type="checkbox" />
          <label for="yolo" class="tlabel">Yolo by default</label>
          <span class="tnote" id="yoloArgsValue"></span>
        </div>
      </section>

      <section id="sec-phases">
        <div class="secthead">
          <span class="num">04b</span><h2>Task Flow</h2>
          <span class="tag">model per phase</span>
        </div>
        <p class="sectlede">
          Which model the Phase Board spawns for each phase of Plan → Implement → Review → Fix.
          A worktree's own Claude settings can override any of these.
        </p>
        ${PHASE_ORDER.map(
          (phase) => `
        <div class="field">
          <div class="field-head">
            <label for="phase-${phase}">${PHASE_META[phase].label}</label>
            <span class="aux">${PHASE_DESCRIPTIONS[phase]}</span>
          </div>
          <select id="phase-${phase}" class="phase-model" data-phase="${phase}">
            <option value="default">phase default (${PHASE_META[phase].model})</option>
            ${phaseModelOptions}
          </select>
        </div>`,
        ).join('')}
      </section>

      <section id="sec-binary">
        <div class="secthead">
          <span class="num">05</span><h2>Claude Binary</h2>
          <span class="tag">how to launch</span>
        </div>
        <div class="grid-2">
          <div class="field">
            <div class="field-head"><label>Command</label></div>
            <input id="claudeCommand" type="text" spellcheck="false" />
            <div class="hint">Path or name of the Claude CLI — <code>claude</code> or an absolute path.</div>
          </div>
          <div class="field">
            <div class="field-head"><label>Yolo args</label></div>
            <input id="yoloArgs" type="text" spellcheck="false" />
            <div class="hint">Flags appended when Yolo mode is on. Space-separated.</div>
          </div>
        </div>
      </section>

      <section id="sec-prompts">
        <div class="secthead">
          <span class="num">06</span><h2>Prompts</h2>
          <span class="tag">--append-system-prompt</span>
        </div>
        <p class="sectlede">These are appended to every Claude session you start. Toggle individually.</p>
        <div id="prompts"></div>
        <button class="addbtn" id="addPrompt">＋ &nbsp;Add prompt</button>
      </section>

    </main>
  </div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const EFFORT_LABELS = ${effortLabels};
  const MODEL_META = ${modelMeta};
  const modelInfo = (v) => MODEL_META.find((m) => m.value === v) || MODEL_META[0];
  let state = ${initial};

  const modelEl = document.getElementById('model');
  const modelValueEl = document.getElementById('modelValue');
  const effortEl = document.getElementById('effort');
  const effortValueEl = document.getElementById('effortValue');
  const effortRowEl = document.getElementById('effortRow');
  const effortHintEl = document.getElementById('effortHint');
  const yoloEl = document.getElementById('yolo');
  const openOnStartupEl = document.getElementById('openOnStartup');
  const yoloArgsValueEl = document.getElementById('yoloArgsValue');
  const claudeCommandEl = document.getElementById('claudeCommand');
  const yoloArgsEl = document.getElementById('yoloArgs');
  const promptsEl = document.getElementById('prompts');
  const addPromptEl = document.getElementById('addPrompt');
  const pathnoteEl = document.getElementById('pathnote');

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) =>
      c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;'
      : c === '"' ? '&quot;' : '&#39;');
  }

  function renderPrompts() {
    promptsEl.innerHTML = state.prompts.map((p) => \`
      <div class="prompt \${p.enabled ? '' : 'disabled-prompt'}" data-id="\${escapeHtml(p.id)}">
        <div class="prompt-head">
          <input type="checkbox" class="p-enabled" \${p.enabled ? 'checked' : ''} />
          <input type="text" class="p-name" value="\${escapeHtml(p.name)}" placeholder="Prompt name" />
          <button class="iconbtn danger p-delete" title="Delete prompt">delete</button>
        </div>
        <textarea class="p-body" placeholder="System prompt body — appended via --append-system-prompt">\${escapeHtml(p.body)}</textarea>
      </div>\`).join('');

    for (const el of promptsEl.querySelectorAll('.prompt')) {
      const id = el.dataset.id;
      el.querySelector('.p-enabled').addEventListener('change', (e) => {
        vscode.postMessage({ type: 'updatePrompt', value: { id, enabled: e.target.checked } });
      });
      const nameEl = el.querySelector('.p-name');
      nameEl.addEventListener('change', () => {
        vscode.postMessage({ type: 'updatePrompt', value: { id, name: nameEl.value } });
      });
      const bodyEl = el.querySelector('.p-body');
      bodyEl.addEventListener('change', () => {
        vscode.postMessage({ type: 'updatePrompt', value: { id, body: bodyEl.value } });
      });
      el.querySelector('.p-delete').addEventListener('click', () => {
        vscode.postMessage({ type: 'deletePrompt', value: id });
      });
    }
  }

  const modelChipsEl = document.getElementById('modelChips');
  const phaseModelEls = Array.from(document.querySelectorAll('.phase-model'));

  for (const el of phaseModelEls) {
    el.addEventListener('change', () => {
      vscode.postMessage({
        type: 'setPhaseModel',
        value: { phase: el.dataset.phase, model: el.value },
      });
    });
  }

  function render() {
    modelEl.value = state.defaults.model;
    modelValueEl.textContent = state.defaults.model;
    if (modelChipsEl) {
      for (const c of modelChipsEl.querySelectorAll('.chip')) {
        c.classList.toggle('on', c.dataset.model === state.defaults.model);
      }
    }
    effortEl.value = String(state.defaults.effort);
    const noThinking = !modelInfo(state.defaults.model).thinking;
    effortValueEl.textContent = noThinking ? 'n/a' : EFFORT_LABELS[state.defaults.effort];
    effortRowEl.classList.toggle('disabled', noThinking);
    effortHintEl.textContent = noThinking
      ? modelInfo(state.defaults.model).label + ' · no extended thinking'
      : '';
    yoloEl.checked = !!state.defaults.yolo;
    openOnStartupEl.checked = !!state.openOnStartup;
    yoloArgsValueEl.textContent = state.claudeYoloArgs;
    if (document.activeElement !== claudeCommandEl) claudeCommandEl.value = state.claudeCommand;
    if (document.activeElement !== yoloArgsEl) yoloArgsEl.value = state.claudeYoloArgs;
    for (const el of phaseModelEls) {
      el.value = (state.phaseModels || {})[el.dataset.phase] || 'default';
    }
    renderPrompts();
  }

  if (modelChipsEl) {
    modelChipsEl.addEventListener('click', (e) => {
      const t = e.target.closest('.chip');
      if (!t) return;
      state.defaults.model = t.dataset.model;
      render();
      vscode.postMessage({ type: 'setModel', value: state.defaults.model });
    });
  }
  modelEl.addEventListener('change', () => {
    state.defaults.model = modelEl.value;
    render();
    vscode.postMessage({ type: 'setModel', value: state.defaults.model });
  });
  effortEl.addEventListener('input', () => {
    state.defaults.effort = Number(effortEl.value);
    render();
    vscode.postMessage({ type: 'setEffort', value: state.defaults.effort });
  });
  yoloEl.addEventListener('change', () => {
    state.defaults.yolo = yoloEl.checked;
    render();
    vscode.postMessage({ type: 'setYolo', value: state.defaults.yolo });
  });
  openOnStartupEl.addEventListener('change', () => {
    state.openOnStartup = openOnStartupEl.checked;
    vscode.postMessage({ type: 'setOpenOnStartup', value: state.openOnStartup });
  });
  claudeCommandEl.addEventListener('change', () => {
    vscode.postMessage({ type: 'setClaudeCommand', value: claudeCommandEl.value });
  });
  yoloArgsEl.addEventListener('change', () => {
    vscode.postMessage({ type: 'setYoloArgs', value: yoloArgsEl.value });
  });
  addPromptEl.addEventListener('click', () => {
    vscode.postMessage({ type: 'addPrompt' });
  });
  document.getElementById('applyMinimalLayout').addEventListener('click', () => {
    vscode.postMessage({ type: 'applyMinimalLayout' });
  });
  document.getElementById('applyFonts').addEventListener('click', () => {
    vscode.postMessage({ type: 'applyFonts' });
  });
  document.getElementById('installSkillsUser').addEventListener('click', () => {
    vscode.postMessage({ type: 'installWorkbenchSkills', value: 'user' });
  });
  document.getElementById('registerMcpUser').addEventListener('click', () => {
    vscode.postMessage({ type: 'registerWorkbenchMcp', value: 'user' });
  });
  document.getElementById('sessionPanel').addEventListener('change', (e) => {
    vscode.postMessage({ type: 'setSessionPanel', value: e.target.value });
  });

  window.addEventListener('message', (e) => {
    if (e.data?.type === 'state') {
      state = e.data.state;
      render();
    }
  });

  pathnoteEl.textContent = '~/.code-workbench/settings.json';

  // Scrollspy for sidebar nav
  const navLinks = Array.from(document.querySelectorAll('.nav a'));
  const sections = navLinks
    .map((a) => document.querySelector(a.getAttribute('href')))
    .filter(Boolean);
  const spy = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        const id = e.target.id;
        for (const a of navLinks) {
          a.classList.toggle('active', a.getAttribute('href') === '#' + id);
        }
      }
    }
  }, { rootMargin: '-20% 0px -70% 0px', threshold: 0 });
  for (const s of sections) spy.observe(s);
  if (navLinks[0]) navLinks[0].classList.add('active');

  render();
  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
}
