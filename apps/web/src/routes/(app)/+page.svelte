<script lang="ts">
  import EmptyState from '$lib/components/EmptyState.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import type { IconName } from '$lib/icons';
  import { session } from '$lib/session.svelte';

  /**
   * Beranda (Figma D/02, M/02). M0: kerangka kosong — stat & daftar "Tugas saya" diisi data WO
   * di M1 (FR-010). Angka 0 karena belum ada WO.
   */
  const hour = new Date().getHours();
  const greeting =
    hour < 11
      ? 'Selamat pagi'
      : hour < 15
        ? 'Selamat siang'
        : hour < 18
          ? 'Selamat sore'
          : 'Selamat malam';
  const firstName = $derived(session.me?.user.fullName.split(' ')[0] ?? '');
  const today = new Intl.DateTimeFormat('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  }).format(new Date());

  const stats: Array<{ label: string; icon: IconName; danger?: boolean; sub: string }> = [
    { label: 'Tugas saya', icon: 'check', sub: 'WO aktif' },
    { label: 'Urgent', icon: 'alert', danger: true, sub: 'perlu segera' },
    { label: 'Jatuh tempo 7 hari', icon: 'calendar', sub: 'deadline dekat' },
    { label: 'Butuh bantuan', icon: 'flag', danger: true, sub: 'permintaan terbuka' },
  ];
</script>

<svelte:head><title>Beranda · REIN</title></svelte:head>

<div class="pad">
  <header>
    <h1>{greeting}, {firstName}</h1>
    <p class="muted">{today}</p>
  </header>

  <div class="stats">
    {#each stats as s (s.label)}
      <div class="stat" class:danger={s.danger}>
        <span class="lb"><Icon name={s.icon} size={14} />{s.label}</span>
        <span class="v tnum">0</span>
        <span class="s">{s.sub}</span>
      </div>
    {/each}
  </div>

  <section>
    <h2>Tugas saya</h2>
    <div class="box">
      <EmptyState
        icon="check"
        title="Belum ada tugas"
        message="Work Order yang di-assign ke Anda akan muncul di sini, diurutkan dari yang terlambat, urgent, lalu deadline terdekat."
      />
    </div>
  </section>
</div>

<style>
  .pad {
    display: flex;
    flex-direction: column;
    gap: 24px;
    padding: 24px 32px 32px;
  }
  header {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
  }
  .stat {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 12px 16px;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--color-bg-surface);
  }
  .lb {
    display: flex;
    align-items: center;
    gap: 6px;
    font: var(--text-label);
    color: var(--color-text-secondary);
  }
  .v {
    font: var(--text-display);
  }
  .s {
    font: var(--text-caption);
    color: var(--color-text-tertiary);
  }
  .stat.danger .lb :global(svg) {
    color: var(--color-danger-default);
  }
  section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .box {
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
  }
  @media (max-width: 767px) {
    .pad {
      padding: 16px 16px 24px;
    }
    .stats {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>
