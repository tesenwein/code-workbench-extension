import { describe, expect, it } from 'vitest';
import type { Task } from '@code-workbench/mcp-core/task-format';
import { decideNextPhase } from '../src/phaseAutopilot';

function task(over: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: 'T',
    priority: 'medium',
    status: 'open',
    worktree: null,
    parentId: null,
    parallel: false,
    order: null,
    dueDate: null,
    epic: null,
    phase: 'review',
    autoRun: true,
    tags: [],
    description: '',
    memo: '',
    created: '2026-01-01T00:00:00.000Z',
    updated: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

const finding = (over: Partial<Task> = {}) => task({ id: 'f', tags: ['review-finding'], ...over });

describe('decideNextPhase', () => {
  it('never starts Ship unattended', () => {
    expect(
      decideNextPhase({
        task: task({ phase: 'ship' }),
        subtasks: [],
        event: 'done',
        ranPhase: 'fix',
      }),
    ).toEqual({ stop: 'ship-needs-confirmation' });
  });

  it('starts the handed-off phase', () => {
    expect(
      decideNextPhase({ task: task(), subtasks: [], event: 'done', ranPhase: 'implement' }),
    ).toEqual({ start: 'review' });
  });

  it('stops when autoRun is off', () => {
    expect(
      decideNextPhase({
        task: task({ autoRun: false }),
        subtasks: [],
        event: 'done',
        ranPhase: 'implement',
      }),
    ).toEqual({ stop: 'autorun-off' });
  });

  it('stops on needs_input', () => {
    expect(
      decideNextPhase({ task: task(), subtasks: [], event: 'needs_input', ranPhase: 'implement' }),
    ).toEqual({ stop: 'needs-input' });
  });

  it('stops when the task is done or phase cleared', () => {
    for (const t of [task({ status: 'done' }), task({ phase: null })]) {
      expect(decideNextPhase({ task: t, subtasks: [], event: 'done', ranPhase: 'fix' })).toEqual({
        stop: 'task-done',
      });
    }
  });

  it('stops as blocked when phase is unchanged', () => {
    expect(
      decideNextPhase({
        task: task({ phase: 'implement' }),
        subtasks: [],
        event: 'done',
        ranPhase: 'implement',
      }),
    ).toEqual({ stop: 'blocked' });
  });

  it('stops before fix when an open high-priority finding exists', () => {
    expect(
      decideNextPhase({
        task: task({ phase: 'fix' }),
        subtasks: [finding({ priority: 'high' })],
        event: 'done',
        ranPhase: 'review',
      }),
    ).toEqual({ stop: 'high-priority-findings' });
  });

  it('continues to fix when findings are low-priority or closed', () => {
    expect(
      decideNextPhase({
        task: task({ phase: 'fix' }),
        subtasks: [finding({ priority: 'high', status: 'done' }), finding({ priority: 'low' })],
        event: 'done',
        ranPhase: 'review',
      }),
    ).toEqual({ start: 'fix' });
  });
});
