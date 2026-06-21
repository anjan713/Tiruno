"use client";

import { Suspense } from "react";
import { LessonPlayer } from "@/components/screens/LessonPlayer";

export default function LessonPage() {
  return (
    <Suspense fallback={<div className="grid min-h-screen place-items-center bg-bg"><div className="h-10 w-10 animate-spin rounded-full border-4 border-border border-t-primary" /></div>}>
      <LessonPlayer />
    </Suspense>
  );
}
