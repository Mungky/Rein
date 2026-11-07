"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Calendar,
  Check,
  File,
  FileImage,
  FileSpreadsheet,
  FileText,
  Loader2,
  Search,
  UploadCloud,
  X,
} from "lucide-react";
import type { workspaceApi, Task } from "@/lib/api/workspace";
import type { WorkOrderDetail, WorkOrderInput } from "@/lib/api/workspace-logbook";
import { apiErrorText } from "@/lib/api/client";
import { documentKinds, formatFileSize } from "./work-order-ui";
import { ActionForm, Field, textValue } from "./operations-ui";
import { personInitials } from "./compact-list";

export function todayLocal() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function formFiles(form: FormData) {
  return (form.getAll("files") as unknown as File[]).filter((file) => file.size > 0);
}

export function getFileIcon(fileName: string, className = "size-4 text-text-muted") {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "webp", "gif", "svg"].includes(ext)) {
    return <FileImage className={className} />;
  }
  if (["pdf", "doc", "docx", "txt", "rtf"].includes(ext)) {
    return <FileText className={className} />;
  }
  if (["xls", "xlsx", "csv"].includes(ext)) {
    return <FileSpreadsheet className={className} />;
  }
  return <File className={className} />;
}

export function WorkOrderForm({
  api,
  projectId,
  projectName,
  existing,
  onClose,
  onSaved,
  fullPage = true,
}: {
  api: typeof workspaceApi;
  projectId: string;
  projectName?: string;
  existing?: WorkOrderDetail;
  onClose: () => void;
  onSaved: (task: Task) => void;
  fullPage?: boolean;
}) {
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState("");
  const [start, setStart] = useState(existing?.start_date ?? todayLocal());
  const [end, setEnd] = useState(existing?.end_date ?? existing?.start_date ?? todayLocal());
  const [picSearch, setPicSearch] = useState("");
  const [selectedPicIds, setSelectedPicIds] = useState<string[]>(() => {
    if (existing?.assignees?.length) return existing.assignees.map((a) => a.id);
    if (existing?.task.assigned_to) return [existing.task.assigned_to];
    return [];
  });
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    api.workOrderPeople(projectId)
      .then((data) => {
        if (active) setPeople(data);
      })
      .catch((err) => {
        if (active) setError(apiErrorText(err, "Pilihan PIC belum tersedia"));
      });
    return () => {
      active = false;
    };
  }, [api, projectId]);

  const filteredPeople = useMemo(() => {
    const q = picSearch.trim().toLowerCase();
    if (!q) return people;
    return people.filter((p) => p.name.toLowerCase().includes(q));
  }, [people, picSearch]);

  const selectedPeople = useMemo(() => {
    return selectedPicIds.map((id) => {
      const found = people.find((p) => p.id === id);
      if (found) return found;
      const prev = existing?.assignees?.find((a) => a.id === id);
      return {
        id,
        name: prev?.name ?? (existing?.task.assigned_to === id ? (existing.task.assigned_name ?? "PIC") : "PIC"),
      };
    });
  }, [selectedPicIds, people, existing]);

  const durationDays = useMemo(() => {
    if (!start || !end) return null;
    const s = new Date(start + "T00:00:00");
    const e = new Date(end + "T00:00:00");
    const diff = e.getTime() - s.getTime();
    return Math.round(diff / (1000 * 60 * 60 * 24)) + 1;
  }, [start, end]);

  function appendFiles(newFiles: File[]) {
    setFiles((prev) => {
      const keys = new Set(prev.map((f) => `${f.name}-${f.size}-${f.lastModified}`));
      const unique = newFiles.filter((f) => !keys.has(`${f.name}-${f.size}-${f.lastModified}`) && f.size > 0);
      return [...prev, ...unique];
    });
  }

  if (fullPage) {
    return (
      <div className="workspace-surface flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-bg">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-border-soft px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3 min-w-0">
            <button
              aria-label="Kembali"
              type="button"
              onClick={onClose}
              className="btn btn-ghost btn-icon min-h-9 min-w-9"
            >
              <ArrowLeft className="size-4" />
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 id="wo-form-title" className="text-base font-bold truncate">
                  {existing ? "Ubah WO" : "Buat Work Order"}
                </h1>
                {(existing?.rpo_number || projectName) && (
                  <span className="hidden sm:inline-block text-xs text-primary font-medium">
                    · {existing?.rpo_number ?? projectName}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-text-muted truncate">
                {existing
                  ? `Mengubah rincian pekerjaan: ${existing.task.name}`
                  : "Isi pekerjaan, PIC, dan target jadwal pekerjaan proyek."}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost btn-sm"
          >
            Batal
          </button>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto bg-bg-ctrl/20 p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-3xl rounded-xl border border-border bg-bg p-5 sm:p-8 shadow-xs">
            {error && (
              <p role="alert" className="mb-5 rounded-lg bg-red-50 p-3 text-sm text-red-600">
                {error}
              </p>
            )}
            {!people.length && !error && (
              <div className="mb-4 flex items-center gap-2 text-xs text-text-muted">
                <Loader2 className="size-4 animate-spin text-primary" />
                <span>Memuat data PIC…</span>
              </div>
            )}
            <ActionForm
              submitLabel={existing ? "Simpan perubahan" : "Buat WO"}
              className="space-y-6"
              onCancel={onClose}
              cancelLabel="Batal"
              onSubmit={async (f) => {
                const body: WorkOrderInput = {
                  request_id: textValue(f, "__request_id"),
                  name: textValue(f, "name"),
                  description: textValue(f, "description"),
                  pic_ids: selectedPicIds,
                  attachment_kind: textValue(f, "attachment_kind"),
                  start_date: start,
                  end_date: end,
                  ...(existing ? { expected_updated_at: existing.task.updated_at } : {}),
                };
                const task = existing
                  ? await api.editWorkOrder(existing.task.id, body, files)
                  : await api.createWorkOrder(projectId, body, files);
                onSaved(task);
              }}
            >
              <Field label="Nama pekerjaan">
                <input
                  autoFocus
                  name="name"
                  required
                  maxLength={255}
                  defaultValue={existing?.task.name ?? ""}
                  placeholder="Contoh: Fabrikasi shell reactor"
                  className="field-input"
                />
              </Field>

              <Field label="Deskripsi pekerjaan">
                <textarea
                  name="description"
                  required
                  maxLength={10000}
                  rows={4}
                  defaultValue={existing?.task.description ?? ""}
                  placeholder="Jelaskan pekerjaan yang perlu dilakukan dan hasil yang diharapkan…"
                  className="field-input resize-y"
                />
              </Field>

              {/* PIC Selector Section */}
              <div className="space-y-3 rounded-xl border border-border bg-bg-ctrl/10 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-semibold text-text">PIC Pekerjaan</span>
                    <p className="text-[11px] text-text-muted">
                      Pilih satu atau beberapa penanggung jawab pekerjaan.
                    </p>
                  </div>
                  {selectedPicIds.length > 0 && (
                    <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary">
                      {selectedPicIds.length} dipilih
                    </span>
                  )}
                </div>

                {/* Selected PIC Badges */}
                {selectedPeople.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 rounded-lg border border-border-soft bg-bg p-2.5">
                    {selectedPeople.map((person) => (
                      <span
                        key={person.id}
                        className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 py-1 pl-1.5 pr-2.5 text-xs font-medium text-text"
                      >
                        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-white">
                          {personInitials(person.name)}
                        </span>
                        <span className="max-w-[160px] truncate">{person.name}</span>
                        <button
                          type="button"
                          aria-label={`Hapus PIC ${person.name}`}
                          onClick={() =>
                            setSelectedPicIds((prev) => prev.filter((id) => id !== person.id))
                          }
                          className="rounded-full p-0.5 text-text-muted hover:bg-primary/20 hover:text-text"
                        >
                          <X className="size-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {/* Quick Search */}
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-text-muted" />
                  <input
                    type="text"
                    value={picSearch}
                    onChange={(e) => setPicSearch(e.target.value)}
                    placeholder="Cari nama PIC…"
                    className="field-input pl-9 pr-8 text-xs"
                  />
                  {picSearch && (
                    <button
                      type="button"
                      aria-label="Bersihkan pencarian"
                      onClick={() => setPicSearch("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text"
                    >
                      <X className="size-3.5" />
                    </button>
                  )}
                </div>

                {/* People List */}
                <div className="max-h-56 overflow-y-auto divide-y divide-border-soft rounded-lg border border-border bg-bg">
                  {filteredPeople.length === 0 ? (
                    <p className="p-3 text-center text-xs text-text-muted">
                      {people.length === 0 ? "Memuat daftar PIC…" : "PIC tidak ditemukan."}
                    </p>
                  ) : (
                    filteredPeople.map((person) => {
                      const isSelected = selectedPicIds.includes(person.id);
                      return (
                        <button
                          key={person.id}
                          type="button"
                          onClick={() => {
                            setSelectedPicIds((prev) =>
                              isSelected
                                ? prev.filter((id) => id !== person.id)
                                : [...prev, person.id]
                            );
                          }}
                          className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs transition-colors ${
                            isSelected ? "bg-primary/5 hover:bg-primary/10" : "hover:bg-bg-hover"
                          }`}
                        >
                          <div className="flex min-w-0 items-center gap-2.5">
                            <span
                              className={`flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                                isSelected
                                  ? "bg-primary text-white"
                                  : "border border-border bg-bg-ctrl text-text-muted"
                              }`}
                            >
                              {personInitials(person.name)}
                            </span>
                            <span
                              className={`truncate font-medium ${
                                isSelected ? "font-semibold text-primary" : "text-text"
                              }`}
                            >
                              {person.name}
                            </span>
                          </div>
                          {isSelected ? (
                            <span className="flex shrink-0 items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
                              <Check className="size-3" /> Terpilih
                            </span>
                          ) : (
                            <span className="shrink-0 text-[11px] text-text-muted opacity-60 hover:opacity-100">
                              + Pilih
                            </span>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Schedule Section */}
              <div className="space-y-3 rounded-xl border border-border bg-bg-ctrl/10 p-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Tanggal Mulai">
                    <input
                      name="start"
                      type="date"
                      required
                      value={start}
                      onChange={(e) => {
                        const newStart = e.target.value;
                        setStart(newStart);
                        if (end < newStart) setEnd(newStart);
                      }}
                      className="field-input text-xs"
                    />
                  </Field>
                  <Field label="Tanggal Selesai">
                    <input
                      name="end"
                      type="date"
                      required
                      min={start}
                      value={end}
                      onChange={(e) => setEnd(e.target.value)}
                      className="field-input text-xs"
                    />
                  </Field>
                </div>

                {durationDays !== null && (
                  <div className="flex items-center gap-2 px-1 text-xs">
                    <Calendar className="size-3.5 text-primary" />
                    {durationDays > 0 ? (
                      <span className="text-text-muted">
                        Durasi pekerjaan:{" "}
                        <strong className="font-semibold text-text">{durationDays} hari kalender</strong>
                      </span>
                    ) : (
                      <span className="font-medium text-red-500">
                        Tanggal selesai harus sama atau setelah tanggal mulai
                      </span>
                    )}
                  </div>
                )}
              </div>

              <Field label="Jenis lampiran">
                <select name="attachment_kind" className="field-input text-xs">
                  {documentKinds.map((kind) => (
                    <option key={kind}>{kind}</option>
                  ))}
                </select>
              </Field>

              {/* Multi-file Upload Section */}
              <div className="space-y-3 rounded-xl border border-border bg-bg-ctrl/10 p-4">
                <label className="block text-xs font-semibold text-text">
                  {existing ? "Tambahkan lampiran baru (opsional)" : "Lampiran pekerjaan (opsional)"}
                </label>

                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDragging(false);
                    if (e.dataTransfer.files) appendFiles(Array.from(e.dataTransfer.files));
                  }}
                  className={`relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
                    isDragging
                      ? "border-primary bg-primary/5"
                      : "border-border bg-bg hover:border-primary/40"
                  }`}
                >
                  <UploadCloud className="mb-2 size-8 text-text-muted" />
                  <p className="text-xs font-medium text-text">
                    Tarik berkas ke sini, atau{" "}
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="font-semibold text-primary hover:underline"
                    >
                      pilih berkas
                    </button>
                  </p>
                  <p className="mt-1 text-[11px] text-text-muted">
                    Bisa pilih beberapa gambar, foto lapangan, PDF, atau dokumen pendukung.
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="sr-only"
                    onChange={(e) => {
                      if (e.target.files) appendFiles(Array.from(e.target.files));
                      e.target.value = "";
                    }}
                  />
                </div>

                {/* Uploaded Files List */}
                {files.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between px-1 text-xs text-text-muted">
                      <span>{files.length} berkas dipilih</span>
                      <button
                        type="button"
                        onClick={() => setFiles([])}
                        className="text-[11px] text-red-600 hover:underline"
                      >
                        Hapus semua
                      </button>
                    </div>
                    <ul className="max-h-48 overflow-y-auto divide-y divide-border-soft rounded-lg border border-border bg-bg p-1">
                      {files.map((file, idx) => (
                        <li
                          key={`${file.name}-${file.size}-${idx}`}
                          className="flex items-center justify-between gap-2 rounded-md p-1.5 text-xs hover:bg-bg-hover"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            {getFileIcon(file.name, "size-4 shrink-0 text-primary")}
                            <span className="truncate font-medium text-text" title={file.name}>
                              {file.name}
                            </span>
                            <span className="shrink-0 text-[10px] text-text-muted">
                              {formatFileSize(file.size)}
                            </span>
                          </div>
                          <button
                            type="button"
                            aria-label={`Hapus file ${file.name}`}
                            onClick={() => setFiles((prev) => prev.filter((_, i) => i !== idx))}
                            className="btn btn-ghost btn-icon btn-xs text-text-muted hover:text-red-600"
                          >
                            <X className="size-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </ActionForm>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="wo-form-title"
        className="modal-panel flex max-h-[92dvh] w-full max-w-xl flex-col"
      >
        <header className="flex items-start justify-between gap-4 border-b border-border-soft px-5 py-4">
          <div>
            <h2 id="wo-form-title" className="text-base font-bold">
              {existing ? "Ubah WO" : "Buat Work Order"}
            </h2>
            <p className="mt-1 text-xs text-text-muted">
              {existing
                ? "Deskripsi, PIC dan jadwal dalam satu form."
                : "Isi pekerjaan dan PIC, lalu WO langsung masuk To Do dan Timeline."}
            </p>
          </div>
          <button
            aria-label="Tutup form WO"
            type="button"
            onClick={onClose}
            className="btn btn-ghost btn-icon btn-sm"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="overflow-y-auto p-5">
          {error && (
            <p role="alert" className="mb-4 text-sm text-red-600">
              {error}
            </p>
          )}
          {!people.length && !error && (
            <Loader2 className="mb-4 size-4 animate-spin text-primary" />
          )}

          <ActionForm
            submitLabel={existing ? "Simpan perubahan" : "Buat WO"}
            className="space-y-4"
            onCancel={onClose}
            cancelLabel="Batal"
            onSubmit={async (f) => {
              const body: WorkOrderInput = {
                request_id: textValue(f, "__request_id"),
                name: textValue(f, "name"),
                description: textValue(f, "description"),
                pic_ids: selectedPicIds,
                attachment_kind: textValue(f, "attachment_kind"),
                start_date: start,
                end_date: end,
                ...(existing ? { expected_updated_at: existing.task.updated_at } : {}),
              };
              const task = existing
                ? await api.editWorkOrder(existing.task.id, body, files)
                : await api.createWorkOrder(projectId, body, files);
              onSaved(task);
            }}
          >
            <Field label="Nama pekerjaan">
              <input
                autoFocus
                name="name"
                required
                maxLength={255}
                defaultValue={existing?.task.name ?? ""}
                placeholder="Contoh: Fabrikasi shell reactor"
                className="field-input"
              />
            </Field>

            <Field label="Deskripsi pekerjaan">
              <textarea
                name="description"
                required
                maxLength={10000}
                rows={3}
                defaultValue={existing?.task.description ?? ""}
                placeholder="Jelaskan pekerjaan yang perlu dilakukan dan hasil yang diharapkan…"
                className="field-input resize-y"
              />
            </Field>

            {/* PIC Selector Section */}
            <div className="space-y-2 rounded-xl border border-border bg-bg-ctrl/10 p-3.5">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-semibold text-text">PIC Pekerjaan</span>
                  <p className="text-[11px] text-text-muted">
                    Pilih satu atau beberapa penanggung jawab pekerjaan.
                  </p>
                </div>
                {selectedPicIds.length > 0 && (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                    {selectedPicIds.length} dipilih
                  </span>
                )}
              </div>

              {/* Selected PIC Badges */}
              {selectedPeople.length > 0 && (
                <div className="flex flex-wrap gap-1.5 rounded-lg border border-border-soft bg-bg p-2">
                  {selectedPeople.map((person) => (
                    <span
                      key={person.id}
                      className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 py-0.5 pl-1 pr-2 text-xs font-medium text-text"
                    >
                      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-white">
                        {personInitials(person.name)}
                      </span>
                      <span className="max-w-[140px] truncate">{person.name}</span>
                      <button
                        type="button"
                        aria-label={`Hapus PIC ${person.name}`}
                        onClick={() =>
                          setSelectedPicIds((prev) => prev.filter((id) => id !== person.id))
                        }
                        className="rounded-full p-0.5 text-text-muted hover:bg-primary/20 hover:text-text"
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* Quick Search */}
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-text-muted" />
                <input
                  type="text"
                  value={picSearch}
                  onChange={(e) => setPicSearch(e.target.value)}
                  placeholder="Cari nama PIC…"
                  className="field-input pl-9 pr-8 text-xs"
                />
                {picSearch && (
                  <button
                    type="button"
                    aria-label="Bersihkan pencarian"
                    onClick={() => setPicSearch("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>

              {/* People List */}
              <div className="max-h-40 overflow-y-auto divide-y divide-border-soft rounded-lg border border-border bg-bg">
                {filteredPeople.length === 0 ? (
                  <p className="p-3 text-center text-xs text-text-muted">
                    {people.length === 0 ? "Memuat daftar PIC…" : "PIC tidak ditemukan."}
                  </p>
                ) : (
                  filteredPeople.map((person) => {
                    const isSelected = selectedPicIds.includes(person.id);
                    return (
                      <button
                        key={person.id}
                        type="button"
                        onClick={() => {
                          setSelectedPicIds((prev) =>
                            isSelected
                              ? prev.filter((id) => id !== person.id)
                              : [...prev, person.id]
                          );
                        }}
                        className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs transition-colors ${
                          isSelected ? "bg-primary/5 hover:bg-primary/10" : "hover:bg-bg-hover"
                        }`}
                      >
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span
                            className={`flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                              isSelected
                                ? "bg-primary text-white"
                                : "border border-border bg-bg-ctrl text-text-muted"
                            }`}
                          >
                            {personInitials(person.name)}
                          </span>
                          <span
                            className={`truncate font-medium ${
                              isSelected ? "font-semibold text-primary" : "text-text"
                            }`}
                          >
                            {person.name}
                          </span>
                        </div>
                        {isSelected ? (
                          <span className="flex shrink-0 items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
                            <Check className="size-3" /> Terpilih
                          </span>
                        ) : (
                          <span className="shrink-0 text-[11px] text-text-muted opacity-60 hover:opacity-100">
                            + Pilih
                          </span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* Schedule Section */}
            <div className="space-y-2 rounded-xl border border-border bg-bg-ctrl/10 p-3.5">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Tanggal Mulai">
                  <input
                    name="start"
                    type="date"
                    required
                    value={start}
                    onChange={(e) => {
                      const newStart = e.target.value;
                      setStart(newStart);
                      if (end < newStart) setEnd(newStart);
                    }}
                    className="field-input text-xs"
                  />
                </Field>
                <Field label="Tanggal Selesai">
                  <input
                    name="end"
                    type="date"
                    required
                    min={start}
                    value={end}
                    onChange={(e) => setEnd(e.target.value)}
                    className="field-input text-xs"
                  />
                </Field>
              </div>

              {durationDays !== null && (
                <div className="flex items-center gap-2 px-1 text-xs">
                  <Calendar className="size-3.5 text-primary" />
                  {durationDays > 0 ? (
                    <span className="text-text-muted">
                      Durasi pekerjaan:{" "}
                      <strong className="font-semibold text-text">{durationDays} hari kalender</strong>
                    </span>
                  ) : (
                    <span className="font-medium text-red-500">
                      Tanggal selesai harus sama atau setelah tanggal mulai
                    </span>
                  )}
                </div>
              )}
            </div>

            <Field label="Jenis lampiran">
              <select name="attachment_kind" className="field-input text-xs">
                {documentKinds.map((kind) => (
                  <option key={kind}>{kind}</option>
                ))}
              </select>
            </Field>

            {/* Multi-file Upload Section */}
            <div className="space-y-2 rounded-xl border border-border bg-bg-ctrl/10 p-3.5">
              <label className="block text-xs font-semibold text-text">
                {existing ? "Tambahkan lampiran baru (opsional)" : "Lampiran pekerjaan (opsional)"}
              </label>

              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  if (e.dataTransfer.files) appendFiles(Array.from(e.dataTransfer.files));
                }}
                className={`relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-4 text-center transition-colors ${
                  isDragging
                    ? "border-primary bg-primary/5"
                    : "border-border bg-bg hover:border-primary/40"
                }`}
              >
                <UploadCloud className="mb-1.5 size-7 text-text-muted" />
                <p className="text-xs font-medium text-text">
                  Tarik berkas ke sini, atau{" "}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="font-semibold text-primary hover:underline"
                  >
                    pilih berkas
                  </button>
                </p>
                <p className="mt-1 text-[11px] text-text-muted">
                  Bisa pilih beberapa gambar, foto lapangan, PDF, atau dokumen pendukung.
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="sr-only"
                  onChange={(e) => {
                    if (e.target.files) appendFiles(Array.from(e.target.files));
                    e.target.value = "";
                  }}
                />
              </div>

              {/* Uploaded Files List */}
              {files.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between px-1 text-xs text-text-muted">
                    <span>{files.length} berkas dipilih</span>
                    <button
                      type="button"
                      onClick={() => setFiles([])}
                      className="text-[11px] text-red-600 hover:underline"
                    >
                      Hapus semua
                    </button>
                  </div>
                  <ul className="max-h-40 overflow-y-auto divide-y divide-border-soft rounded-lg border border-border bg-bg p-1">
                    {files.map((file, idx) => (
                      <li
                        key={`${file.name}-${file.size}-${idx}`}
                        className="flex items-center justify-between gap-2 rounded-md p-1.5 text-xs hover:bg-bg-hover"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          {getFileIcon(file.name, "size-4 shrink-0 text-primary")}
                          <span className="truncate font-medium text-text" title={file.name}>
                            {file.name}
                          </span>
                          <span className="shrink-0 text-[10px] text-text-muted">
                            {formatFileSize(file.size)}
                          </span>
                        </div>
                        <button
                          type="button"
                          aria-label={`Hapus file ${file.name}`}
                          onClick={() => setFiles((prev) => prev.filter((_, i) => i !== idx))}
                          className="btn btn-ghost btn-icon btn-xs text-text-muted hover:text-red-600"
                        >
                          <X className="size-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </ActionForm>
        </div>
      </section>
    </div>
  );
}
