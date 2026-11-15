<script lang="ts">
  import { page } from '$app/state';
  import { WO_CATEGORIES, WO_CATEGORY_META, WO_STATUSES, type WoStatus } from '@rein/shared';
  import AppShell from '$lib/components/AppShell.svelte';
  import Avatar from '$lib/components/Avatar.svelte';
  import Button from '$lib/components/Button.svelte';
  import CategoryDot from '$lib/components/CategoryDot.svelte';
  import Checkbox from '$lib/components/Checkbox.svelte';
  import FlagBadge from '$lib/components/FlagBadge.svelte';
  import Input from '$lib/components/Input.svelte';
  import Kbd from '$lib/components/Kbd.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import Progress from '$lib/components/Progress.svelte';
  import StatusBadge from '$lib/components/StatusBadge.svelte';
  import StatusIcon from '$lib/components/StatusIcon.svelte';
  import Tag from '$lib/components/Tag.svelte';
  import Toggle from '$lib/components/Toggle.svelte';
  import { toggleTheme } from '$lib/theme.svelte';
  import { toast } from '$lib/toast.svelte';

  const embed = $derived(page.url.searchParams.has('embed'));

  let modalOpen = $state(false);
  let urgent = $state(true);
  let quiet = $state(false);
  let remember = $state(true);
  let agree = $state(false);
  let progress = $state(60);
  let cycleIdx = $state(2);
  const cycled = $derived<WoStatus>(WO_STATUSES[cycleIdx % 5] ?? 'todo');
  let email = $state('rina@remula.co.id');
</script>

<svelte:head>
  <title>Komponen · REIN</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<AppShell
  user={{ fullName: 'Rina Pratiwi', roleName: 'Manager' }}
  isAdmin
  title="Komponen"
  crumbs={[{ label: 'Dev' }]}
>
  <div class="pad">
    <header class="hd">
      <div>
        <h1>Komponen dasar</h1>
        <p class="muted">Acuan: Figma “Tokens &amp; Components” dan design/rein-prototype.html.</p>
      </div>
      <Button variant="secondary" icon="moon" onclick={(e) => toggleTheme(e.currentTarget)}
        >Ganti tema</Button
      >
    </header>

    <section>
      <h2>Button</h2>
      <div class="row">
        <Button variant="primary" icon="plus">Buat WO</Button>
        <Button variant="secondary">Batal</Button>
        <Button variant="ghost" icon="filter">Filter</Button>
        <Button variant="danger">Hapus</Button>
        <Button variant="primary" disabled>Nonaktif</Button>
        <Button variant="primary" loading>Menyimpan</Button>
      </div>
      <div class="row">
        <Button variant="primary" size="md" icon="plus">Buat WO</Button>
        <Button variant="secondary" size="md">Batal</Button>
        <Button variant="ghost" size="md">Ghost</Button>
        <Button variant="danger" size="md">Hapus</Button>
      </div>
    </section>

    <section>
      <h2>Input</h2>
      <div class="grid">
        <Input label="Email atau username" placeholder="nama@remula.co.id" bind:value={email} />
        <Input
          label="No RPO"
          value="RPO-2026-014"
          error="No RPO sudah dipakai project Storage Tank 50L"
        />
        <Input label="Lokasi" placeholder="Sidoarjo" hint="Opsional" />
        <Input label="Klien" value="PT Nusantara Food Industri" disabled />
      </div>
    </section>

    <section>
      <h2>Status Badge</h2>
      <div class="row">
        {#each WO_STATUSES as s (s)}<StatusBadge status={s} />{/each}
      </div>
      <div class="row">
        <span class="muted">Animasi transisi:</span>
        <StatusIcon status={cycled} size={20} />
        <StatusBadge status={cycled} />
        <Button size="sm" icon="refresh" onclick={() => cycleIdx++}>Ubah status</Button>
      </div>
    </section>

    <section>
      <h2>Flag Badge</h2>
      <div class="row">
        <FlagBadge type="urgent" />
        <FlagBadge type="help" pulse />
        <FlagBadge type="late" />
      </div>
    </section>

    <section>
      <h2>Tag &amp; kategori</h2>
      <div class="row">
        {#each WO_CATEGORIES as c (c)}
          <Tag category={c}>{WO_CATEGORY_META[c].label}</Tag>
        {/each}
      </div>
      <div class="row">
        {#each WO_CATEGORIES as c (c)}<CategoryDot category={c} />{/each}
        <Tag>Tanpa kategori</Tag>
      </div>
    </section>

    <section>
      <h2>Avatar &amp; Kbd</h2>
      <div class="row">
        <Avatar name="Rina Pratiwi" size={20} />
        <Avatar name="Udin Saputra" size={24} />
        <Avatar name="Amba Wijaya" size={32} />
        <Avatar name="Sari Handayani" size={64} />
        <Kbd>Ctrl K</Kbd>
        <Kbd>⇧ D</Kbd>
        <Kbd>Esc</Kbd>
      </div>
    </section>

    <section>
      <h2>Checkbox &amp; Toggle</h2>
      <div class="row">
        <Checkbox bind:checked={remember}>Ingat perangkat ini</Checkbox>
        <Checkbox bind:checked={agree}>Tandai bantuan selesai</Checkbox>
        <Checkbox checked disabled>Nonaktif</Checkbox>
      </div>
      <div class="row">
        <Toggle bind:checked={urgent} label="Urgent" showLabel />
        <Toggle bind:checked={quiet} label="Jam tenang" showLabel />
        <Toggle checked disabled label="Nonaktif" showLabel />
      </div>
    </section>

    <section>
      <h2>Progress</h2>
      <div class="stack">
        <Progress value={0} showLabel />
        <Progress value={progress} showLabel />
        <Progress value={100} showLabel />
        <div class="row">
          <Button size="sm" onclick={() => (progress = Math.max(0, progress - 20))}>−20</Button>
          <Button size="sm" onclick={() => (progress = Math.min(100, progress + 20))}>+20</Button>
        </div>
      </div>
    </section>

    <section>
      <h2>Toast</h2>
      <div class="row">
        <Button
          onclick={() =>
            toast('WO 10 dibuat · notifikasi WA & email terkirim ke Udin S.', {
              link: { label: 'Buka', onclick: () => {} },
            })}>Toast sukses</Button
        >
        <Button
          onclick={() => toast('Notifikasi gagal dikirim, akan dicoba lagi', { tone: 'danger' })}
          >Toast gagal</Button
        >
      </div>
    </section>

    <section>
      <h2>Modal / Bottom Sheet</h2>
      <p class="muted">Desktop: modal di tengah. Di bawah 768 px otomatis menjadi bottom sheet.</p>
      <div class="row">
        <Button variant="primary" onclick={() => (modalOpen = true)}>Buka modal</Button>
        <span class="muted">Command palette: <Kbd>Ctrl K</Kbd> atau <Kbd>/</Kbd></span>
      </div>
    </section>

    {#if !embed}
      <section>
        <h2>Pratinjau 390 px</h2>
        <p class="muted">Halaman yang sama dalam bingkai mobile 390 × 844.</p>
        <iframe
          class="phone"
          src="/dev/komponen?embed=1"
          title="Pratinjau mobile 390 px"
          width="390"
          height="844"
        ></iframe>
      </section>
    {/if}
  </div>
</AppShell>

<Modal bind:open={modalOpen} title="Butuh bantuan">
  <Input label="Kendala" placeholder="Jelaskan kendala singkat…" />
  <Checkbox checked>Tampilkan flag di WO</Checkbox>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (modalOpen = false)}>Batal</Button>
    <Button
      variant="primary"
      onclick={() => {
        modalOpen = false;
        toast('Permintaan bantuan terkirim');
      }}>Kirim</Button
    >
  {/snippet}
</Modal>

<style>
  .pad {
    display: flex;
    flex-direction: column;
    gap: 28px;
    padding: 24px 32px 48px;
    max-width: 1100px;
  }
  .hd {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
  }
  section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }
  .stack {
    display: flex;
    flex-direction: column;
    gap: 12px;
    max-width: 320px;
  }
  .phone {
    border: 1px solid var(--color-border-strong);
    border-radius: 24px;
    background: var(--color-bg-app);
    max-width: 100%;
  }
  @media (max-width: 767px) {
    .pad {
      padding: 16px 16px 32px;
    }
    .grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
