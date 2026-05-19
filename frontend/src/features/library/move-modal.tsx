"use client";

import { FolderInput, FolderOpen } from "lucide-react";
import { useState } from "react";
import type { FolderNode } from "./types";

interface MoveModalProps {
  tree: FolderNode[];
  currentFolderId: string | null;
  onClose: () => void;
  onMove: (folderId: string) => void;
  title: string;
  subtitle?: string;
  submitLabel?: string;
}

export function MoveModal({
  tree, currentFolderId, onClose, onMove, title, subtitle, submitLabel = "Pindahkan",
}: MoveModalProps) {
  const [target, setTarget] = useState<string | null>(null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-bg border border-border rounded-xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden" style={{ maxHeight: "80vh" }}>
        <div className="px-4 py-3 border-b border-border bg-bg-ctrl">
          <div className="text-[13px] font-semibold truncate">{title}</div>
          {subtitle && <div className="text-[11px] text-text-muted truncate">{subtitle}</div>}
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          <FolderPicker
            tree={tree}
            depth={0}
            currentFolderId={currentFolderId}
            target={target}
            onSelect={setTarget}
          />
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
          <button onClick={onClose} className="btn btn-default">Batal</button>
          <button
            onClick={() => target && onMove(target)}
            disabled={!target}
            className="btn btn-primary gap-1.5"
          >
            <FolderInput className="w-3.5 h-3.5" />
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function FolderPicker({
  tree, depth, currentFolderId, target, onSelect,
}: {
  tree: FolderNode[];
  depth: number;
  currentFolderId: string | null;
  target: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <>
      {tree.map((node) => (
        <div key={node.id}>
          <button
            type="button"
            disabled={node.id === currentFolderId}
            onClick={() => onSelect(node.id)}
            className={`w-full flex items-center gap-1.5 py-1.5 rounded text-left text-[12px]
              ${target === node.id ? "bg-primary-bg text-primary font-semibold" : "hover:bg-bg-hover text-text"}
              ${node.id === currentFolderId ? "opacity-40 cursor-not-allowed" : ""}`}
            style={{ paddingLeft: `${8 + depth * 16}px`, paddingRight: 8 }}
          >
            <FolderOpen className="w-3.5 h-3.5 text-primary shrink-0" />
            <span className="flex-1 truncate">{node.name}</span>
            {node.file_count > 0 && (
              <span className="text-[10px] text-text-light tabular-nums">{node.file_count}</span>
            )}
          </button>
          {node.children.length > 0 && (
            <FolderPicker
              tree={node.children}
              depth={depth + 1}
              currentFolderId={currentFolderId}
              target={target}
              onSelect={onSelect}
            />
          )}
        </div>
      ))}
    </>
  );
}
