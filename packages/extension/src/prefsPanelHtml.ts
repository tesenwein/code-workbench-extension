import * as path from 'path';
import { randomBytes } from 'crypto';
import {
  CLAUDE_MODELS,
  ClaudeEffort,
  ClaudeModel,
  EFFORT_LABELS,
  WorktreeColor,
  WORKTREE_COLORS,
} from './sessions';

const COLOR_SWATCH: Record<WorktreeColor, string> = {
  default: 'transparent',
  red: '#3a2825',
  green: '#2c332a',
  yellow: '#3d3528',
  blue: '#28333a',
  magenta: '#352b30',
  cyan: '#2a3636',
};

export interface PrefsPanelState {
  model: ClaudeModel;
  effort: ClaudeEffort;
  yolo: boolean;
  color: WorktreeColor;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}

function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/-->/g, '\\u002d\\u002d>');
}

export function renderPrefsHtml(worktreePath: string, state: PrefsPanelState): string {
  const nonce = randomBytes(16).toString('base64');
  const name = path.basename(worktreePath);
  const initial = safeJson(state);
  const models = CLAUDE_MODELS.map(
    (m) => `<option value="${m.value}">${m.label}</option>`,
  ).join('');
  const effortLabels = safeJson(EFFORT_LABELS);
  const modelMeta = safeJson(CLAUDE_MODELS);
  const swatches = WORKTREE_COLORS.map((c) => {
    const bg = COLOR_SWATCH[c];
    const isDefault = c === 'default';
    return `<button class="swatch" data-color="${c}" title="${c}" style="background:${bg};${isDefault ? 'background-image:linear-gradient(45deg,transparent 45%,var(--fg-3) 45%,var(--fg-3) 55%,transparent 55%);' : ''}"></button>`;
  }).join('');
  return /* html */ `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<style>
  :root {
    color-scheme: dark;
    --bg-0: #181715;
    --bg-1: #1f1e1c;
    --bg-2: #262522;
    --bg-3: #2f2e2a;
    --bg-card: #1c1b19;
    --fg-0: #f3f0e7;
    --fg-1: #c4c0b4;
    --fg-2: #8b877c;
    --fg-3: #5f5c54;
    --fg-4: #403d38;
    --clay: #d97757;
    --clay-bright: #e8916f;
    --clay-deep: #b85c3e;
    --clay-ghost: rgba(217,119,87, 0.12);
    --clay-line: rgba(217,119,87, 0.30);
    --border: #34322e;
    --rule: #2a2825;
    --font-ui: 'Hanken Grotesk', system-ui, sans-serif;
    --font-serif: 'Newsreader', 'Iowan Old Style', Georgia, serif;
    --font-mono: 'JetBrains Mono', Menlo, monospace;
    --radius: 6px;
    --radius-sm: 4px;
    --nav-w: 200px;
    --content-max: 640px;
  }
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
      radial-gradient(circle at 8% -5%, rgba(217,119,87,0.10), transparent 38%),
      radial-gradient(circle at 110% 110%, rgba(217,119,87,0.06), transparent 50%);
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
  .wtchip {
    margin-top: 10px;
    display: inline-flex; align-items: center; gap: 7px;
    padding: 6px 9px 6px 8px;
    background: var(--bg-1);
    border: 1px solid var(--rule);
    border-left: 2px solid var(--clay);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono); font-size: 10.5px;
    color: var(--fg-1); letter-spacing: 0.02em;
    max-width: 100%; overflow: hidden;
  }
  .wtchip .dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: var(--clay);
    flex: 0 0 8px;
    box-shadow: 0 0 0 2px var(--bg-0), 0 0 0 3px var(--clay-line);
  }
  .wtchip .nm {
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-family: var(--font-serif); font-style: italic; font-size: 12.5px;
    color: var(--fg-0);
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
    word-break: break-word;
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
  .hint code {
    font-family: var(--font-mono); font-style: normal;
    font-size: 10.5px; color: var(--fg-1);
    background: var(--bg-2); padding: 1px 5px;
    border-radius: 3px;
  }

  select {
    width: 100%; padding: 8px 11px;
    font-family: var(--font-mono); font-size: 12px;
    background: var(--bg-1); color: var(--fg-0);
    border: 1px solid var(--border); border-radius: var(--radius-sm);
    transition: border-color .14s ease, box-shadow .14s ease, background .14s ease;
  }
  select:hover { border-color: var(--clay-line); }
  select:focus {
    outline: none; border-color: var(--clay);
    box-shadow: 0 0 0 3px var(--clay-ghost);
    background: var(--bg-2);
  }
  input[type="range"] { width: 100%; accent-color: var(--clay); margin: 6px 0 4px; }

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

  .disabled { opacity: 0.42; pointer-events: none; }

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

  /* Swatches */
  .swatches { display: flex; gap: 8px; flex-wrap: wrap; }
  .swatch {
    width: 28px; height: 28px;
    border-radius: 50%;
    border: 1px solid var(--border);
    padding: 0; cursor: pointer;
    background-clip: padding-box;
    transition: transform .12s ease, box-shadow .14s ease, border-color .14s ease;
  }
  .swatch:hover { transform: translateY(-1px); border-color: var(--clay-line); }
  .swatch:focus { outline: none; }
  .swatch.selected {
    border-color: var(--clay);
    box-shadow: 0 0 0 3px var(--clay-ghost), 0 0 0 1px var(--bg-0) inset;
  }

  /* Preview */
  .preview {
    margin-top: 12px;
    padding: 12px 14px;
    background: var(--bg-1);
    border: 1px solid var(--rule);
    border-left: 3px solid var(--clay);
    border-radius: var(--radius);
    font-family: var(--font-mono);
    font-size: 11.5px; line-height: 1.55;
    color: var(--fg-1);
    white-space: pre-wrap; word-break: break-all;
  }
  .preview .prompt-glyph {
    color: var(--clay); margin-right: 8px; user-select: none;
  }

  /* Action buttons */
  .btn {
    font-family: var(--font-ui); font-size: 12px; font-weight: 500;
    padding: 8px 14px; cursor: pointer;
    background: var(--bg-2); color: var(--fg-0);
    border: 1px solid var(--border); border-radius: var(--radius-sm);
    transition: border-color .14s ease, background .14s ease;
  }
  .btn:hover { border-color: var(--clay-line); background: var(--bg-3); }
  .btn:active { background: var(--clay-ghost); }
  .btn:disabled { opacity: 0.5; cursor: default; }
  .result {
    margin-top: 8px;
    font-family: var(--font-mono); font-size: 10.5px; line-height: 1.5;
    color: var(--fg-2);
  }
  .result.err { color: var(--clay-bright); }
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
        <div class="kicker" style="margin-top:6px;">Worktree Preferences</div>
        <div class="wtchip" title="${escapeHtml(worktreePath)}">
          <span class="dot" id="wtdot"></span>
          <span class="nm">${escapeHtml(name)}</span>
        </div>
      </div>

      <nav class="nav">
        <a href="#sec-identity"><span class="num">01</span>Identity</a>
        <a href="#sec-defaults"><span class="num">02</span>Defaults</a>
        <a href="#sec-launch"><span class="num">03</span>Launch</a>
        <a href="#sec-integration"><span class="num">04</span>Integration</a>
      </nav>

      <div class="foot">
        <span class="lbl">Path</span>
        <span>${escapeHtml(worktreePath)}</span>
      </div>
    </aside>

    <main>
      <div class="pretitle">Worktree / Preferences</div>
      <h1 class="pagetitle"><em>${escapeHtml(name)}</em></h1>
      <p class="pagelede">Overrides for this worktree only. Changes save instantly and apply to new sessions opened here.</p>

      <section id="sec-identity">
        <div class="secthead">
          <span class="num">01</span><h2>Identity</h2>
          <span class="tag">color & tag</span>
        </div>
        <p class="sectlede">Tints the worktree icon and the session terminal tab so this tree is easy to spot.</p>
        <div class="field">
          <div class="field-head">
            <label>Color</label>
            <span class="value" id="colorValue"></span>
          </div>
          <div class="swatches" id="swatches">${swatches}</div>
        </div>
      </section>

      <section id="sec-defaults">
        <div class="secthead">
          <span class="num">02</span><h2>Claude Defaults</h2>
          <span class="tag">model & effort</span>
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
          <span class="tnote">--dangerously-skip-permissions</span>
        </div>
      </section>

      <section id="sec-launch">
        <div class="secthead">
          <span class="num">03</span><h2>Launch Preview</h2>
          <span class="tag">resolved command</span>
        </div>
        <p class="sectlede">How Claude will be invoked when you start a session in this worktree.</p>
        <div class="preview" id="preview"><span class="prompt-glyph">$</span><span id="previewCmd"></span></div>
      </section>

      <section id="sec-integration">
        <div class="secthead">
          <span class="num">04</span><h2>Workbench Integration</h2>
          <span class="tag">skills & mcp</span>
        </div>
        <p class="sectlede">Inject the bundled workbench skills and MCP servers into this repo so Claude Code sessions started outside the workbench can use them.</p>

        <div class="field">
          <div class="field-head">
            <label>Skills</label>
          </div>
          <button type="button" class="btn" id="installSkills">Install skills to .claude/skills</button>
          <p class="hint">Writes the latest cw-* skills into <code>.claude/skills</code> in this worktree. Re-run to update.</p>
          <div class="result" id="skillsResult"></div>
        </div>

        <div class="field">
          <div class="field-head">
            <label>MCP servers</label>
          </div>
          <button type="button" class="btn" id="registerMcp">Register MCP servers</button>
          <p class="hint">Registers the unified <code>cw-code</code> server into this worktree's <code>.claude.json</code>, exposing every workbench tool (AST, dead-code, type-safety, tasks, arch) to Claude Code sessions opened here. Session-only tools like notifications stay inert outside the workbench. Don't commit <code>.claude.json</code> — it points at this machine's install.</p>
          <div class="result" id="mcpResult"></div>
        </div>
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
  const modelChipsEl = document.getElementById('modelChips');
  const modelValueEl = document.getElementById('modelValue');
  const effortEl = document.getElementById('effort');
  const effortValueEl = document.getElementById('effortValue');
  const effortRowEl = document.getElementById('effortRow');
  const effortHintEl = document.getElementById('effortHint');
  const yoloEl = document.getElementById('yolo');
  const previewCmdEl = document.getElementById('previewCmd');
  const colorValueEl = document.getElementById('colorValue');
  const swatchesEl = document.getElementById('swatches');
  const wtdotEl = document.getElementById('wtdot');

  const DOT_COLORS = {
    default: 'var(--clay)',
    red:     '#c2615a',
    green:   '#7a9a6a',
    yellow:  '#c9a85a',
    blue:    '#6a8fc2',
    magenta: '#b87aa0',
    cyan:    '#6aaab0',
  };

  function render() {
    modelEl.value = state.model;
    modelValueEl.textContent = state.model;
    for (const c of modelChipsEl.querySelectorAll('.chip')) {
      c.classList.toggle('on', c.dataset.model === state.model);
    }
    effortEl.value = String(state.effort);
    const info = modelInfo(state.model);
    const noThinking = !info.thinking;
    effortValueEl.textContent = noThinking ? 'n/a' : EFFORT_LABELS[state.effort];
    effortRowEl.classList.toggle('disabled', noThinking);
    effortHintEl.textContent = noThinking ? info.label + ' · no extended thinking' : '';
    yoloEl.checked = !!state.yolo;
    colorValueEl.textContent = state.color;
    for (const btn of swatchesEl.querySelectorAll('.swatch')) {
      btn.classList.toggle('selected', btn.dataset.color === state.color);
    }
    if (wtdotEl) wtdotEl.style.background = DOT_COLORS[state.color] || DOT_COLORS.default;

    const parts = ['claude'];
    if (info.flag) parts.push('--model', info.flag);
    if (!noThinking && state.effort > 0) {
      parts.push('--effort', ['','low','medium','high','max'][state.effort]);
    }
    if (state.yolo) parts.push('--dangerously-skip-permissions');
    previewCmdEl.textContent = parts.join(' ');
  }

  modelChipsEl.addEventListener('click', (e) => {
    const t = e.target.closest('.chip');
    if (!t) return;
    state.model = t.dataset.model;
    render();
    vscode.postMessage({ type: 'setModel', value: state.model });
  });
  modelEl.addEventListener('change', () => {
    state.model = modelEl.value;
    render();
    vscode.postMessage({ type: 'setModel', value: state.model });
  });
  effortEl.addEventListener('input', () => {
    state.effort = Number(effortEl.value);
    render();
    vscode.postMessage({ type: 'setEffort', value: state.effort });
  });
  swatchesEl.addEventListener('click', (e) => {
    const btn = e.target.closest?.('.swatch');
    if (!btn) return;
    state.color = btn.dataset.color;
    render();
    vscode.postMessage({ type: 'setColor', value: state.color });
  });
  yoloEl.addEventListener('change', () => {
    state.yolo = yoloEl.checked;
    render();
    vscode.postMessage({ type: 'setYolo', value: state.yolo });
  });

  const installSkillsEl = document.getElementById('installSkills');
  const registerMcpEl = document.getElementById('registerMcp');
  const skillsResultEl = document.getElementById('skillsResult');
  const mcpResultEl = document.getElementById('mcpResult');

  installSkillsEl.addEventListener('click', () => {
    installSkillsEl.disabled = true;
    skillsResultEl.textContent = 'Installing…';
    skillsResultEl.classList.remove('err');
    vscode.postMessage({ type: 'installSkills' });
  });
  registerMcpEl.addEventListener('click', () => {
    registerMcpEl.disabled = true;
    mcpResultEl.textContent = 'Registering…';
    mcpResultEl.classList.remove('err');
    vscode.postMessage({ type: 'registerMcp' });
  });

  window.addEventListener('message', (e) => {
    if (e.data?.type === 'state') {
      state = e.data.state;
      render();
    } else if (e.data?.type === 'result') {
      const btn = e.data.target === 'skills' ? installSkillsEl : registerMcpEl;
      const out = e.data.target === 'skills' ? skillsResultEl : mcpResultEl;
      btn.disabled = false;
      out.textContent = e.data.text;
      out.classList.toggle('err', !e.data.ok);
    }
  });

  // Scrollspy
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
