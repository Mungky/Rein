"use client";

/** "Notifikasi Alarm" — operator-tunable notification settings (scada:manage).
 *  Stored in the single-row scada_alarm_settings table; the Telegram BOT TOKEN
 *  is a secret that lives in the backend env (TELEGRAM_BOT_TOKEN), so this
 *  dialog only takes the chat id + enable flags. "Kirim Uji Coba" fires a test
 *  message through every enabled channel. */

import { useEffect, useState } from "react";
import { BellRing, Loader2, Send, X } from "lucide-react";
import { toast } from "sonner";
import { scadaApi } from "@/lib/api/scada";
import type { AlarmSettings } from "../types";

export function AlarmSettingsDialog({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<AlarmSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    scadaApi
      .getAlarmSettings()
      .then(setSettings)
      .catch(() => toast.error("Gagal memuat pengaturan alarm"));
  }, []);

  function patch(p: Partial<AlarmSettings>) {
    setSettings((s) => (s ? { ...s, ...p } : s));
  }

  async function save() {
    if (!settings) return;
    setSaving(true);
    try {
      const updated = await scadaApi.updateAlarmSettings({
        email_enabled: settings.email_enabled,
        email_recipients: settings.email_recipients,
        telegram_enabled: settings.telegram_enabled,
        telegram_chat_id: settings.telegram_chat_id,
        cooldown_min: settings.cooldown_min,
        sound_enabled: settings.sound_enabled,
      });
      setSettings(updated);
      toast.success("Pengaturan alarm tersimpan");
      onClose();
    } catch {
      toast.error("Gagal menyimpan pengaturan");
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    if (!settings) return;
    setTesting(true);
    try {
      // Persist current form first so the test uses what's on screen.
      await scadaApi.updateAlarmSettings({
        email_enabled: settings.email_enabled,
        email_recipients: settings.email_recipients,
        telegram_enabled: settings.telegram_enabled,
        telegram_chat_id: settings.telegram_chat_id,
      });
      const res = await scadaApi.sendTestAlarm();
      toast.success(`Pesan uji dikirim lewat: ${res.sent.join(", ")}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      toast.error(
        msg.includes("kanal")
          ? "Aktifkan minimal satu kanal dulu"
          : "Gagal mengirim pesan uji"
      );
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="modal-panel flex max-w-md flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-start gap-3 border-b border-border-soft px-6 pb-4 pt-6">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-[var(--r-lg)] bg-gradient-to-br from-primary to-primary-hover text-white">
            <BellRing className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[16px] font-bold leading-tight text-text">
              Notifikasi Alarm
            </h2>
            <p className="mt-0.5 text-[12px] text-text-muted">
              Ke mana sistem memberi tahu saat sensor keluar batas
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost btn-icon btn-sm -mr-1 -mt-1"
          >
            <X className="size-4" />
          </button>
        </div>

        {settings === null ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="size-5 animate-spin text-text-light" />
          </div>
        ) : (
          <div className="flex flex-col gap-4 px-6 py-5">
            {/* Email */}
            <div className="rounded-[var(--r-lg)] border border-border-soft p-3">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={settings.email_enabled}
                  onChange={(e) => patch({ email_enabled: e.target.checked })}
                />
                <span className="text-[13px] font-semibold text-text">Email</span>
              </label>
              <input
                className="field-input mt-2"
                placeholder="alamat@contoh.com, alamat2@contoh.com"
                value={settings.email_recipients}
                onChange={(e) => patch({ email_recipients: e.target.value })}
                disabled={!settings.email_enabled}
              />
              <p className="mt-1 text-[11px] text-text-light">
                Pisahkan beberapa alamat dengan koma.
              </p>
            </div>

            {/* Telegram */}
            <div className="rounded-[var(--r-lg)] border border-border-soft p-3">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={settings.telegram_enabled}
                  onChange={(e) => patch({ telegram_enabled: e.target.checked })}
                />
                <span className="text-[13px] font-semibold text-text">Telegram</span>
              </label>
              <input
                className="field-input mt-2 font-mono"
                placeholder="Chat ID (mis. -100123456789)"
                value={settings.telegram_chat_id}
                onChange={(e) => patch({ telegram_chat_id: e.target.value })}
                disabled={!settings.telegram_enabled}
              />
              <p className="mt-1 text-[11px] text-text-light">
                {settings.telegram_token_set ? (
                  <>Token bot sudah terpasang di server. Masukkan chat ID tujuan
                  (grup atau pribadi) — lihat panduan Node-RED untuk cara mendapatkannya.</>
                ) : (
                  <span className="text-amber">
                    Token bot belum dipasang di server (TELEGRAM_BOT_TOKEN) —
                    Telegram belum bisa mengirim. Buat bot lewat @BotFather lalu
                    minta admin memasang tokennya.
                  </span>
                )}
              </p>
            </div>

            {/* Cooldown + sound */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-[12px] font-semibold text-text-muted">
                  Jeda antar-notifikasi (menit)
                </label>
                <input
                  type="number"
                  min={0}
                  max={1440}
                  className="field-input"
                  value={settings.cooldown_min}
                  onChange={(e) =>
                    patch({ cooldown_min: Math.max(0, Number(e.target.value) || 0) })
                  }
                />
                <p className="mt-1 text-[11px] text-text-light">
                  Sensor yang bolak-balik melewati batas tidak akan membanjiri
                  email/Telegram.
                </p>
              </div>
              <div>
                <label className="mb-1.5 block text-[12px] font-semibold text-text-muted">
                  Suara di aplikasi
                </label>
                <label className="flex h-9 cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={settings.sound_enabled}
                    onChange={(e) => patch({ sound_enabled: e.target.checked })}
                  />
                  <span className="text-[12.5px] text-text">
                    Bunyikan bip saat alarm baru
                  </span>
                </label>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-between gap-2 px-6 pb-6">
          <button
            type="button"
            onClick={sendTest}
            disabled={!settings || testing}
            className="btn btn-secondary btn-sm gap-1.5"
            title="Kirim pesan uji lewat semua kanal yang aktif"
          >
            {testing ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Send className="size-3.5" />
            )}
            Kirim Uji Coba
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">
              Batal
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!settings || saving}
              className="btn btn-primary btn-sm"
            >
              {saving && <Loader2 className="size-3.5 animate-spin" />}
              Simpan
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
