<script lang="ts">
  import { USER_STATUS_LABEL, type UserStatus } from '@rein/shared';
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import Avatar from '$lib/components/Avatar.svelte';
  import Button from '$lib/components/Button.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import Input from '$lib/components/Input.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import { hasGlobal } from '$lib/session.svelte';
  import { toast } from '$lib/toast.svelte';

  /** Admin — Pengguna (Figma D/10a, M/10). M0: daftar, undang, kirim ulang, aktif/nonaktif. */
  interface Row {
    id: string;
    username: string;
    fullName: string;
    status: UserStatus;
    roleName: string;
    email: string | null;
    emailVerified: boolean;
    lastActiveAt: string | null;
  }
  interface Role {
    id: string;
    name: string;
    divisionLabel: string;
  }

  let rows = $state<Row[] | null>(null);
  let roles = $state<Role[]>([]);
  let loadError = $state<string | null>(null);
  let query = $state('');
  let inviteOpen = $state(false);
  let saving = $state(false);
  let form = $state({ fullName: '', email: '', username: '', roleId: '', whatsapp: '' });
  let fieldErrors = $state<Record<string, string>>({});

  const allowed = hasGlobal('admin.users');
  const filtered = $derived(
    (rows ?? []).filter((r) =>
      `${r.fullName} ${r.username} ${r.email ?? ''} ${r.roleName}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
    ),
  );

  async function load() {
    try {
      const [u, r] = await Promise.all([
        api<{ users: Row[] }>('/api/admin/users'),
        api<{ roles: Role[] }>('/api/admin/roles'),
      ]);
      rows = u.users;
      roles = r.roles;
    } catch (err) {
      loadError = err instanceof ApiError ? err.message : 'Gagal memuat';
    }
  }
  onMount(() => {
    if (allowed) void load();
  });

  function openInvite() {
    form = { fullName: '', email: '', username: '', roleId: roles[0]?.id ?? '', whatsapp: '' };
    fieldErrors = {};
    inviteOpen = true;
  }

  async function invite(e?: SubmitEvent) {
    e?.preventDefault();
    saving = true;
    fieldErrors = {};
    try {
      const res = await api<{ mailSent: boolean }>('/api/admin/users/invite', {
        body: { ...form, whatsapp: form.whatsapp.trim() || undefined },
      });
      inviteOpen = false;
      if (res.mailSent) toast(`Undangan terkirim ke ${form.email}`);
      else {
        toast('Pengguna dibuat, tetapi email undangan gagal dikirim. Kirim ulang nanti.', {
          tone: 'danger',
        });
      }
      await load();
    } catch (err) {
      if (err instanceof ApiError) {
        fieldErrors = err.fields;
        if (!Object.keys(err.fields).length) toast(err.message, { tone: 'danger' });
      }
    } finally {
      saving = false;
    }
  }

  async function act(row: Row, action: 'resend-invite' | 'disable' | 'enable') {
    try {
      await api(`/api/admin/users/${row.id}/${action}`, { body: {} });
      toast(
        action === 'resend-invite'
          ? `Undangan dikirim ulang ke ${row.email}`
          : action === 'disable'
            ? `${row.fullName} dinonaktifkan`
            : `${row.fullName} diaktifkan kembali`,
      );
      await load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Gagal', { tone: 'danger' });
    }
  }

  const fmt = new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Jakarta',
  });
</script>

<svelte:head><title>Pengguna · REIN</title></svelte:head>

{#if !allowed}
  <EmptyState icon="lock" title="Tidak ada akses" message="Halaman ini hanya untuk Admin." />
{:else}
  <div class="toolbar">
    <input
      class="search"
      type="search"
      placeholder="Cari nama, username, email, role…"
      aria-label="Cari pengguna"
      bind:value={query}
    />
    <Button variant="primary" icon="plus" onclick={openInvite} disabled={!roles.length}
      >Undang pengguna</Button
    >
  </div>

  {#if loadError}
    <EmptyState icon="alert" title="Gagal memuat" message={loadError} />
  {:else if !rows}
    {#each [0, 1, 2, 3] as i (i)}
      <div class="sk-row"><span class="sk"></span><span class="sk w"></span></div>
    {/each}
  {:else if !filtered.length}
    <EmptyState icon="users" title="Tidak ada pengguna" message="Coba kata kunci lain." />
  {:else}
    <div class="tbl" role="table" aria-label="Daftar pengguna">
      <div class="th" role="row">
        <span role="columnheader">Nama</span><span role="columnheader">Email</span>
        <span role="columnheader">Role</span><span role="columnheader">Status</span>
        <span role="columnheader">Terakhir aktif</span><span role="columnheader"></span>
      </div>
      {#each filtered as r (r.id)}
        <div class="tr" role="row">
          <span class="nm" role="cell">
            <Avatar name={r.fullName} size={24} />
            <span><b>{r.fullName}</b><small>@{r.username}</small></span>
          </span>
          <span class="cell" role="cell">
            {r.email ?? '—'}
            {#if r.emailVerified}<span class="ok" title="Email terverifikasi">✓</span>{/if}
          </span>
          <span class="cell" role="cell">{r.roleName}</span>
          <span class="cell" role="cell">
            <span class="dot {r.status}" aria-hidden="true"></span>{USER_STATUS_LABEL[r.status]}
          </span>
          <span class="cell faint" role="cell"
            >{r.lastActiveAt ? fmt.format(new Date(r.lastActiveAt)) : '—'}</span
          >
          <span class="acts" role="cell">
            {#if r.status === 'invited'}
              <Button variant="ghost" onclick={() => act(r, 'resend-invite')}>Kirim ulang</Button>
            {/if}
            {#if r.status === 'disabled'}
              <Button variant="ghost" onclick={() => act(r, 'enable')}>Aktifkan</Button>
            {:else}
              <Button variant="ghost" onclick={() => act(r, 'disable')}>Nonaktifkan</Button>
            {/if}
          </span>
        </div>
      {/each}
    </div>
  {/if}
{/if}

<Modal bind:open={inviteOpen} title="Undang pengguna" width={520}>
  <form id="invite" class="grid" onsubmit={invite} novalidate>
    <Input label="Nama lengkap" bind:value={form.fullName} error={fieldErrors.fullName} />
    <Input
      label="Username"
      autocapitalize="none"
      bind:value={form.username}
      error={fieldErrors.username}
    />
    <Input label="Email" type="email" bind:value={form.email} error={fieldErrors.email} />
    <Input
      label="Nomor WhatsApp"
      type="tel"
      placeholder="0812…"
      hint="Opsional — diverifikasi user sendiri"
      bind:value={form.whatsapp}
      error={fieldErrors.whatsapp}
    />
    <div class="field">
      <label for="role">Role</label>
      <select id="role" bind:value={form.roleId}>
        {#each roles as r (r.id)}<option value={r.id}>{r.name} — {r.divisionLabel}</option>{/each}
      </select>
      {#if fieldErrors.roleId}<span class="msg">{fieldErrors.roleId}</span>{/if}
    </div>
  </form>
  {#snippet footer()}
    <span class="note faint">Tautan aktivasi berlaku 72 jam.</span>
    <Button variant="ghost" onclick={() => (inviteOpen = false)}>Batal</Button>
    <Button variant="primary" type="submit" form="invite" loading={saving}>Kirim undangan</Button>
  {/snippet}
</Modal>

<style>
  .toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 24px;
    border-bottom: 1px solid var(--color-border-default);
  }
  .search {
    flex: 1;
    max-width: 360px;
    height: 28px;
    padding: 0 10px;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    background: var(--color-bg-surface);
    outline: none;
  }
  .search:focus {
    border-color: var(--color-accent-default);
  }
  .th,
  .tr {
    display: grid;
    grid-template-columns: minmax(0, 1.4fr) minmax(0, 1.4fr) 150px 110px 130px 190px;
    align-items: center;
    gap: 12px;
    padding: 0 24px;
  }
  .th {
    height: 32px;
    background: var(--color-bg-subtle);
    border-bottom: 1px solid var(--color-border-default);
    font: var(--text-label);
    color: var(--color-text-tertiary);
  }
  .tr {
    min-height: 44px;
    border-bottom: 1px solid var(--color-border-default);
    transition: background var(--dur);
  }
  .tr:hover {
    background: var(--color-bg-hover);
  }
  .nm {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  .nm b {
    font-weight: 500;
    display: block;
  }
  .nm small {
    display: block;
    color: var(--color-text-tertiary);
    font-size: 12px;
    line-height: 14px;
  }
  .cell {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    color: var(--color-text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ok {
    color: var(--color-success-default);
    font-weight: 600;
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--color-text-tertiary);
    flex: none;
  }
  .dot.active {
    background: var(--color-accent-default);
  }
  .dot.invited {
    background: var(--color-border-strong);
  }
  .acts {
    display: flex;
    justify-content: flex-end;
    gap: 4px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .field label {
    font: var(--text-label);
    color: var(--color-text-secondary);
  }
  select {
    height: 32px;
    padding: 0 8px;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-bg-surface);
  }
  .msg {
    font: var(--text-caption);
    color: var(--color-danger-default);
  }
  .note {
    flex: 1;
    font-size: 12px;
  }
  .sk-row {
    display: flex;
    gap: 12px;
    align-items: center;
    height: 44px;
    padding: 0 24px;
    border-bottom: 1px solid var(--color-border-default);
  }
  .sk {
    height: 10px;
    width: 160px;
    border-radius: 4px;
    background: linear-gradient(
      90deg,
      var(--color-bg-hover) 25%,
      var(--color-bg-subtle) 50%,
      var(--color-bg-hover) 75%
    );
    background-size: 200% 100%;
    animation: shim 1.1s linear infinite;
  }
  .sk.w {
    width: 240px;
  }
  @keyframes shim {
    to {
      background-position: -200% 0;
    }
  }
  @media (max-width: 1100px) {
    .th,
    .tr {
      grid-template-columns: minmax(0, 1fr) 120px 100px 170px;
    }
    .th > :nth-child(2),
    .tr > :nth-child(2),
    .th > :nth-child(5),
    .tr > :nth-child(5) {
      display: none;
    }
  }
  @media (max-width: 767px) {
    .toolbar {
      padding: 12px 16px;
    }
    .th {
      display: none;
    }
    .tr {
      grid-template-columns: minmax(0, 1fr) auto;
      padding: 10px 16px;
      row-gap: 6px;
    }
    .tr > :nth-child(3) {
      display: none;
    }
    .acts {
      grid-column: 1 / -1;
      justify-content: flex-start;
    }
    .grid {
      grid-template-columns: minmax(0, 1fr);
    }
    select {
      height: 44px;
    }
  }
</style>
