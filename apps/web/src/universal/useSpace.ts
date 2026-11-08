import type { UniversalSpace } from "@t3tools/contracts";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { useLocation } from "@tanstack/react-router";

import { useComposerDraftStore } from "../composerDraftStore";
import { useThreadRouteTarget } from "../hooks/useThreadRouteTarget";
import { useQuietThreadShells } from "../state/entities";
import { resolveActiveSpace, threadBelongsToSpace, useSpaceStore } from "./spaceStore";

const keyOf = (thread: Pick<EnvironmentThreadShell, "environmentId" | "id">) =>
  scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));

/** The project of whatever the main view shows: a server thread or a draft. */
function useRouteProjectId(threads: ReadonlyArray<EnvironmentThreadShell>): string | null {
  const routeTarget = useThreadRouteTarget();
  const draftProjectId = useComposerDraftStore((store) =>
    routeTarget?.kind === "draft"
      ? (store.getDraftSession(routeTarget.draftId)?.projectId ?? null)
      : null,
  );
  if (routeTarget?.kind === "draft") return draftProjectId;
  if (routeTarget?.kind !== "server") return null;
  const key = scopedThreadKey(routeTarget.threadRef);
  return threads.find((thread) => keyOf(thread) === key)?.projectId ?? null;
}

export function useActiveSpace(): UniversalSpace {
  const threads = useQuietThreadShells();
  const routeProjectId = useRouteProjectId(threads);
  const storedSpace = useSpaceStore((store) => store.space);
  const onLearnHome = useLocation({ select: (location) => location.pathname === "/learn" });
  if (onLearnHome) return "learn";
  return resolveActiveSpace({ routeProjectId, storedSpace });
}

/** The sidebar's thread list for the active space; Code keeps every non-space project. */
export function useSpaceThreads(
  threads: ReadonlyArray<EnvironmentThreadShell>,
): ReadonlyArray<EnvironmentThreadShell> {
  const space = useActiveSpace();
  return threads.filter((thread) => threadBelongsToSpace(thread.projectId, space));
}
