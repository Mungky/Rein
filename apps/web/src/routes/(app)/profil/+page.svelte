<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { api, ApiError } from '$lib/api';
  import Avatar from '$lib/components/Avatar.svelte';
  import Button from '$lib/components/Button.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Progress from '$lib/components/Progress.svelte';
  import { formatBytes } from '$lib/format';
  import { compressImage } from '$lib/image';
  import { hasGlobal, loadMe, logout, session } from '$lib/session.svelte';
  import { toast } from '$lib/toast.svelte';
  import { uploadAttachment } from '$lib/upload';

  /** Profil & keamanan (Figma D/09, M/09). M0: foto profil + identitas + keluar semua perangkat. */
  let confirmOpen = $state(false);
  let busy = $state(false);
  let fileInput = $state<HTMLInputElement>();
  let up = $state<{
    phase: 'compress' | 'upload';
    before: number;
    after: number;
    pct: number;
  } | null>(null);

  /** FR-005: foto dipotong & dikompres di klien ke 256×256 WebP, lalu diunggah. */
  async function onPick(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    (e.currentTarget as HTMLInputElement).value = '';
    if (!file || !session.me) return;
    if (!file.type.startsWith('image/')) {
      toast('Pilih file gambar (JPG, PNG, WebP, HEIC)', { tone: 'danger' });
      return;
    }
    up = { phase: 'compress', before: file.size, after: 0, pct: 0 };
    try {
      const img = await compressImage(file, { square: 256, quality: 0.85 });
      up = { phase: 'upload', before: file.size, after: img.blob.size, pct: 0 };
      const res = await uploadAttachment({
        ownerType: 'user',
        ownerId: session.me.user.id,
        category: 'photo',
        file: {
          blob: img.blob,
          name: img.blob.type === 'image/webp' ? 'avatar.webp' : 'avatar.jpg',
        },
        width: img.width,
        height: img.height,
        onProgress: (f) => up && (up.pct = Math.round(f * 100)),
      });
      await api('/api/me/avatar', { body: { attachmentId: res.id } });
      await loadMe(true);
      toast('Foto profil diperbarui');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Gagal memproses foto', { tone: 'danger' });
    } finally {
      up = null;
    }
  }

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
      <button
        class="av-btn"
        aria-label="Ganti foto profil"
        disabled={!!up}
        onclick={() => fileInput?.click()}
      >
        {#key u.avatarUrl}<Avatar name={u.fullName} src={u.avatarUrl} size={64} />{/key}
        <span class="cam" aria-hidden="true"><Icon name="camera" size={14} /></span>
      </button>
      <input bind:this={fileInput} type="file" accept="image/*" hidden onchange={onPick} />
      <div class="who">
        <h1>{u.fullName}</h1>
        <p class="muted">@{u.username} · {u.roleName}</p>
        <p class="muted">{u.email} <span class="ok">✓ Terverifikasi</span></p>
        {#if up}
          <div class="up" aria-live="polite">
            <span class="faint">
              {#if up.phase === 'compress'}
                Mengompres {formatBytes(up.before)}…
              {:else}
                Dikompres {formatBytes(up.before)} → {formatBytes(up.after)} · mengunggah {up.pct}%
              {/if}
            </span>
            <Progress value={up.phase === 'compress' ? 10 : up.pct} width={220} />
          </div>
        {:else}
          <div>
            <Button variant="secondary" icon="camera" onclick={() => fileInput?.click()}
              >Ganti foto</Button
            >
          </div>
        {/if}
      </div>
    </section>

    {#if hasGlobal('admin.roles') || hasGlobal('admin.users')}
      <section class="card">
        <h2>Admin</h2>
        <p class="muted">Kelola pengguna dan cakupan akses setiap role.</p>
        <div class="admin-links">
          {#if hasGlobal('admin.users')}<Button href={resolve('/admin/pengguna')} icon="users"
              >Pengguna</Button
            >{/if}
          {#if hasGlobal('admin.roles')}<Button href={resolve('/admin/role')} icon="shield"
              >Role & izin</Button
            >{/if}
        </div>
      </section>
    {/if}
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
  .admin-links {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
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
    gap: 4px;
    min-width: 0;
  }
  .av-btn {
    position: relative;
    border-radius: 50%;
    flex: none;
  }
  .cam {
    position: absolute;
    right: -2px;
    bottom: -2px;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border-strong);
    color: var(--color-icon-default);
  }
  .up {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 12px;
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
