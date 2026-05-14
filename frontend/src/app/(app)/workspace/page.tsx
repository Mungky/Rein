"use client";

import { useEffect } from "react";
import { FolderKanban, Plus } from "lucide-react";
import { PageGuard } from "@/components/guards/page-guard";
import { useAuthDisplay } from "@/hooks/use-auth";
import { useCan } from "@/components/providers/permissions-provider";
import type { AppRole } from "@/lib/utils/roles";
import { useWorkspaceStore } from "@/features/workspace/store";
import { ViewToggle } from "@/features/workspace/shared/view-toggle";
import { ProjectListView } from "@/features/workspace/shared/project-list";
import { ProjectDetail } from "@/features/workspace/shared/project-list";
import { CreateProjectModal } from "@/features/workspace/shared/create-project-modal";
import { GanttView } from "@/features/workspace/gantt/gantt-view";
import { GanttDetail } from "@/features/workspace/gantt/gantt-detail";
import { KanbanView } from "@/features/workspace/kanban/kanban-view";

export default function WorkspacePage() {
  const { role } = useAuthDisplay();
  const canManage = useCan(role as AppRole, "workspace:manage");
  const canComplete = useCan(role as AppRole, "workspace:complete_task");
  const store = useWorkspaceStore();
  const selectedProject = store.projects.find((p) => p.id === store.selectedProjectId);

  useEffect(() => {
    store.loadProjects();
    if (canManage) store.loadTemplates();
  }, [canManage]);

  // Detail view when a project is selected
  if (selectedProject) {
    return (
      <PageGuard permission="workspace:view">
        <div className="flex flex-col h-full overflow-hidden">
          {store.view === "list" && (
            <ProjectDetail
              project={selectedProject}
              canComplete={canComplete}
              onBack={() => { store.selectProject(null); store.loadProjects(); }}
            />
          )}
          {store.view === "gantt" && (
            <GanttDetail
              project={selectedProject}
              onBack={() => { store.selectProject(null); store.loadProjects(); }}
            />
          )}
          {store.view === "kanban" && (
            <ProjectDetail
              project={selectedProject}
              canComplete={canComplete}
              onBack={() => { store.selectProject(null); store.loadProjects(); }}
            />
          )}
        </div>
      </PageGuard>
    );
  }

  return (
    <PageGuard permission="workspace:view">
      <div className="flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 px-5 h-[46px] min-h-[46px] border-b border-border bg-bg shrink-0">
          <FolderKanban className="w-4 h-4 text-text-muted" />
          <span className="text-[15px] font-bold text-text">Workspace</span>
          <ViewToggle value={store.view} onChange={store.setView} />
          <div className="flex-1" />
          {canManage && (
            <button onClick={() => store.setShowCreate(true)} className="btn btn-primary btn-sm gap-1.5">
              <Plus className="w-3 h-3" /> Proyek Baru
            </button>
          )}
        </div>

        {/* View area */}
        <div className="flex-1 overflow-hidden">
          {store.view === "list" && <ProjectListView canManage={canManage} canComplete={canComplete} />}
          {store.view === "gantt" && <GanttView canManage={canManage} />}
          {store.view === "kanban" && <KanbanView canManage={canManage} canComplete={canComplete} />}
        </div>
      </div>

      {store.showCreate && (
        <CreateProjectModal
          templates={store.templates}
          onClose={() => store.setShowCreate(false)}
          onCreated={() => { store.setShowCreate(false); store.loadProjects(); }}
        />
      )}
    </PageGuard>
  );
}