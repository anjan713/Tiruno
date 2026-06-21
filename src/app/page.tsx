"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useGameStore } from "@/lib/store/useGameStore";

export default function Home() {
  const router = useRouter();
  const profileId = useGameStore((s) => s.profileId);
  const onboarded = useGameStore((s) => s.onboarded);
  const hydrated = useGameStore((s) => s._hasHydrated);

  useEffect(() => {
    if (!hydrated) return;
    router.replace(profileId || onboarded ? "/learn" : "/login");
  }, [hydrated, profileId, onboarded, router]);

  return (
    <div className="grid min-h-screen place-items-center bg-bg">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-border border-t-primary" />
    </div>
  );
}
