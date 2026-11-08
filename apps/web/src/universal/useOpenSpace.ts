import { UNIVERSAL_SPACE_PROJECT_IDS, type UniversalSpace } from "@t3tools/contracts";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { useNavigate } from "@tanstack/react-router";

import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { useStableCallback } from "../hooks/useStableCallback";
import { useQuietThreadShells } from "../state/entities";
import { usePrimaryEnvironmentId } from "../state/environments";
import { threadBelongsToSpace, useSpaceStore } from "./spaceStore";

/** Opens a space the way the switcher does: Learn shows the map, others the latest thread. */
export function useOpenSpace(): (space: UniversalSpace) => void {
  const setSpace = useSpaceStore((store) => store.setSpace);
  const chatEnvironment = useSpaceStore((store) => store.environments.chat);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const threads = useQuietThreadShells();
  const navigate = useNavigate();
  const handleNewThread = useNewThreadHandler();

  return useStableCallback((space: UniversalSpace) => {
    setSpace(space);
    if (space === "learn") {
      void navigate({ to: "/learn" });
      return;
    }
    const latest = threads
      .filter(
        (thread) => thread.archivedAt === null && threadBelongsToSpace(thread.projectId, space),
      )
      .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (latest !== undefined) {
      void navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId: latest.environmentId, threadId: latest.id },
      });
      return;
    }
    const environmentId = (space === "chat" ? chatEnvironment : undefined) ?? primaryEnvironmentId;
    if (space === "chat" && environmentId !== null) {
      void handleNewThread(scopeProjectRef(environmentId, UNIVERSAL_SPACE_PROJECT_IDS.chat));
      return;
    }
    void navigate({ to: "/" });
  });
}
