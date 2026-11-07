"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Calendar,
  Check,
  CheckSquare,
  Clock,
  File,
  FileImage,
  FileSpreadsheet,
  FileText,
  Info,
  Layers,
  Loader2,
  Paperclip,
  Search,
  UploadCloud,
  Users,
  Wrench,
  X,
} from "lucide-react";
import type { workspaceApi, Task } from "@/lib/api/workspace";
import type { WorkOrderDetail, WorkOrderInput } from "@/lib/api/workspace-logbook";
import { apiErrorText } from "@/lib/api/client";
import { documentKinds, formatFileSize } from "./work-order-ui";
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

const DEPARTMENTS = [
  "Workshop Fabrikasi",
  "Machining & Bubut",
  "Pengelasan & Assembly",
  "Quality Control (QC / NDT)",
  "Engineering & Desain",
  "Pengecatan & Blasting",
  "Logistik & Gudang",
  "Site Installation",
  "Maintenance & Sipil",
];

const WORK_PHASES = [
  "Persiapan & Material",
  "Pemotongan & Machining",
  "Fit-up & Assembly",
  "Pengelasan (Welding)",
  "Inspeksi QC & Testing",
  "Surface Preparation & Painting",
  "Pengepakan & Pengiriman",
  "Instalasi Lapangan",
];

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
  const [submitting, setSubmitting] = useState(false);

  // Form states
  const [name, setName] = useState(existing?.task.name ?? "");
  const [description, setDescription] = useState(() => {
    // Strip prasyarat text if it was previously appended
    const raw = existing?.task.description ?? "";
    const splitIndex = raw.indexOf("\n\n--- Prasyarat Kerja ---");
    return splitIndex !== -1 ? raw.slice(0, splitIndex).trim() : raw;
  });
  const [department, setDepartment] = useState(DEPARTMENTS[0]);
  const [workPhase, setWorkPhase] = useState(WORK_PHASES[0]);
  const [start, setStart] = useState(existing?.start_date ?? todayLocal());
  const [end, setEnd] = useState(existing?.end_date ?? existing?.start_date ?? todayLocal());
  const [estimatedHours, setEstimatedHours] = useState<string>("");

  // PIC selector states
  const [picSearch, setPicSearch] = useState("");
  const [selectedPicIds, setSelectedPicIds] = useState<string[]>(() => {
    if (existing?.assignees?.length) return existing.assignees.map((a) => a.id);
    if (existing?.task.assigned_to) return [existing.task.assigned_to];
    return [];
  });

  // Files
  const [attachmentKind, setAttachmentKind] = useState<string>(documentKinds[0]);
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    api
      .workOrderPeople(projectId)
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Nama pekerjaan wajib diisi");
      return;
    }
    if (!start || !end) {
      setError("Tanggal mulai dan selesai wajib diisi");
      return;
    }
    if (end < start) {
      setError("Tanggal selesai tidak boleh sebelum tanggal mulai");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      let finalDescription = description.trim();
      if (workPhase) {
        finalDescription = `[Tahap: ${workPhase}]\n${finalDescription}`;
      }
      if (estimatedHours) {
        finalDescription = `${finalDescription}\nEstimasi Jam: ${estimatedHours} jam`;
      }

      const body: WorkOrderInput = {
        request_id: crypto.randomUUID(),
        name: name.trim(),
        description: finalDescription,
        archive_department: department,
        pic_ids: selectedPicIds,
        attachment_kind: attachmentKind,
        start_date: start,
        end_date: end,
        ...(existing ? { expected_updated_at: existing.task.updated_at } : {}),
      };

      const task = existing
        ? await api.editWorkOrder(existing.task.id, body, files)
        : await api.createWorkOrder(projectId, body, files);

      onSaved(task);
    } catch (err) {
      setError(apiErrorText(err, "Gagal menyimpan Work Order"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[110] flex flex-col bg-bg text-text overflow-hidden select-text animate-[fadeIn_150ms_ease]">
      {/* Topbar / Navigation Header */}
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-bg/95 px-4 py-3.5 sm:px-6 lg:px-8 backdrop-blur z-20">
        <div className="flex items-center gap-3.5 min-w-0">
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost btn-icon size-9 rounded-xl border border-border/70 hover:bg-bg-hover"
            aria-label="Kembali"
          >
            <ArrowLeft className="size-4.5" />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-base sm:text-lg font-bold text-text truncate">
                {existing ? "Ubah Work Order" : "Buat Work Order Baru"}
              </h1>
              {existing?.task.wo_number && (
                <span className="rounded-md bg-primary/10 px-2 py-0.5 font-mono text-xs font-semibold text-primary">
                  WO #{existing.task.wo_number}
                </span>
              )}
              {(existing?.rpo_number || projectName) && (
                <span className="text-xs sm:text-sm font-medium text-text-muted truncate">
                  · {existing?.rpo_number ?? projectName}
                </span>
              )}
            </div>
            <p className="text-xs text-text-muted mt-0.5 truncate hidden sm:block">
              {existing
                ? `Memperbarui rincian pekerjaan: ${existing.task.name}`
                : "Lengkapi identitas pekerjaan, tim penanggung jawab, dan jadwal pelaksanaan."}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="btn btn-default btn-md px-4 text-xs sm:text-sm font-medium"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={(e) => void handleSubmit(e)}
            disabled={submitting || !name.trim()}
            className="btn btn-primary btn-md gap-2 px-5 text-xs sm:text-sm font-semibold shadow-sm"
          >
            {submitting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Check className="size-4" />
            )}
            <span>{existing ? "Simpan Perubahan" : "Buat Work Order"}</span>
          </button>
        </div>
      </header>

      {/* Main Form Body */}
      <main className="flex-1 overflow-y-auto bg-bg-ctrl/25 px-4 py-6 sm:px-6 lg:px-10">
        <form
          id="work-order-form"
          onSubmit={(e) => void handleSubmit(e)}
          className="mx-auto max-w-5xl space-y-6 pb-20"
        >
          {/* Error Banner */}
          {error && (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-600 dark:text-red-400"
            >
              <Info className="mt-0.5 size-5 shrink-0" />
              <div className="flex-1 font-medium">{error}</div>
              <button
                type="button"
                onClick={() => setError("")}
                className="text-xs font-semibold underline hover:no-underline"
              >
                Tutup
              </button>
            </div>
          )}

          {/* Section A: Informasi Utama Pekerjaan */}
          <section className="rounded-2xl border border-border bg-bg p-5 sm:p-7 shadow-xs space-y-5">
            <div className="flex items-start justify-between border-b border-border-soft pb-4">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <FileText className="size-5" />
                </div>
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-text">
                    Informasi Utama Pekerjaan
                  </h2>
                  <p className="text-xs sm:text-sm text-text-muted">
                    Nama pekerjaan, nomor referensi, tahapan, dan deskripsi teknis lingkup kerja
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
              <div className="md:col-span-2 space-y-1.5">
                <label className="block text-sm font-semibold text-text">
                  Nama Pekerjaan / Work Order <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  maxLength={255}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Contoh: Fabrikasi Shell Reactor & Pengelasan Nozzle N1-N4"
                  className="field-input h-[42px] text-sm sm:text-base px-3.5"
                />
                <p className="text-xs text-text-muted">
                  Gunakan nama yang spesifik dan jelas bagi personil lapangan.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="block text-sm font-semibold text-text">
                  Nomor Referensi WO
                </label>
                <div className="flex h-[42px] items-center rounded-xl border border-border bg-bg-ctrl/40 px-3.5 text-sm font-mono text-text">
                  {existing?.task.wo_number
                    ? `WO #${existing.task.wo_number}`
                    : "Auto-generated oleh sistem"}
                </div>
                <p className="text-xs text-text-muted">
                  Nomor WO berurutan per proyek otomatis.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="block text-sm font-semibold text-text">
                  Tahap / Fase Pekerjaan
                </label>
                <div className="relative">
                  <Layers className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
                  <select
                    value={workPhase}
                    onChange={(e) => setWorkPhase(e.target.value)}
                    className="field-input h-[42px] pl-10 pr-8 text-sm"
                  >
                    {WORK_PHASES.map((phase) => (
                      <option key={phase} value={phase}>
                        {phase}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="text-xs text-text-muted">
                  Kategori proses produksi yang sedang berjalan.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="block text-sm font-semibold text-text">
                  Departemen / Divisi Pelaksana
                </label>
                <select
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  className="field-input h-[42px] px-3.5 pr-8 text-sm"
                >
                  {DEPARTMENTS.map((dept) => (
                    <option key={dept} value={dept}>
                      {dept}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-text-muted">
                  Divisi yang bertanggung jawab langsung atas hasil fisik.
                </p>
              </div>
            </div>

            <div className="space-y-1.5 pt-1">
              <label className="block text-sm font-semibold text-text">
                Deskripsi Lengkap & Spesifikasi Pekerjaan <span className="text-red-500">*</span>
              </label>
              <textarea
                required
                rows={5}
                maxLength={10000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Jelaskan secara rinci: spesifikasi teknis bahan, standar toleransi, prosedur pengerjaan, titik kritis inspeksi, dan kriteria hasil kerja yang dapat diterima..."
                className="field-input h-auto min-h-[120px] resize-y py-3 px-3.5 text-sm sm:text-[15px] leading-relaxed"
              />
              <p className="text-xs text-text-muted">
                Penjelasan ini akan menjadi acuan teknisi dan QA dalam inspeksi harian.
              </p>
            </div>
          </section>

          {/* Section B: Penanggung Jawab & Tim */}
          <section className="rounded-2xl border border-border bg-bg p-5 sm:p-7 shadow-xs space-y-5">
            <div className="flex items-start justify-between border-b border-border-soft pb-4">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Users className="size-5" />
                </div>
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-text">
                    Penanggung Jawab & Tim Pelaksana
                  </h2>
                  <p className="text-xs sm:text-sm text-text-muted">
                    Pilih PIC utama dan teknisi/personil tambahan yang bertugas mengisi logbook
                  </p>
                </div>
              </div>
              {selectedPicIds.length > 0 && (
                <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
                  {selectedPicIds.length} personil ditugaskan
                </span>
              )}
            </div>

            {/* Selected PIC Badges */}
            {selectedPeople.length > 0 ? (
              <div className="space-y-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Personil Terpilih:
                </span>
                <div className="flex flex-wrap gap-2 rounded-xl border border-border-soft bg-bg-ctrl/20 p-3">
                  {selectedPeople.map((person) => (
                    <span
                      key={person.id}
                      className="inline-flex items-center gap-2 rounded-xl border border-primary/25 bg-bg py-1.5 pl-2 pr-3 text-xs sm:text-sm font-medium text-text shadow-2xs"
                    >
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-primary text-[11px] font-bold text-white">
                        {personInitials(person.name)}
                      </span>
                      <span className="truncate max-w-[200px]">{person.name}</span>
                      <button
                        type="button"
                        aria-label={`Hapus PIC ${person.name}`}
                        onClick={() =>
                          setSelectedPicIds((prev) => prev.filter((id) => id !== person.id))
                        }
                        className="rounded-md p-1 text-text-muted hover:bg-red-500/10 hover:text-red-600 transition-colors"
                      >
                        <X className="size-3.5" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-border bg-bg-ctrl/20 p-4 text-center">
                <p className="text-sm font-medium text-text-muted">
                  Belum ada PIC yang dipilih. Silakan cari dan pilih personil di bawah ini.
                </p>
              </div>
            )}

            {/* Search Box */}
            <div className="space-y-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
                <input
                  type="text"
                  value={picSearch}
                  onChange={(e) => setPicSearch(e.target.value)}
                  placeholder="Ketik nama personil, teknisi, atau engineer..."
                  className="field-input h-[42px] pl-10 pr-9 text-sm"
                />
                {picSearch && (
                  <button
                    type="button"
                    aria-label="Bersihkan pencarian"
                    onClick={() => setPicSearch("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text"
                  >
                    <X className="size-4" />
                  </button>
                )}
              </div>

              {/* People Selection Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 max-h-56 overflow-y-auto p-1 rounded-xl border border-border bg-bg-ctrl/15">
                {filteredPeople.length === 0 ? (
                  <div className="col-span-full py-6 text-center text-xs text-text-muted">
                    {people.length === 0 ? "Memuat personil proyek…" : "Personil tidak ditemukan."}
                  </div>
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
                        className={`flex items-center justify-between gap-2.5 rounded-xl border px-3 py-2 text-left transition-all ${
                          isSelected
                            ? "border-primary bg-primary/10 shadow-2xs"
                            : "border-border bg-bg hover:border-primary/40 hover:bg-bg-hover"
                        }`}
                      >
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span
                            className={`flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${
                              isSelected
                                ? "bg-primary text-white"
                                : "bg-bg-ctrl text-text-muted"
                            }`}
                          >
                            {personInitials(person.name)}
                          </span>
                          <span
                            className={`truncate text-xs sm:text-sm ${
                              isSelected ? "font-bold text-primary" : "font-medium text-text"
                            }`}
                          >
                            {person.name}
                          </span>
                        </div>
                        {isSelected ? (
                          <Check className="size-4 shrink-0 text-primary" />
                        ) : (
                          <span className="text-[11px] font-semibold text-text-muted opacity-60">
                            + Pilih
                          </span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </section>

          {/* Section C: Target Waktu & Jadwal */}
          <section className="rounded-2xl border border-border bg-bg p-5 sm:p-7 shadow-xs space-y-5">
            <div className="flex items-start justify-between border-b border-border-soft pb-4">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Calendar className="size-5" />
                </div>
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-text">
                    Target Waktu & Jadwal
                  </h2>
                  <p className="text-xs sm:text-sm text-text-muted">
                    Atur jadwal mulai, target selesai, dan estimasi beban jam kerja
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
              <div className="space-y-1.5">
                <label className="block text-sm font-semibold text-text">
                  Tanggal Mulai <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  required
                  value={start}
                  onChange={(e) => {
                    const newStart = e.target.value;
                    setStart(newStart);
                    if (end < newStart) setEnd(newStart);
                  }}
                  className="field-input h-[42px] text-sm px-3.5"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-sm font-semibold text-text">
                  Target Selesai (Deadline) <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  required
                  min={start}
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                  className="field-input h-[42px] text-sm px-3.5"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-sm font-semibold text-text">
                  Estimasi Total Jam Kerja
                </label>
                <div className="relative">
                  <Clock className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
                  <input
                    type="number"
                    min={0}
                    max={1000}
                    step={1}
                    value={estimatedHours}
                    onChange={(e) => setEstimatedHours(e.target.value)}
                    placeholder="Contoh: 40"
                    className="field-input h-[42px] pl-10 pr-4 text-sm"
                  />
                </div>
              </div>
            </div>

            {durationDays !== null && (
              <div
                className={`flex items-center gap-3 rounded-xl border p-4 text-sm ${
                  durationDays > 0
                    ? "border-primary/20 bg-primary/5 text-text"
                    : "border-red-500/20 bg-red-500/5 text-red-600"
                }`}
              >
                <Calendar className="size-5 shrink-0 text-primary" />
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span>Durasi Pelaksanaan:</span>
                  <strong className="font-bold text-primary">
                    {durationDays} Hari Kalender
                  </strong>
                  {estimatedHours && (
                    <span className="text-text-muted">
                      · Alokasi ~{(Number(estimatedHours) / Math.max(1, durationDays)).toFixed(1)} jam/hari
                    </span>
                  )}
                </div>
              </div>
            )}
          </section>


          {/* Section E: Lampiran & Dokumen Pendukung */}
          <section className="rounded-2xl border border-border bg-bg p-5 sm:p-7 shadow-xs space-y-5">
            <div className="flex items-start justify-between border-b border-border-soft pb-4">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <UploadCloud className="size-5" />
                </div>
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-text">
                    Lampiran & Dokumen Pendukung
                  </h2>
                  <p className="text-xs sm:text-sm text-text-muted">
                    Unggah gambar teknik (PDF/DWG), bill of materials, SOP, atau foto referensi
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-semibold text-text">
                Kategori Berkas Lampiran
              </label>
              <select
                value={attachmentKind}
                onChange={(e) => setAttachmentKind(e.target.value)}
                className="field-input h-[42px] px-3.5 pr-8 text-sm max-w-sm"
              >
                {documentKinds.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </select>
            </div>

            {/* Drag & Drop Area */}
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
              className={`relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 text-center transition-all ${
                isDragging
                  ? "border-primary bg-primary/10 scale-[1.005]"
                  : "border-border bg-bg-ctrl/20 hover:border-primary/50 hover:bg-bg-ctrl/30"
              }`}
            >
              <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary mb-3">
                <UploadCloud className="size-7" />
              </div>
              <p className="text-sm sm:text-base font-semibold text-text">
                Tarik & letakkan berkas ke sini, atau{" "}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="font-bold text-primary hover:underline"
                >
                  pilih dari komputer
                </button>
              </p>
              <p className="mt-1 text-xs text-text-muted max-w-md">
                Mendukung berbagai format (PDF, DWG, DXF, XLSX, DOCX, JPG, PNG) hingga 25 MB per berkas.
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

            {/* Uploaded Files Cards Grid */}
            {files.length > 0 && (
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between text-xs sm:text-sm font-semibold text-text">
                  <span>{files.length} berkas siap diunggah:</span>
                  <button
                    type="button"
                    onClick={() => setFiles([])}
                    className="text-xs text-red-600 hover:underline"
                  >
                    Hapus semua berkas
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {files.map((file, idx) => (
                    <div
                      key={`${file.name}-${file.size}-${idx}`}
                      className="flex items-center justify-between gap-3 rounded-xl border border-border bg-bg p-3 shadow-2xs hover:border-primary/30 transition-all"
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-bg-ctrl/60">
                          {getFileIcon(file.name, "size-5 text-primary")}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-xs sm:text-sm font-semibold text-text" title={file.name}>
                            {file.name}
                          </p>
                          <p className="text-[11px] text-text-muted">
                            {formatFileSize(file.size)}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        aria-label={`Hapus file ${file.name}`}
                        onClick={() => setFiles((prev) => prev.filter((_, i) => i !== idx))}
                        className="btn btn-ghost btn-icon btn-xs text-text-muted hover:text-red-600"
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Existing Attachments when Editing */}
            {existing && existing.attachments.length > 0 && (
              <div className="space-y-3 pt-4 border-t border-border-soft">
                <p className="text-xs sm:text-sm font-semibold text-text">
                  Lampiran yang sudah ada pada WO ini:
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {existing.attachments.map((file) => (
                    <div
                      key={file.id}
                      className="flex items-center gap-3 rounded-xl border border-border bg-bg-ctrl/20 p-3"
                    >
                      <Paperclip className="size-4 shrink-0 text-primary" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-text" title={file.name}>
                          {file.name}
                        </p>
                        <p className="text-[10px] text-text-muted">
                          {file.kind ?? "Lampiran"} · {Math.max(1, Math.round(file.bytes / 1024))} KB
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* Bottom Action Footer inside Scroll */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 rounded-2xl border border-border bg-bg p-5 shadow-xs">
            <div className="flex items-center gap-2.5 text-xs sm:text-sm text-text-muted">
              <CheckSquare className="size-4 text-emerald-500 shrink-0" />
              <span>
                Pastikan seluruh data pekerjaan telah diverifikasi sebelum menyimpan.
              </span>
            </div>
            <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="btn btn-default btn-md px-5 text-sm font-medium w-full sm:w-auto"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={submitting || !name.trim()}
                className="btn btn-primary btn-md gap-2 px-6 text-sm font-semibold w-full sm:w-auto"
              >
                {submitting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Check className="size-4" />
                )}
                <span>{existing ? "Simpan Perubahan" : "Buat Work Order"}</span>
              </button>
            </div>
          </div>
        </form>
      </main>
    </div>
  );
}
