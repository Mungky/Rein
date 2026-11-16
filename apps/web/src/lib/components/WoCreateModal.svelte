<script lang="ts">
  import { WO_CATEGORY_META, WO_CATEGORIES } from '@rein/shared';
  import { api, ApiError } from '$lib/api';
  import type { Staged } from '$lib/attach';
  import { session } from '$lib/session.svelte';
  import { toast } from '$lib/toast.svelte';
  import type { Member, WoType } from '$lib/types';
  import Button from './Button.svelte';
  import Field from './Field.svelte';
  import Input from './Input.svelte';
  import Modal from './Modal.svelte';
  import StagedFiles from './StagedFiles.svelte';
  import Toggle from './Toggle.svelte';

  /**
   * Buat WO (Figma D/06, M/06; FR-030). `clientId` dibuat sekali per form → kirim ulang
   * (mis. koneksi putus) tidak membuat WO ganda. Lampiran diunggah dulu sebagai staging.
   */
  interface Props {
    open?: boolean;
    projectId: string;
    members: Member[];
    canWeight?: boolean;
    oncreated?: (id: string) => void;
  }
  let { open = $bindable(false), projectId, members, canWeight = false, oncreated }: Props = $props();

  let types = $state<WoType[]>([]);
  let clientId = $state(crypto.randomUUID());
  let f = $state({ title: '', typeId: '', assigneeId: '', deadline: '', plannedStart: '', urgent: false, weight: '', detail: '' });
  let files = $state<Staged[]>([]);
  let errors = $state<Record<string, string>>({});
  let busy = $state(false);

  $effect(() => {
    if (open && !types.length) {
      void api<{ woTypes: WoType[] }>('/api/directory/wo-types').then((r) => {
        types = r.woTypes.filter((t) => t.active !== false);
      });
    }
  });
  $effect(() => {
    if (open && !f.assigneeId && session.me) {
      f.assigneeId = members.some((m) => m.userId === session.me!.user.id)
        ? session.me.user.id
        : (members[0]?.userId ?? '');
    }
  });

  const grouped = $derived(
    WO_CATEGORIES.map((c) => ({ c, items: types.filter((t) => t.category === c) })).filter(
      (g) => g.items.length,
    ),
  );
  const uploading = $derived(files.some((x) => !x.id && !x.error));

  function reset() {
    clientId = crypto.randomUUID();
    f = { title: '', typeId: '', assigneeId: '', deadline: '', plannedStart: '', urgent: false, weight: '', detail: '' };
    files = [];
    errors = {};
  }

  async function submit(e?: SubmitEvent) {
    e?.preventDefault();
    errors = {};
    if (!f.title.trim()) errors.title = 'Nama WO wajib diisi';
    if (!f.typeId) errors.typeId = 'Pilih jenis WO';
    if (!f.assigneeId) errors.assigneeId = 'Pilih PIC';
    if (!f.deadline) errors.deadline = 'Isi deadline';
    if (Object.keys(errors).length) return;
    busy = true;
    try {
      const weight = f.weight.trim() === '' ? undefined : Number(f.weight.replace(',', '.'));
      const r = await api<{ id: string; numberLabel: string; attachments: number; assigneeName: string; whatsappQueued: boolean }>(
        `/api/projects/${projectId}/work-orders`,
        {
          body: {
            clientId,
            title: f.title.trim(),
            typeId: f.typeId,
            assigneeId: f.assigneeId,
            deadline: f.deadline,
            ...(f.plannedStart ? { plannedStart: f.plannedStart } : {}),
            urgent: f.urgent,
            ...(canWeight && weight !== undefined ? { weight } : {}),
            ...(f.detail.trim() ? { detail: f.detail.trim() } : {}),
            attachmentIds: files.filter((x) => x.id).map((x) => x.id!),
          },
        },
      );
      const lamp = r.attachments ? ` dengan ${r.attachments} lampiran` : '';
      toast(
        `${r.numberLabel} dibuat${lamp}` +
          (r.whatsappQueued ? ` · notifikasi dikirim ke ${r.assigneeName}` : ''),
      );
      open = false;
      reset();
      oncreated?.(r.id);
    } catch (err) {
      if (err instanceof ApiError) {
        errors = err.fields;
        if (!Object.keys(err.fields).length) toast(err.message, { tone: 'danger' });
      } else toast('Terjadi kesalahan', { tone: 'danger' });
    } finally {
      busy = false;
    }
  }
</script>

<Modal bind:open title="Buat Work Order" width={640}>
  <form id="wo-create" class="g" onsubmit={submit} novalidate>
    <Input label="Nama WO" bind:value={f.title} error={errors.title} maxlength={160} placeholder="mis. Gambar GA & detail nozzle" />
    <div class="two">
      <Field label="Jenis" id="wc-type" error={errors.typeId}>
        <select id="wc-type" bind:value={f.typeId}>
          <option value="" disabled>Pilih jenis…</option>
          {#each grouped as g (g.c)}
            <optgroup label={WO_CATEGORY_META[g.c].label}>
              {#each g.items as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
            </optgroup>
          {/each}
        </select>
      </Field>
      <Field label="PIC" id="wc-pic" error={errors.assigneeId}>
        <select id="wc-pic" bind:value={f.assigneeId}>
          {#each members as m (m.userId)}<option value={m.userId}>{m.fullName} · {m.projectRole}</option>{/each}
        </select>
      </Field>
    </div>
    <div class="two">
      <Input label="Mulai (opsional)" type="date" bind:value={f.plannedStart} error={errors.plannedStart} />
      <Input label="Deadline" type="date" bind:value={f.deadline} error={errors.deadline} />
    </div>
    <div class="two">
      <Toggle bind:checked={f.urgent} label="Urgent" showLabel />
      {#if canWeight}
        <Input label="Bobot (%)" inputmode="decimal" bind:value={f.weight} hint="Kosongkan = dibagi otomatis" error={errors.weight} />
      {/if}
    </div>
    <Field label="Detail (opsional)" id="wc-detail" error={errors.detail}>
      <textarea id="wc-detail" bind:value={f.detail} rows="3" maxlength="5000"></textarea>
    </Field>
    <StagedFiles userId={session.me?.user.id ?? ''} bind:items={files} />
  </form>
  {#snippet footer()}
    <Button onclick={() => (open = false)}>Batal</Button>
    <Button variant="primary" type="submit" form="wo-create" loading={busy} disabled={uploading}>Buat WO</Button>
  {/snippet}
</Modal>

<style>
  .g {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .two {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    align-items: end;
  }
  @media (max-width: 767px) {
    .two {
      grid-template-columns: 1fr;
    }
  }
</style>
