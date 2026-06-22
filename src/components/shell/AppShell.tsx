"use client";

import { Nav } from "./Nav";
import { BottomNav } from "./BottomNav";
import { ContextRail } from "./ContextRail";
import { TopBar } from "./TopBar";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-bg bg-dotpattern">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <Nav />
        <main className="flex-1 overflow-y-auto scroll-thin">
          <div className="mx-auto w-full max-w-[760px] px-5 pb-28 pt-6 md:px-8 md:pb-10 md:pt-8">{children}</div>
        </main>
        <ContextRail />
      </div>
      <BottomNav />
    </div>
  );
}
