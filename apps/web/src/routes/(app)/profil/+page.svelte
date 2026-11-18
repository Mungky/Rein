<script lang="ts">
  import { PASSWORD_MIN } from '@rein/shared';
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { api, ApiError } from '$lib/api';
  import Avatar from '$lib/components/Avatar.svelte';
  import Button from '$lib/components/Button.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Progress from '$lib/components/Progress.svelte';
  import UserNotificationSettings from '$lib/components/UserNotificationSettings.svelte';
  import Input from '$lib/components/Input.svelte';
  import { compressImage } from '$lib/image';
  import { stamp } from '$lib/format';
  import { hasGlobal, loadMe, logout, session } from '$lib/session.svelte';
  import { toast } from '$lib/toast.svelte';
  import { uploadAttachment } from '$lib/upload';

  /** Profil & keamanan (Figma D/09, M/09). */
  let confirmOpen = $state(false);
  let busy = $state(false);
  let passwordOpen = $state(false);
  let passwords = $state({ currentPassword: '', password: '', confirmation: '' });
  let passwordError = $state('');
  type Device = {
    id: string;
    label: string;
    lastSeenAt: string;
    current: boolean;
    hasPin: boolean;
  };
  let devices = $state<Device[] | null>(null);
  let devicesError = $state('');
  let selectedDevice = $state<Device | null>(null);
  let deviceOpen = $state(false);

  async function loadDevices() {
    devicesError = '';
    try {
      devices = (await api<{ devices: Device[] }>('/api/me/devices')).devices;
    } catch (err) {
      devicesError = err instanceof ApiError ? err.message : 'Gagal memuat perangkat';
    }
  }
  onMount(() => void loadDevices());

  async function revokeDevice() {
    if (!selectedDevice || busy) return;
    busy = true;
    try {
      const { signedOut } = await api<{ signedOut: boolean }>(
        `/api/me/devices/${selectedDevice.id}`,
        {
          method: 'DELETE',
        },
      );
      deviceOpen = false;
      toast('Perangkat dicabut');
      if (signedOut) {
        await logout();
        await goto(resolve('/masuk'));
      } else await loadDevices();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Perangkat gagal dicabut', { tone: 'danger' });
    } finally {
      busy = false;
    }
  }

  async function savePassword(e: SubmitEvent) {
    e.preventDefault();
    if (passwords.password !== passwords.confirmation) {
      passwordError = 'Konfirmasi password belum sama.';
      return;
    }
    busy = true;
    passwordError = '';
    try {
      await api('/api/me/password', {
        body: { currentPassword: passwords.currentPassword, password: passwords.password },
      });
      passwordOpen = false;
      await logout();
      toast('Password diganti. Silakan masuk kembali.');
      await goto(resolve('/masuk'));
    } catch (err) {
      passwordError = err instanceof ApiError ? err.message : 'Password gagal disimpan';
    } finally {
      busy = false;
    }
  }
  let nickname = $state(session.me?.user.nickname ?? '');
  let savingName = $state(false);
  let nameError = $state<string | null>(null);
  const nameChanged = $derived(nickname.trim() !== (session.me?.user.nickname ?? ''));
  async function saveNickname(e: SubmitEvent) {
    e.preventDefault();
    savingName = true;
    nameError = null;
    try {
      await api('/api/me/nickname', { body: { nickname } });
      await loadMe(true);
      toast('Nama panggilan diperbarui');
    } catch (err) {
      nameError = err instanceof ApiError ? err.message : 'Gagal menyimpan';
    } finally {
      savingName = false;
    }
  }
  let fileInput = $state<HTMLInputElement>();
  let up = $state<{
    phase: 'compress' | 'upload';
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
    up = { phase: 'compress', pct: 0 };
    try {
      const img = await compressImage(file, { square: 256, quality: 0.85 });
      up = { phase: 'upload', pct: 0 };
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
  <div class="settings-layout">
    <nav class="settings-nav" aria-label="Pengaturan akun">
      <p class="nav-label">Akun saya</p>
      <div class="nav-items">
        <a
          href="#profil"
          aria-current={!page.url.hash || page.url.hash === '#profil' ? 'location' : undefined}
          ><Icon name="user" />Profil</a
        >
        <a
          href="#kontak"
          aria-label="Kontak & notifikasi"
          aria-current={page.url.hash === '#kontak' ? 'location' : undefined}
          ><Icon name="mail" />Kontak</a
        >
        <a href="#keamanan" aria-current={page.url.hash === '#keamanan' ? 'location' : undefined}
          ><Icon name="lock" />Keamanan</a
        >
      </div>
    </nav>

    <div class="content">
      <section id="profil" aria-label="Profil">
        <div class="identity">
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
            <p>{u.roleName} <span aria-hidden="true">·</span> @{u.username}</p>
            <Button
              variant="secondary"
              icon="camera"
              disabled={!!up}
              onclick={() => fileInput?.click()}>Ganti foto</Button
            >
          </div>
        </div>
        {#if up}
          <div class="up" aria-live="polite">
            <span
              >{up.phase === 'compress' ? 'Menyiapkan foto…' : `Mengunggah foto ${up.pct}%`}</span
            >
            <Progress value={up.phase === 'compress' ? 10 : up.pct} />
          </div>
        {/if}
        <form class="nickname" onsubmit={saveNickname}>
          <div class="name-field">
            <Input
              label="Nama panggilan"
              bind:value={nickname}
              maxlength={40}
              required
              autocomplete="nickname"
              error={nameError}
              disabled={savingName}
            />
            <p class="hint">Nama yang ditampilkan di REIN.</p>
          </div>
          <Button
            type="submit"
            variant="secondary"
            loading={savingName}
            disabled={!nameChanged || !nickname.trim()}>Simpan</Button
          >
        </form>
      </section>

      <section id="kontak" aria-label="Kontak dan notifikasi">
        <UserNotificationSettings />
      </section>

      <section id="keamanan" aria-labelledby="security-title">
        <div class="section-heading">
          <h2 id="security-title">Keamanan</h2>
        </div>
        <div class="group">
          <div class="setting-row">
            <Icon name="lock" size={18} />
            <div class="row-copy"><h3>Password</h3></div>
            <Button
              onclick={() => {
                passwords = { currentPassword: '', password: '', confirmation: '' };
                passwordError = '';
                passwordOpen = true;
              }}>Ganti password</Button
            >
          </div>
          <div class="setting-row">
            <Icon name="key" size={18} />
            <div class="row-copy">
              <h3>PIN masuk cepat</h3>
              <p>
                {session.me.device
                  ? session.me.device.hasPin
                    ? 'Aktif di perangkat ini.'
                    : 'Belum diatur di perangkat ini.'
                  : 'PIN belum tersedia di browser ini.'}
              </p>
            </div>
            {#if session.me.device}<Button href={resolve('/pin') + '?next=%2Fprofil%23keamanan'}
                >{session.me.device?.hasPin ? 'Ganti PIN' : 'Buat PIN'}</Button
              >{/if}
          </div>
          <div class="setting-row logout-row">
            <Icon name="logout" size={18} />
            <div class="row-copy">
              <h3>Sesi akun</h3>
              <p>Keluar dari semua perangkat, termasuk perangkat ini.</p>
            </div>
            <Button onclick={() => (confirmOpen = true)}>Keluar semua</Button>
          </div>
        </div>
        <h3>Perangkat tepercaya</h3>
        <div class="group">
          {#if devicesError}
            <p role="alert">{devicesError}</p>
            <Button onclick={loadDevices}>Coba lagi</Button>
          {:else if !devices}
            <p role="status">Memuat perangkat…</p>
          {:else if !devices.length}
            <p>Belum ada perangkat tepercaya.</p>
          {:else}
            {#each devices as device (device.id)}
              <div class="setting-row">
                <Icon name="shield" size={18} />
                <div class="row-copy">
                  <h3>{device.label}{device.current ? ' · Perangkat ini' : ''}</h3>
                  <p>
                    Terakhir aktif {stamp(device.lastSeenAt)}{device.hasPin ? ' · PIN aktif' : ''}
                  </p>
                </div>
                <Button
                  onclick={() => {
                    selectedDevice = device;
                    deviceOpen = true;
                  }}>Cabut</Button
                >
              </div>
            {/each}
          {/if}
        </div>
      </section>
      {#if hasGlobal('admin.roles') || hasGlobal('admin.users')}
        <section class="mobile-admin" aria-labelledby="admin-title">
          <div class="section-heading"><h2 id="admin-title">Administrasi</h2></div>
          <div class="admin-links">
            {#if hasGlobal('admin.users')}<Button href={resolve('/admin/pengguna')} icon="users"
                >Pengguna</Button
              >{/if}
            {#if hasGlobal('admin.users')}<Button href={resolve('/admin/whatsapp')} icon="bell"
                >WhatsApp</Button
              >{/if}
            {#if hasGlobal('admin.roles')}<Button href={resolve('/admin/role')} icon="shield"
                >Role & izin</Button
              >{/if}
          </div>
        </section>
      {/if}
    </div>
  </div>
{/if}

<Modal bind:open={confirmOpen} title="Keluar dari semua perangkat?" width={440}>
  <p>Anda perlu masuk ulang di semua perangkat, termasuk perangkat ini.</p>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (confirmOpen = false)}>Batal</Button>
    <Button variant="danger" loading={busy} onclick={logoutAll}>Keluar semua</Button>
  {/snippet}
</Modal>

<Modal bind:open={passwordOpen} title="Ganti password" width={440}>
  <form class="password-form" id="password-form" onsubmit={savePassword}>
    {#if passwordError}<p role="alert">{passwordError}</p>{/if}
    <Input
      label="Password lama"
      type="password"
      autocomplete="current-password"
      bind:value={passwords.currentPassword}
      maxlength={200}
      required
    />
    <Input
      label="Password baru"
      type="password"
      autocomplete="new-password"
      bind:value={passwords.password}
      minlength={PASSWORD_MIN}
      maxlength={200}
      required
    />
    <Input
      label="Ulangi password baru"
      type="password"
      autocomplete="new-password"
      bind:value={passwords.confirmation}
      required
    />
    <p class="hint">Anda perlu masuk kembali di semua perangkat.</p>
  </form>
  {#snippet footer()}
    <Button onclick={() => (passwordOpen = false)}>Batal</Button>
    <Button variant="primary" type="submit" form="password-form" loading={busy}
      >Simpan password</Button
    >
  {/snippet}
</Modal>

<Modal bind:open={deviceOpen} title="Cabut perangkat?" width={440}>
  <p>
    Sesi dan PIN di {selectedDevice?.label ?? 'perangkat ini'} akan dicabut. Perangkat perlu masuk kembali
    dengan password.
  </p>
  {#snippet footer()}
    <Button onclick={() => (deviceOpen = false)}>Batal</Button>
    <Button variant="danger" loading={busy} onclick={revokeDevice}>Cabut perangkat</Button>
  {/snippet}
</Modal>

<style>
  .password-form {
    display: grid;
    gap: 12px;
  }
  .settings-layout {
    display: flex;
    min-height: 100%;
    background: var(--color-bg-surface);
  }
  .settings-nav {
    position: sticky;
    top: 0;
    align-self: flex-start;
    height: calc(100dvh - 48px);
    flex: 0 0 220px;
    padding: 20px 12px;
    border-right: 1px solid var(--color-border-default);
  }
  .nav-label {
    margin: 0 8px 10px;
    font: var(--text-label);
    color: var(--color-text-tertiary);
  }
  .nav-items {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .settings-nav a {
    display: flex;
    gap: 8px;
    align-items: center;
    min-height: 32px;
    padding: 6px 8px;
    border-radius: var(--radius-md);
    color: var(--color-text-secondary);
    font-weight: 500;
    text-decoration: none;
  }
  .settings-nav a:hover,
  .settings-nav a[aria-current] {
    background: var(--color-bg-hover);
    color: var(--color-text-primary);
  }
  .mobile-admin {
    display: none;
  }
  .admin-links {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .content {
    min-width: 0;
    width: 760px;
    max-width: 100%;
    padding: 28px 40px 48px;
    display: flex;
    flex-direction: column;
    gap: 32px;
  }
  section {
    min-width: 0;
    scroll-margin-top: 20px;
  }
  .identity {
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .who {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    align-items: flex-start;
  }
  .who p {
    margin-bottom: 6px;
    overflow-wrap: anywhere;
  }
  h1 {
    overflow-wrap: anywhere;
  }
  p {
    margin: 0;
    color: var(--color-text-secondary);
  }
  .hint {
    font: var(--text-caption);
    margin-top: 6px;
    color: var(--color-text-tertiary);
  }
  .nickname {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    margin-top: 24px;
    padding-top: 20px;
    border-top: 1px solid var(--color-border-default);
  }
  .name-field {
    flex: 1;
    max-width: 360px;
    min-width: 0;
  }
  .nickname > :global(.btn) {
    margin-top: 24px;
  }
  .section-heading {
    display: grid;
    gap: 4px;
    margin-bottom: 12px;
  }
  .group {
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
  }
  .setting-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px;
  }
  .setting-row + .setting-row {
    border-top: 1px solid var(--color-border-default);
  }
  .setting-row > :global(svg) {
    color: var(--color-text-tertiary);
  }
  .row-copy {
    flex: 1;
    min-width: 0;
  }
  h3 {
    font: var(--text-body-13);
    font-weight: 500;
    margin: 0 0 2px;
  }
  .row-copy p {
    font: var(--text-caption);
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
    font: var(--text-caption);
    margin-top: 16px;
    max-width: 360px;
    color: var(--color-text-secondary);
  }
  @media (min-width: 1101px) {
    .settings-layout {
      flex-direction: column;
    }
    .settings-nav {
      flex: none;
      height: auto;
      align-self: stretch;
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 10px 24px;
      border-right: 0;
      border-bottom: 1px solid var(--color-border-default);
      background: var(--color-bg-surface);
      z-index: 5;
    }
    .nav-label {
      margin: 0;
    }
    .nav-items {
      flex-direction: row;
      gap: 4px;
    }
    .content {
      width: 100%;
      max-width: 1280px;
      padding: 20px 24px 32px;
      gap: 20px;
    }
    section {
      scroll-margin-top: 72px;
    }
    #profil {
      display: grid;
      grid-template-columns: 1fr minmax(280px, 420px);
      gap: 20px;
      align-items: center;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--color-border-default);
    }
    .nickname {
      grid-column: 2;
      grid-row: 1;
      padding: 0;
      margin: 0;
      border: 0;
    }
    .name-field {
      max-width: none;
    }
    .up {
      grid-column: 1 / -1;
      margin-top: 0;
    }
    #keamanan .group {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .setting-row {
      padding: 12px;
    }
    .setting-row + .setting-row {
      border-top: 0;
      border-left: 1px solid var(--color-border-default);
    }
  }
  @media (max-width: 1100px) {
    .settings-layout {
      flex-direction: column;
    }
    .settings-nav {
      flex: none;
      height: auto;
      align-self: stretch;
      z-index: 5;
      background: var(--color-bg-surface);
      border-right: 0;
      border-bottom: 1px solid var(--color-border-default);
      padding: 8px 24px;
    }
    .nav-label {
      display: none;
    }
    .nav-items {
      flex-direction: row;
      flex-wrap: wrap;
      gap: 4px;
    }
    .content {
      padding: 24px;
    }
    section {
      scroll-margin-top: 84px;
    }
  }
  @media (max-width: 767px) {
    .settings-nav {
      padding: 8px;
    }
    .nav-items {
      justify-content: center;
    }
    .settings-nav a {
      font: var(--text-label);
      min-height: 44px;
      gap: 6px;
    }
    .mobile-admin {
      display: block;
    }
    .content {
      padding: 24px 16px 32px;
      gap: 28px;
    }
    .identity {
      flex-direction: column;
      gap: 12px;
      text-align: center;
    }
    .who {
      align-items: center;
    }
    .setting-row {
      flex-wrap: wrap;
      gap: 10px;
      padding: 14px 12px;
    }
    .row-copy {
      flex-basis: calc(100% - 28px);
    }
    .setting-row > :global(.btn) {
      margin-left: 28px;
    }
  }
</style>
