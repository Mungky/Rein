import { describe, expect, it } from 'vitest';
import { buildSCurve, type CurveEvent, type CurveWorkOrder } from './scurve';

const wo = (id: string, patch: Partial<CurveWorkOrder> = {}): CurveWorkOrder => ({
  id,
  category: 'engineering',
  status: 'in_progress',
  weight: null,
  progress: 0,
  plannedStart: '2026-11-01',
  deadline: '2026-11-11',
  ...patch,
});
describe('S-Curve rencana dan histori aktual', () => {
  it('menormalisasi bobot, mengecualikan canceled, dan mengambil event terakhir per hari WIB', () => {
    const rows = [
      wo('a', { weight: 25, progress: 60 }),
      wo('b', { progress: 100, status: 'done' }),
      wo('c', { status: 'canceled', weight: 100 }),
    ];
    const history: CurveEvent[] = [
      { woId: 'a', progress: 20, status: 'in_progress', recordedAt: '2026-11-03T08:00:00Z' },
      { woId: 'a', progress: 60, status: 'in_progress', recordedAt: '2026-11-05T16:59:59Z' },
      { woId: 'b', progress: 10, status: 'done', recordedAt: '2026-11-05T17:00:00Z' },
      { woId: 'c', progress: 100, status: 'done', recordedAt: '2026-11-04T00:00:00Z' },
    ];
    const result = buildSCurve(rows, history, '2026-11-06');
    expect(result.plan).toBe(50);
    expect(result.actual).toBe(90);
    expect(result.deviation).toBe(40);
    expect(result.spi).toBe(1.8);
    expect(result.points.find((p) => p.date === '2026-11-05')!.actual).toBe(15);
    expect(result.points.find((p) => p.date === '2026-11-07')!.actual).toBeNull();
    expect(result.weights.map((w) => w.weight)).toEqual([25, 75]);
  });
  it('tahan data kosong, deadline satu hari, bobot >100, dan rentang panjang maksimal 120 titik', () => {
    expect(buildSCurve([], [], '2026-11-16')).toMatchObject({
      plan: 0,
      actual: 0,
      spi: null,
      predictedFinish: null,
    });
    const result = buildSCurve(
      [
        wo('a', { weight: 150, plannedStart: '2020-01-01', deadline: '2030-01-01' }),
        wo('b', { weight: 150, deadline: '2026-11-01' }),
      ],
      [],
      '2026-11-16',
    );
    expect(result.points.length).toBeLessThanOrEqual(120);
    expect(result.weights.map((w) => w.weight)).toEqual([50, 50]);
    expect(result.points[0]!.date).toBe('2020-01-01');
    expect(result.points.at(-1)!.date).toBe('2030-01-01');
  });
  it('tidak mengisi histori dengan progres hari ini; regresi tanpa kemajuan tidak memprediksi selesai', () => {
    const result = buildSCurve([wo('a', { progress: 80 })], [], '2026-11-16');
    expect(result.actual).toBe(0);
    expect(result.predictedFinish).toBeNull();
    const done = buildSCurve(
      [wo('a', { status: 'done', progress: 100 })],
      [{ woId: 'a', progress: 20, status: 'done', recordedAt: '2026-11-16T01:00:00Z' }],
      '2026-11-16',
    );
    expect(done.actual).toBe(100);
    expect(done.predictedFinish).toBe('2026-11-16');
  });
  it('memakai event berdasarkan timestamp meskipun datang tidak berurutan dan progres menurun', () => {
    const history: CurveEvent[] = [
      { woId: 'a', progress: 30, status: 'in_progress', recordedAt: '2026-11-06T08:00:00Z' },
      { woId: 'a', progress: 80, status: 'in_progress', recordedAt: '2026-11-05T08:00:00Z' },
    ];
    expect(buildSCurve([wo('a')], history, '2026-11-06').actual).toBe(30);
  });
});
