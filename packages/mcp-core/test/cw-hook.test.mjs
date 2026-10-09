import { describe, it, expect } from 'vitest';
import {
  decidePreToolUse,
  decideStop,
  decideSessionStart,
  parseArgs,
  activityFor,
} from '../cw-hook.mjs';

const task = (over = {}) => ({
  id: 'aaaaaaaa-1111',
  title: 'T',
  status: 'in-progress',
  worktree: null,
  memo: '',
  ...over,
});
const edit = (file_path = '/repo/src/a.ts') => ({ tool_name: 'Edit', tool_input: { file_path } });
const denied = (r) => r?.hookSpecificOutput?.permissionDecision === 'deny';

describe('decidePreToolUse', () => {
  it('ignores non-edit tools', () => {
    expect(decidePreToolUse({ tool_name: 'Read', tool_input: {} }, [], { worktree: '/r' })).toBeNull();
  });

  it('denies an edit with no in-progress task', () => {
    expect(denied(decidePreToolUse(edit(), [task({ status: 'open' })], { worktree: '/r' }))).toBe(true);
  });

  it('allows an edit when an unassigned or same-worktree task is in-progress', () => {
    expect(decidePreToolUse(edit(), [task()], { worktree: '/r/feat' })).toBeNull();
    expect(
      decidePreToolUse(edit(), [task({ worktree: 'feat' })], { worktree: '/r/Feat' }),
    ).toBeNull();
  });

  it('denies when the only in-progress task belongs to another worktree', () => {
    expect(
      denied(decidePreToolUse(edit(), [task({ worktree: 'other' })], { worktree: '/r/feat' })),
    ).toBe(true);
  });

  it('allows board files and the scratchpad regardless', () => {
    for (const f of ['/r/.code-workbench/x.json', '/tmp/claude-503/proj/s/scratchpad/a.txt']) {
      expect(decidePreToolUse(edit(f), [], { worktree: '/r' })).toBeNull();
    }
  });

  it('still guards repo source that merely has a scratchpad or .code-workbench dir', () => {
    for (const f of ['/r/src/scratchpad/x.ts', '/r/src/.code-workbench/x.ts']) {
      expect(denied(decidePreToolUse(edit(f), [], { worktree: '/r' }))).toBe(true);
    }
  });

  it('requires the bound task itself to be in-progress', () => {
    const ctx = { taskId: 'aaaaaaaa-1111', worktree: '/r' };
    expect(denied(decidePreToolUse(edit(), [task({ status: 'open' })], ctx))).toBe(true);
    expect(decidePreToolUse(edit(), [task()], ctx)).toBeNull();
    // A deleted bound task must not trap the agent.
    expect(decidePreToolUse(edit(), [], ctx)).toBeNull();
  });
});

describe('decideStop', () => {
  const ctx = { taskId: 'aaaaaaaa-1111' };

  it('blocks while the bound task is in-progress without a blocker note', () => {
    expect(decideStop({}, [task()], ctx)?.decision).toBe('block');
  });

  it('allows after handoff (open/done), with a blocked memo, or when unbound', () => {
    expect(decideStop({}, [task({ status: 'open' })], ctx)).toBeNull();
    expect(decideStop({}, [task({ status: 'done' })], ctx)).toBeNull();
    expect(decideStop({}, [task({ memo: 'Blocked: no creds' })], ctx)).toBeNull();
    expect(decideStop({}, [task()], {})).toBeNull();
  });

  it('ignores incidental "block" wording in the memo', () => {
    expect(decideStop({}, [task({ memo: 'fixed a code block, unblocked CI' })], ctx)?.decision).toBe(
      'block',
    );
  });

  it('never loops once stop_hook_active is set', () => {
    expect(decideStop({ stop_hook_active: true }, [task()], ctx)).toBeNull();
  });
});

describe('decideSessionStart / parseArgs', () => {
  it('adds context only for bound sessions', () => {
    expect(decideSessionStart({}, [task()], {})).toBeNull();
    const out = decideSessionStart({}, [task()], { taskId: 'aaaaaaaa-1111', phase: 'review' });
    expect(out.hookSpecificOutput.additionalContext).toContain('review phase');
  });

  it('parses --key value pairs', () => {
    expect(parseArgs(['--event', 'Stop', '--repo-key', 'k'])).toEqual({ event: 'Stop', 'repo-key': 'k' });
  });
});

describe('activityFor', () => {
  it('maps events to live states', () => {
    expect(activityFor('PreToolUse', { tool_name: 'Edit' })).toEqual({ state: 'running', tool: 'Edit' });
    expect(activityFor('Notification', {})).toEqual({ state: 'waiting', tool: '' });
    expect(activityFor('Stop', {})).toEqual({ state: 'idle', tool: '' });
    expect(activityFor('SessionStart', {})).toBeNull();
  });
});
