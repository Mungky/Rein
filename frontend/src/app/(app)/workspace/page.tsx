"use client";

import { useEffect } from "react";
import { FolderKanban, Plus } from "lucide-react";
import { PageGuard } from "@/components/guards/page-guard";
import { LockedFeature } from "@/components/guards/locked-feature";
import { isLocked } from "@/lib/feature-flags";
import { useAuth, useAuthDisplay } from "@/hooks/use-auth";
import { useCan } from "@/components/providers/permissions-provider";
import type { AppRole } from "@/lib/utils/roles";
import { useWorkspaceStore } from "@/features/workspace/store";
import { ViewToggle } from "@/features/workspace/shared/view-toggle";
import { ProjectListView } from "@/features/workspace/shared/project-list";
import { ProjectDetail } from "@/features/workspace/shared/project-list";
import { CreateProjectModal } from "@/features/workspace/shared/create-project-modal";
import { KanbanView } from "@/features/workspace/kanban/kanban-view";
import { CalendarView } from "@/features/workspace/calendar/calendar-view";

export default function WorkspacePage() {
  if (isLocked("workspace")) return <LockedFeature title="Workspace" />;
  return <WorkspaceInner />;
}

function WorkspaceInner() {
  const { role } = useAuthDisplay();
  const canManage = useCan(role as AppRole, "workspace:manage");
  const canComplete = useCan(role as AppRole, "workspace:complete_task");
  const store = useWorkspaceStore();
  const selectedProject = store.projects.find((p) => p.id === store.selectedProjectId);

  // Wait for auth to be ready before making API calls
  const { profile, loading: authLoading } = useAuth();

  useEffect(() => {
    if (authLoading || !profile) return;
    store.loadProjects();
    if (canManage) store.loadTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, !!profile, canManage]);

  // Detail view when a project is selected
  if (selectedProject) {
    return (
      <PageGuard permission="workspace:view">
        <div className="flex flex-col h-full overflow-hidden">
          {(store.view === "list" || store.view === "kanban") && (
            <ProjectDetail
              project={selectedProject}
              onBack={() => { store.selectProject(null); store.loadProjects(); }}
            />
          )}
          {store.view === "calendar" && (
            <CalendarView
              project={selectedProject}
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
        <div className="flex items-center gap-3 px-5 h-[52px] min-h-[52px] border-b border-border-soft bg-bg shrink-0">
          <FolderKanban className="size-4 text-primary" />
          <span className="text-[14px] font-bold text-text">Workspace</span>
          <ViewToggle value={store.view} onChange={store.setView} />
          <div className="flex-1" />
          {canManage && (
            <button onClick={() => store.setShowCreate(true)} className="btn btn-primary btn-sm gap-1.5">
              <Plus className="size-3.5" /> Proyek Baru
            </button>
          )}
        </div>

        {/* View area */}
        <div className="flex-1 overflow-hidden">
          {store.view === "list" && <ProjectListView canManage={canManage} />}
          {store.view === "kanban" && <KanbanView canManage={canManage} canComplete={canComplete} />}
          {store.view === "calendar" && <CalendarView onBack={() => {}} />}
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
