import { describe, expect, it } from 'vitest';
import type { Task } from '@code-workbench/mcp-core/task-format';
import { findingDiagnostics } from '../src/reviewDiagnostics';

const task = (over: Partial<Task>): Task =>
  ({
    id: 'id',
    title: 'T',
    priority: 'medium',
    status: 'open',
    worktree: null,
    parentId: null,
    tags: [],
    description: '',
    memo: '',
    ...over,
  }) as Task;

const parent = task({ id: 'p1', worktree: 'wt' });
const finding = (over: Partial<Task> = {}) =>
  task({
    id: 'f1234567-aaaa',
    parentId: 'p1',
    tags: ['review-finding'],
    title: 'Null deref',
    description: 'src/a.ts:12:3, x may be empty',
    priority: 'high',
    ...over,
  });
const root = () => '/work/wt';

describe('findingDiagnostics', () => {
  it('maps an open finding to a 0-based diagnostic with severity from priority', () => {
    expect(findingDiagnostics([parent, finding()], root)).toEqual([
      {
        file: '/work/wt/src/a.ts',
        line: 11,
        column: 2,
        message: 'Null deref',
        severity: 'error',
        taskId: 'f1234567-aaaa',
        parentId: 'p1',
      },
    ]);
    expect(findingDiagnostics([parent, finding({ priority: 'low' })], root)[0].severity).toBe(
      'info',
    );
  });

  it('skips done findings, done parents, non-findings and unlocated ones', () => {
    expect(findingDiagnostics([parent, finding({ status: 'done' })], root)).toEqual([]);
    expect(findingDiagnostics([{ ...parent, status: 'done' }, finding()], root)).toEqual([]);
    expect(findingDiagnostics([parent, finding({ tags: ['plan-step'] })], root)).toEqual([]);
    expect(findingDiagnostics([parent, finding({ description: 'no location' })], root)).toEqual([]);
    expect(findingDiagnostics([parent, finding()], () => undefined)).toEqual([]);
  });

  it('keeps absolute paths as-is', () => {
    const f = finding({ description: '/abs/x.ts:5, bad' });
    expect(findingDiagnostics([parent, f], root)[0].file).toBe('/abs/x.ts');
  });
});
