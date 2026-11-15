import { describe, expect, it } from 'vitest';
import { formatBytes } from './format';

describe('formatBytes', () => {
  it.each([
    [512, '512 B'],
    [240 * 1024, '240 KB'],
    [3.2 * 1024 * 1024, '3,2 MB'],
    [50 * 1024 * 1024, '50 MB'],
  ])('%d → %s', (n, out) => {
    expect(formatBytes(n)).toBe(out);
  });
});
