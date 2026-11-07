"use client";
import { useState } from "react";
import { Plus } from "lucide-react";
import type { workspaceApi } from "@/lib/api/workspace";
import { WorkOrderForm } from "./work-order-form";

export function ProjectTaskCreator({api,projectId,onCreated,onOpenCreate}: {api:typeof workspaceApi;projectId:string;onCreated:()=>void;canManagePhases?:boolean;onOpenCreate?:()=>void}) {
  const [open,setOpen]=useState(false);
  const handleClick = () => {
    if (onOpenCreate) {
      onOpenCreate();
    } else {
      setOpen(true);
    }
  };
  return <><button className="btn btn-primary btn-sm" onClick={handleClick}><Plus className="size-3.5" />Buat WO</button>{open&&<WorkOrderForm api={api} projectId={projectId} onClose={()=>setOpen(false)} onSaved={()=>{setOpen(false);onCreated();}} />}</>;
}
