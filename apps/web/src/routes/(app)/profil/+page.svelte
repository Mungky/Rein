<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { api, ApiError } from '$lib/api';
  import Avatar from '$lib/components/Avatar.svelte';
  import Button from '$lib/components/Button.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import { logout, session } from '$lib/session.svelte';
  import { toast } from '$lib/toast.svelte';

  /** Profil & keamanan (Figma D/09, M/09). M0: identitas + keluar semua perangkat. */
  let confirmOpen = $state(false);
  let busy = $state(false);

  async function logoutAll() {
    busy = true;
    try {
      await api('/api/auth/logout-all', { body: {} });
      await logout();
      await goto(resolve('/masuk'));
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Gagal', { tone: 'danger' });
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Profil · REIN</title></svelte:head>

{#if session.me}
  {@const u = session.me.user}
  <div class="pad">
    <section class="card id">
      <Avatar name={u.fullName} src={u.avatarUrl} size={64} />
      <div class="who">
        <h1>{u.fullName}</h1>
        <p class="muted">@{u.username} · {u.roleName}</p>
        <p class="muted">{u.email} <span class="ok">✓ Terverifikasi</span></p>
      </div>
    </section>

    <section class="card">
      <h2>Keamanan</h2>
      <p class="muted">
        Keluar dari semua perangkat mencabut semua sesi aktif dan status perangkat tepercaya.
      </p>
      <div>
        <Button variant="secondary" icon="logout" onclick={() => (confirmOpen = true)}
          >Keluar dari semua perangkat</Button
        >
      </div>
    </section>
  </div>
{/if}

<Modal bind:open={confirmOpen} title="Keluar dari semua perangkat?" width={440}>
  <p>Anda perlu masuk ulang di semua perangkat, termasuk perangkat ini.</p>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (confirmOpen = false)}>Batal</Button>
    <Button variant="danger" loading={busy} onclick={logoutAll}>Keluar semua</Button>
  {/snippet}
</Modal>

<style>
  .pad {
    display: flex;
    flex-direction: column;
    gap: 16px;
    max-width: 720px;
    padding: 24px 32px 32px;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 16px 20px;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--color-bg-surface);
  }
  .id {
    flex-direction: row;
    align-items: center;
    gap: 16px;
  }
  .who {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .ok {
    color: var(--color-success-default);
    font-size: 12px;
    font-weight: 500;
    margin-left: 6px;
  }
  @media (max-width: 767px) {
    .pad {
      padding: 16px;
    }
  }
</style>
