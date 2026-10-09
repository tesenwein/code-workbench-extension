import { describe, it, expect } from 'vitest';
import { clampEffort } from '../src/sessionTypes';

describe('clampEffort', () => {
  it('defaults NaN to 0', () => {
    expect(clampEffort(NaN)).toBe(0);
  });
  it('clamps to 0..4', () => {
    expect(clampEffort(Infinity)).toBe(4);
    expect(clampEffort(-3)).toBe(0);
    expect(clampEffort(-Infinity)).toBe(0);
    expect(clampEffort(9)).toBe(4);
  });
  it('floors fractional values', () => {
    expect(clampEffort(2.9)).toBe(2);
  });
});
