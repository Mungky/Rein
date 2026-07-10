"use client";

/** Branded placeholder screens (RePhot orbit animation, served from
 *  /public/orbit): "idle" (maintenance page) when a channel has nothing to
 *  show, "error" (standby page) when something broke — with the cause line. */

export function OrbitFallback({
  kind,
  reason,
  label,
}: {
  kind: "idle" | "error";
  /** Cause line shown under the status word (error screens should set it). */
  reason?: string;
  /** Override the big status word (default: Maintenance / Standby). */
  label?: string;
}) {
  const page = kind === "idle" ? "maintenance" : "standby";
  const params = new URLSearchParams();
  if (reason) params.set("reason", reason);
  if (label) params.set("label", label);
  const qs = params.toString();
  return (
    <iframe
      src={`/orbit/${page}.html${qs ? `?${qs}` : ""}`}
      title={kind === "idle" ? "Maintenance" : "Standby"}
      className="pointer-events-none block h-full w-full border-0 bg-black"
      tabIndex={-1}
      aria-hidden
    />
  );
}
