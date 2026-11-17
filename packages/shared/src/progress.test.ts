import { describe, expect, it } from 'vitest';
import {
  actualProgress,
  categorySummaries,
  normalizedWeights,
  projectProgress,
  type WoProgressInput,
} from './progress';

const wo = (
  id: string,
  weight: number | null,
  progress: number,
  status: WoProgressInput['status'] = 'in_progress',
  category: WoProgressInput['category'] = 'engineering',
): WoProgressInput => ({ id, weight, progress, status, category });

describe('bobot (PRD §8.4 butir 2)', () => {
  it('semua kosong → 1/N', () => {
    const w = normalizedWeights([wo('a', null, 0), wo('b', null, 0)]);
    expect(w.get('a')).toBeCloseTo(0.5);
  });

  it('sisa 100 − Σ eksplisit dibagi rata ke WO tanpa bobot', () => {
    const w = normalizedWeights([wo('a', 40, 0), wo('b', null, 0), wo('c', null, 0)]);
    expect(w.get('a')).toBeCloseTo(0.4);
    expect(w.get('b')).toBeCloseTo(0.3);
    expect(w.get('c')).toBeCloseTo(0.3);
  });

  it('Σ eksplisit > 100 → normalisasi, WO tanpa bobot = 0', () => {
    const w = normalizedWeights([wo('a', 80, 0), wo('b', 70, 0), wo('c', null, 0)]);
    expect(w.get('a')).toBeCloseTo(80 / 150);
    expect(w.get('c')).toBe(0);
  });

  it('WO dibatalkan tidak dihitung', () => {
    const w = normalizedWeights([wo('a', null, 0), wo('b', null, 0, 'canceled')]);
    expect(w.get('a')).toBe(1);
    expect(w.has('b')).toBe(false);
  });

  it('Σ bobot selalu 1', () => {
    const w = normalizedWeights([wo('a', 10, 0), wo('b', 25, 0), wo('c', 5, 0)]);
    expect([...w.values()].reduce((s, v) => s + v, 0)).toBeCloseTo(1);
  });
});

describe('Actual & progres project', () => {
  it('done dihitung 100% walau field progress belum 100', () => {
    expect(actualProgress([wo('a', null, 40, 'done'), wo('b', null, 0)])).toBeCloseTo(50);
  });

  it('dibulatkan ke integer', () => {
    // Bobot 50/30/20, progres 33/50/0 → 16,5 + 15 = 31,5 → 32
    expect(projectProgress([wo('a', 50, 33), wo('b', 30, 50), wo('c', 20, 0)])).toBe(32);
  });

  it('project tanpa WO → 0', () => {
    expect(projectProgress([])).toBe(0);
  });
});

describe('ringkasan per kategori (FR-022)', () => {
  it('hanya kategori yang punya WO; share = porsi bobot', () => {
    const s = categorySummaries([
      wo('a', 60, 50, 'in_progress', 'engineering'),
      wo('b', 40, 100, 'done', 'production'),
    ]);
    expect(s.map((x) => x.category)).toEqual(['engineering', 'production']);
    expect(s[0]).toMatchObject({ total: 1, done: 0, progress: 50 });
    expect(s[0]!.share).toBeCloseTo(0.6);
    expect(s[1]).toMatchObject({ total: 1, done: 1, progress: 100 });
  });
});
