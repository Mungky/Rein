import { notFound } from "next/navigation";
import { ProjectPreviewApp } from "@/features/workspace/project-preview-app";

export default function ProjectPreviewPage() {
  if (process.env.NODE_ENV !== "development" || process.env.WORKSPACE_LOCAL_PREVIEW !== "1") notFound();
  return <ProjectPreviewApp />;
}
