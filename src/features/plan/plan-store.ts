"use client";

import { useEffect, useSyncExternalStore } from "react";
import { AUTH_HINT_COOKIE } from "@/lib/auth/cookies";
import type { ApplicationStatus, PlanSnapshot } from "@/types/plan";

/**
 * A tiny browser-side cache of "which opportunities are saved / tracked" so the (statically
 * rendered, public) catalogue and detail pages can draw save buttons for the signed-in visitor.
 * It holds ids and statuses only — never notes. It is reset on every login/logout, and it is
 * only a display convenience: every change goes through a server action that re-verifies the
 * session and the database enforces ownership.
 */
export type PlanStatus = "unknown" | "loading" | "anonymous" | "ready" | "error";

export interface PlanState {
  status: PlanStatus;
  saved: ReadonlySet<string>;
  applications: Readonly<Record<string, ApplicationStatus>>;
}

const EMPTY: PlanState = { status: "unknown", saved: new Set(), applications: {} };
let state: PlanState = EMPTY;
let generation = 0; // bumped on reset so a late response from an old session is ignored
const listeners = new Set<() => void>();

const publish = (next: PlanState) => {
  state = next;
  listeners.forEach((listener) => listener());
};

const hasHint = () => typeof document !== "undefined" && document.cookie.split("; ").some((c) => c === `${AUTH_HINT_COOKIE}=1`);

/** Forget everything (login, logout, password change). The next button that mounts reloads. */
export function resetPlan() {
  generation++;
  publish(EMPTY);
}

/** Loads the snapshot once per session; without the sign-in hint no request is made at all. */
export async function ensurePlanLoaded() {
  if (!hasHint()) {
    if (state.status !== "anonymous") publish({ ...EMPTY, status: "anonymous" });
    return;
  }
  if (state.status === "ready" || state.status === "loading") return;
  const mine = generation;
  publish({ ...state, status: "loading" });
  try {
    const response = await fetch("/api/my-plan/state", { credentials: "same-origin", cache: "no-store" });
    if (mine !== generation) return;
    if (response.status === 401) return publish({ ...EMPTY, status: "anonymous" });
    if (!response.ok) return publish({ ...EMPTY, status: "error" });
    const snapshot = (await response.json()) as PlanSnapshot;
    publish({ status: "ready", saved: new Set(snapshot.saved), applications: snapshot.applications });
  } catch {
    if (mine === generation) publish({ ...EMPTY, status: "error" });
  }
}

export function setSavedLocally(opportunityId: string, saved: boolean) {
  const next = new Set(state.saved);
  if (saved) next.add(opportunityId);
  else next.delete(opportunityId);
  publish({ ...state, saved: next });
}

export function setTrackedLocally(opportunityId: string, status: ApplicationStatus | null) {
  const next = { ...state.applications };
  if (status) next[opportunityId] = status;
  else delete next[opportunityId];
  publish({ ...state, applications: next });
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** Current plan state; loads it on first use. The server render (and first client render) is always "unknown". */
export function usePlan(): PlanState {
  const snapshot = useSyncExternalStore(subscribe, () => state, () => EMPTY);
  useEffect(() => {
    void ensurePlanLoaded();
  }, []);
  return snapshot;
}
