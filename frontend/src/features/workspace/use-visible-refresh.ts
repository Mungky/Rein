"use client";
import { useEffect } from "react";

/** Refresh shared records on return to the app; pause hidden tabs and open forms. */
export function useVisibleRefresh(refresh: () => Promise<unknown>, enabled = true) {
  useEffect(()=>{
    if (!enabled) return;
    let last=Date.now();
    const run=()=>{
      if(document.visibilityState!=="visible"||document.querySelector("details[open]")||Date.now()-last<3000)return;
      last=Date.now();void refresh();
    };
    window.addEventListener("focus",run);document.addEventListener("visibilitychange",run);
    const timer=setInterval(run,90000);
    return()=>{clearInterval(timer);window.removeEventListener("focus",run);document.removeEventListener("visibilitychange",run);};
  },[refresh,enabled]);
}
