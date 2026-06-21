"use client";

import { Suspense } from "react";
import { ArticlePlayer } from "@/components/screens/ArticlePlayer";

export default function ArticlePage() {
  return (
    <Suspense fallback={<div className="grid min-h-screen place-items-center bg-bg"><div className="h-10 w-10 animate-spin rounded-full border-4 border-border border-t-primary" /></div>}>
      <ArticlePlayer />
    </Suspense>
  );
}
