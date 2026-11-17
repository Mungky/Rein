<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import { hasGlobal } from '$lib/session.svelte';

  interface Status {
    provider: string;
    session: { status: string; phone?: string | null } | null;
    qr: string | null;
    error: string | null;
  }
  const labels: Record<string, string> = {
    missing: 'Belum dihubungkan',
    created: 'Menyiapkan koneksi',
    initializing: 'Menyiapkan koneksi',
    qr_ready: 'Menunggu scan QR',
    authenticating: 'Menghubungkan',
    ready: 'Terhubung',
    disconnected: 'Terputus',
    action_required: 'Perlu dihubungkan ulang',
    failed: 'Koneksi gagal',
    disabled: 'Belum diaktifkan',
  };
  const allowed = $derived(hasGlobal('admin.users'));
  let status = $state<Status | null>(null);
  let loading = $state(true);
  let refreshing = $state(false);
  let busy = $state(false);
  let error = $state('');
  const connected = $derived(status?.session?.status === 'ready');
  const label = $derived(
    status?.error
      ? 'Tidak dapat terhubung'
      : (labels[status?.session?.status ?? 'missing'] ?? 'Memeriksa koneksi'),
  );

  async function load() {
    if (refreshing) return;
    refreshing = true;
    try {
      status = await api<Status>('/api/admin/whatsapp');
      error = '';
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Status WhatsApp belum dapat dimuat.';
    } finally {
      loading = false;
      refreshing = false;
    }
  }
  async function connect() {
    busy = true;
    error = '';
    try {
      await api('/api/admin/whatsapp/setup', { body: {} });
      await load();
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'WhatsApp belum dapat dihubungkan.';
    } finally {
      busy = false;
    }
  }
  onMount(() => {
    if (!allowed) return;
    void load();
    const timer = setInterval(() => {
      if (!busy) void load();
    }, 10_000);
    return () => clearInterval(timer);
  });
</script>

<svelte:head><title>WhatsApp · REIN</title></svelte:head>

{#if !allowed}
  <EmptyState
    icon="shield"
    title="Akses dibatasi"
    message="Hanya pengelola pengguna yang dapat menghubungkan bot WhatsApp."
  />
{:else}
  <div class="settings">
    <header>
      <div>
        <h1>WhatsApp</h1>
        <p>Hubungkan bot untuk mengirim kode verifikasi dan notifikasi.</p>
      </div>
      <Button icon="refresh" loading={refreshing} disabled={busy} onclick={load}
        >Perbarui status</Button
      >
    </header>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <section aria-label="Koneksi WhatsApp" aria-busy={loading}>
      <div class="connection">
        <h2>{loading ? 'Memeriksa koneksi…' : label}</h2>
        {#if connected}
          <p>Bot siap mengirim kode verifikasi dan notifikasi.</p>
          {#if status?.session?.phone}<p class="number">{status.session.phone}</p>{/if}
        {:else if status?.error}
          <p>
            Layanan OpenWA belum dapat dijangkau. Periksa status dan log service OpenWA di Coolify
            sebelum mencoba kembali.
          </p>
          <details>
            <summary>Detail koneksi</summary>
            <p class="detail">{status.error}</p>
          </details>
        {:else if status?.provider === 'null'}
          <p>Layanan WhatsApp belum diaktifkan pada konfigurasi server.</p>
        {:else}
          <p>Siapkan koneksi, lalu scan QR dengan WhatsApp nomor bot.</p>
        {/if}
        {#if !connected && status?.provider === 'openwa'}
          <Button variant="primary" loading={busy} disabled={refreshing} onclick={connect}
            >Hubungkan WhatsApp</Button
          >
        {/if}
      </div>
      {#if !connected && status?.qr?.startsWith('data:image/png;base64,')}
        <div class="pairing">
          <div class="qr">
            <img
              src={status.qr}
              alt="Kode QR untuk menghubungkan WhatsApp bot REIN"
              width="240"
              height="240"
            />
          </div>
          <p>Di HP bot: <strong>WhatsApp → Perangkat tertaut → Tautkan perangkat</strong>.</p>
          <p class="hint">Status diperbarui otomatis setelah QR dipindai.</p>
        </div>
      {/if}
    </section>
  </div>
{/if}

<style>
  .settings {
    display: grid;
    gap: 20px;
    width: 100%;
    max-width: 1040px;
    padding: 24px;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
  }
  h1 {
    font-size: 20px;
    font-weight: 600;
  }
  h2 {
    font-size: 16px;
    font-weight: 600;
  }
  p {
    color: var(--color-text-secondary);
    line-height: 1.6;
  }
  header p {
    margin-top: 4px;
  }
  section {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 32px;
    padding: 24px;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--color-bg-surface);
  }
  .connection {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }
  .number {
    color: var(--color-text-primary);
    font-variant-numeric: tabular-nums;
  }
  .pairing {
    max-width: 280px;
    display: grid;
    justify-items: center;
    gap: 12px;
    text-align: center;
  }
  .qr {
    padding: 12px;
    background: white;
    border-radius: var(--radius-md);
  }
  img {
    display: block;
    max-width: 100%;
    height: auto;
  }
  .hint,
  details {
    font-size: 12px;
    color: var(--color-text-tertiary);
  }
  summary {
    cursor: pointer;
  }
  .detail {
    overflow-wrap: anywhere;
    margin-top: 8px;
  }
  .error {
    padding: 12px;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    color: var(--color-text-primary);
    background: var(--color-bg-subtle);
  }
  @media (max-width: 640px) {
    .settings {
      padding: 16px;
    }
    header {
      align-items: flex-start;
      flex-direction: column;
    }
    section {
      grid-template-columns: 1fr;
      padding: 16px;
      gap: 24px;
    }
    .pairing {
      justify-self: center;
    }
  }
</style>
