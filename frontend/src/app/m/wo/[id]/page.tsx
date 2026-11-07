"use client";
import { use } from "react";
import { useRouter } from "next/navigation";
import { PageGuard } from "@/components/guards/page-guard";
import { WorkOrderDetail } from "@/features/workspace/work-order-detail";

export default function MobileWoDetailPage({params}: {params:Promise<{id:string}>}) {
  const {id}=use(params);
  const router=useRouter();
  return <PageGuard permission="workspace:view"><WorkOrderDetail taskId={id} onClose={()=>router.push("/m/wo")} /></PageGuard>;
}
