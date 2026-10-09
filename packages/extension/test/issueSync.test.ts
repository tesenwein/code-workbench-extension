import { describe, expect, it } from 'vitest';
import type { Task } from '@code-workbench/mcp-core/task-format';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { claimTransition, planIssueSync, type TaskStamp } from '../src/issueSync';

const task = (over: Partial<Task> = {}): Task =>
  ({
    id: 't1',
    title: 'Fix login',
    status: 'open',
    phase: null,
    parentId: null,
    issueNumber: 7,
    prUrl: null,
    ...over,
  }) as Task;

describe('planIssueSync', () => {
  it('only primes on first sight — no comment for pre-existing tasks', () => {
    const { actions, next } = planIssueSync(new Map(), [task()]);
    expect(actions).toEqual([]);
    expect(next.get('t1')).toEqual({ status: 'open', phase: null });
  });

  it('comments on a status or phase change', () => {
    const prev = new Map<string, TaskStamp>([['t1', { status: 'open', phase: null }]]);
    const { actions } = planIssueSync(prev, [task({ status: 'in-progress', phase: 'review' })]);
    expect(actions).toEqual([
      {
        key: 't1.open-none.in-progress-review',
        issue: 7,
        kind: 'comment',
        body: 'Code Workbench status: in-progress, next phase: review',
      },
    ]);
  });

  it('closes the issue (with the PR link) when the task reaches done', () => {
    const prev = new Map<string, TaskStamp>([['t1', { status: 'in-progress', phase: 'fix' }]]);
    const { actions } = planIssueSync(prev, [
      task({ status: 'done', phase: null, prUrl: 'https://x/pull/1' }),
    ]);
    expect(actions).toHaveLength(1);
    expect(actions[0].kind).toBe('close');
    expect(actions[0].body).toContain('https://x/pull/1');
  });

  it('ignores unchanged tasks, subtasks and tasks without an issue', () => {
    const prev = new Map<string, TaskStamp>([['t1', { status: 'open', phase: null }]]);
    const { actions } = planIssueSync(prev, [
      task(),
      task({ id: 's', parentId: 't1', status: 'done' }),
      task({ id: 'n', issueNumber: null, status: 'done' }),
    ]);
    expect(actions).toEqual([]);
  });
});

describe('claimTransition', () => {
  it('lets exactly one claimant win a transition', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-claim-'));
    const results = await Promise.all([
      claimTransition(dir, 't1.open-none.done-none'),
      claimTransition(dir, 't1.open-none.done-none'),
      claimTransition(dir, 't1.open-none.done-none'),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await claimTransition(dir, 't2.open-none.done-none')).toBe(true);
  });
});
