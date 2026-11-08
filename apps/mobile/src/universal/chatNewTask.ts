import { UNIVERSAL_SPACE_PROJECT_IDS, type EnvironmentId } from "@t3tools/contracts";

import { resolveSpaceEnvironmentId } from "./spaceMembership";
import { readSpaceSnapshot } from "./spaceStore";

/** A Chat-space new task opens a draft in the Chat project on the space's environment. */
export function chatSpaceDraftTarget(input: {
  readonly environments: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly isEnabled: boolean;
    readonly isRelayManaged: boolean;
  }>;
  readonly requestId: string;
}): {
  readonly draft: {
    readonly requestId: string;
    readonly environmentId: string;
    readonly projectId: string;
    readonly title: string;
  };
} | null {
  const snapshot = readSpaceSnapshot();
  if (!snapshot.ready || snapshot.space !== "chat") return null;
  const environmentId = resolveSpaceEnvironmentId(
    "chat",
    snapshot.environments,
    input.environments,
  );
  if (environmentId === null) return null;
  return {
    draft: {
      requestId: input.requestId,
      environmentId: String(environmentId),
      projectId: String(UNIVERSAL_SPACE_PROJECT_IDS.chat),
      title: "Chat",
    },
  };
}
