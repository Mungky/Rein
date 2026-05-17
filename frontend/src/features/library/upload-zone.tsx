"use client";

import { Upload } from "lucide-react";
import { useCallback, useRef, useState } from "react";

const ALLOWED_EXTENSIONS = new Set([".docx", ".xlsx", ".pptx", ".pdf", ".zip", ".rar", ".dwg", ".step", ".stp"]);
const MAX_SIZE = 50 * 1024 * 1024;

interface UploadZoneProps {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  compact?: boolean;
}

function validate(file: File): string | null {
  const ext = "." + file.name.split(".").pop()!.toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) return `Format ${ext} tidak didukung`;
  if (file.size > MAX_SIZE) return `File terlalu besar (maks 50 MB)`;
  if (file.size === 0) return "File kosong";
  return null;
}

export function UploadZone({ onFiles, disabled, compact }: UploadZoneProps) {
  const [dragOver, setDragOver] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const handle = useCallback((raw: FileList | File[]) => {
    const all = Array.from(raw);
    const valid: File[] = [];
    const errors: string[] = [];
    for (const f of all) {
      const err = validate(f);
      if (err) errors.push(`${f.name}: ${err}`);
      else valid.push(f);
    }
    setValidationErrors(errors);
    if (valid.length > 0) onFiles(valid);
  }, [onFiles]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) handle(e.dataTransfer.files);
  }, [handle]);

  const onInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) handle(e.target.files);
    e.target.value = "";
  }, [handle]);

  if (compact) {
    return (
      <div className="relative">
        <button
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className="btn btn-primary btn-sm gap-1.5"
        >
          <Upload className="w-3.5 h-3.5" />
          Upload
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          accept=".docx,.xlsx,.pptx,.pdf,.zip,.rar,.dwg,.step,.stp"
          onChange={onInput}
        />
      </div>
    );
  }

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => !disabled && inputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl px-6 py-8 flex flex-col items-center gap-2.5 cursor-pointer transition-all duration-140
          ${dragOver ? "border-primary bg-primary-bg" : "border-border hover:border-border-strong hover:bg-bg-hover"}
          ${disabled ? "opacity-50 pointer-events-none" : ""}`}
      >
        <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${dragOver ? "bg-primary text-white" : "bg-bg-ctrl text-text-muted"}`}>
          <Upload className="w-5 h-5" />
        </div>
        <div className="text-center">
          <p className="text-[13px] font-semibold text-text">
            {dragOver ? "Lepas file di sini" : "Seret & lepas file, atau klik untuk pilih"}
          </p>
          <p className="text-[11px] text-text-muted mt-0.5">
            PDF, Word, Excel, PowerPoint, ZIP, RAR, DWG, STEP — maks 50 MB · bisa pilih banyak sekaligus
          </p>
        </div>
      </div>
      {validationErrors.length > 0 && (
        <div className="mt-2 px-1 space-y-0.5">
          {validationErrors.map((e, i) => (
            <p key={i} className="text-[11.5px] text-red">{e}</p>
          ))}
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        accept=".docx,.xlsx,.pptx,.pdf,.zip,.rar,.dwg,.step,.stp"
        onChange={onInput}
      />
    </div>
  );
}
