import {
  universalSpaceOfProject,
  type EnvironmentId,
  type UniversalSpace,
} from "@t3tools/contracts";
import { useNavigationState } from "@react-navigation/native";
import { useEffect } from "react";

import { useNavigationThreadShells } from "../state/entities";
import { useWorkspaceEnvironments } from "../state/workspace";
import { resolveSpaceEnvironmentId } from "./spaceMembership";
import { setSpace, useSpaceStore } from "./spaceStore";

const first = (value: string | readonly string[] | undefined) =>
  typeof value === "string" ? value : value?.[0];

function routeProjectKey(state: {
  readonly index: number;
  readonly routes: readonly { readonly name: string; readonly params?: object }[];
}): string {
  const route = state.routes.slice(0, state.index + 1).findLast((item) => item.name === "Thread");
  const params = route?.params as
    | {
        readonly draft?: { readonly projectId?: string | readonly string[] };
        readonly environmentId?: string | readonly string[];
        readonly threadId?: string | readonly string[];
      }
    | undefined;
  const draftProjectId = first(params?.draft?.projectId);
  if (draftProjectId) return `draft\n${draftProjectId}`;
  const environmentId = first(params?.environmentId);
  const threadId = first(params?.threadId);
  return environmentId && threadId ? `thread\n${environmentId}\n${threadId}` : "";
}

export function useOpenThreadProjectId(): string | null {
  const key = useNavigationState(routeProjectKey);
  const shells = useNavigationThreadShells();
  if (key.startsWith("draft\n")) return key.slice("draft\n".length);
  if (!key.startsWith("thread\n")) return null;
  const [, environmentId, threadId] = key.split("\n");
  if (!environmentId || !threadId) return null;
  return (
    shells.find((thread) => thread.environmentId === environmentId && thread.id === threadId)
      ?.projectId ?? null
  );
}

/** Remembered space after storage loads. Unset until then, so the list does not flash. */
export function useListSpace(): UniversalSpace | undefined {
  return useSpaceStore((current) => (current.ready ? current.space : undefined));
}

export function useSpaceEnvironmentId(space: "chat" | "learn"): EnvironmentId | null {
  const chosen = useSpaceStore((current) => current.environments);
  const environments = useWorkspaceEnvironments();
  return resolveSpaceEnvironmentId(space, chosen, environments);
}

let appliedRouteProjectId: string | null = null;

/** Opening a thread selects that thread's space. A later pick on the switcher stays put. */
export function useOpenThreadSpace() {
  const routeProjectId = useOpenThreadProjectId();
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the open thread's project selects its space when the user opens a different thread
  useEffect(() => {
    if (routeProjectId === null || routeProjectId === appliedRouteProjectId) return;
    appliedRouteProjectId = routeProjectId;
    const next = universalSpaceOfProject(routeProjectId);
    if (next !== "system") setSpace(next);
  }, [routeProjectId]);
}
