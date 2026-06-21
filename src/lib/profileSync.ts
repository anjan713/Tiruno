"use client";

import { useGameStore } from "@/lib/store/useGameStore";
import type { ProfileId } from "@/lib/mock/profiles";

/**
 * Switch the active profile: load that profile's saved progress from Redis if it
 * exists, otherwise seed from the profile defaults. Makes per-profile tracking work.
 */
export async function applyProfile(id: ProfileId): Promise<void> {
  let saved: Record<string, unknown> | null = null;
  try {
    const res = await fetch(`/api/state?profile=${id}`);
    const data = await res.json();
    saved = data?.state ?? null;
  } catch {
    saved = null;
  }

  if (saved && saved.profileId === id) {
    useGameStore.setState({ ...saved, _hasHydrated: true });
  } else {
    useGameStore.getState().loadProfile(id);
  }
}
