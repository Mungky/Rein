"use client";

import { ChevronDown, ChevronRight, Folder, FolderOpen } from "lucide-react";
import { useState } from "react";
import type { FolderNode } from "./types";

interface FolderTreeProps {
  tree: FolderNode[];
  selectedId: string | null;
  onSelect: (folder: FolderNode) => void;
}

const DEPT_COLORS: Record<string, string> = {
  finance: "text-green",
  engineering: "text-blue",
  hr: "text-amber",
  purchasing: "text-amber",
  management: "text-primary",
};

export function FolderTree({ tree, selectedId, onSelect }: FolderTreeProps) {
  return (
    <nav className="flex flex-col gap-0.5 py-1">
      {tree.map((node) => (
        <FolderItem
          key={node.id}
          node={node}
          selectedId={selectedId}
          onSelect={onSelect}
          depth={0}
        />
      ))}
    </nav>
  );
}

function FolderItem({
  node,
  selectedId,
  onSelect,
  depth,
}: {
  node: FolderNode;
  selectedId: string | null;
  onSelect: (folder: FolderNode) => void;
  depth: number;
}) {
  const [open, setOpen] = useState(depth === 0);
  const hasChildren = node.children.length > 0;
  const isSelected = selectedId === node.id;
  const deptColor = DEPT_COLORS[node.department] ?? "text-text-muted";
  const isDept = node.folder_type === "department";

  return (
    <div>
      <button
        className={`w-full flex items-center gap-1.5 px-2 py-[5px] rounded text-left transition-colors duration-100
          ${isSelected ? "bg-primary-bg text-primary" : "hover:bg-bg-hover text-text"}
          ${isDept ? "font-semibold" : "font-normal"}`}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={() => {
          onSelect(node);
          if (hasChildren) setOpen((o) => !o);
        }}
      >
        {hasChildren ? (
          open ? (
            <ChevronDown className={`w-3 h-3 shrink-0 ${isSelected ? "text-primary" : "text-text-light"}`} />
          ) : (
            <ChevronRight className={`w-3 h-3 shrink-0 ${isSelected ? "text-primary" : "text-text-light"}`} />
          )
        ) : (
          <span className="w-3 shrink-0" />
        )}
        {isSelected || open ? (
          <FolderOpen className={`w-3.5 h-3.5 shrink-0 ${isDept ? deptColor : "text-text-muted"}`} />
        ) : (
          <Folder className={`w-3.5 h-3.5 shrink-0 ${isDept ? deptColor : "text-text-muted"}`} />
        )}
        <span className="flex-1 text-[12.5px] truncate min-w-0">{node.name}</span>
        {node.file_count > 0 && (
          <span className="text-[10px] text-text-light shrink-0 tabular-nums">
            {node.file_count}
          </span>
        )}
      </button>

      {open && hasChildren && (
        <div>
          {node.children.map((child) => (
            <FolderItem
              key={child.id}
              node={child}
              selectedId={selectedId}
              onSelect={onSelect}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}
