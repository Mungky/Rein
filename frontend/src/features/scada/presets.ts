/** Simulator waveform presets — "campuran umum", cocok untuk showcase klien
 *  mana pun. Ini jawaban sel "Sumber/Jenis" di workbench ("data diambil
 *  melalui apa"); saat adapter V-Net hadir, source "vnet" menyusul di sini. */

export const PRESETS = {
  suhu: {
    label: "Suhu",
    unit: "°C",
    config: { preset: "suhu", base: 28, amplitude: 4, period_s: 86400, noise: 0.4, decimals: 1 },
  },
  tekanan: {
    label: "Tekanan",
    unit: "bar",
    config: { preset: "tekanan", base: 4.5, amplitude: 0.8, period_s: 21600, noise: 0.15, decimals: 2, min: 0 },
  },
  flow: {
    label: "Flow",
    unit: "m³/h",
    config: { preset: "flow", base: 120, amplitude: 30, period_s: 28800, noise: 6, decimals: 1, min: 0 },
  },
  level: {
    label: "Level Tangki",
    unit: "%",
    config: { preset: "level", base: 60, amplitude: 22, period_s: 43200, noise: 1.5, decimals: 1, min: 0, max: 100 },
  },
  daya: {
    label: "Daya Listrik",
    unit: "kW",
    config: { preset: "daya", base: 75, amplitude: 20, period_s: 86400, noise: 3, decimals: 1, min: 0 },
  },
} as const;

export type PresetKey = keyof typeof PRESETS;

export function presetOf(config: Record<string, unknown> | null | undefined): PresetKey {
  const p = config?.preset as PresetKey | undefined;
  return p && p in PRESETS ? p : "suhu";
}
