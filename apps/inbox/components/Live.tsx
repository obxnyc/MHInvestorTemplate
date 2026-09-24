"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-client";

/** Keeps every open screen in sync. Without this, two people work from stale
 *  views and both answer the same tenant -- the exact bottleneck the shared
 *  inbox exists to remove. */
export default function Live() {
  const router = useRouter();
  useEffect(() => {
    const supabase = supabaseBrowser();
    const channel = supabase
      .channel("inbox")
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" },
          () => router.refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" },
          () => router.refresh())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [router]);
  return null;
}
