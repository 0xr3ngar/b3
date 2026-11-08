import {
  UNIVERSAL_SPACE_PROJECT_IDS,
  UNIVERSAL_SPACES,
  type UniversalSpace,
} from "@t3tools/contracts";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { useNavigate } from "@tanstack/react-router";

import { Toggle, ToggleGroup } from "../components/ui/toggle-group";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { useQuietThreadShells } from "../state/entities";
import { usePrimaryEnvironmentId } from "../state/environments";
import { threadBelongsToSpace, useSpaceStore } from "./spaceStore";
import { useActiveSpace } from "./useSpace";

const LABELS: Record<UniversalSpace, string> = { code: "Code", chat: "Chat", learn: "Learn" };

const isSpace = (value: unknown): value is UniversalSpace =>
  typeof value === "string" && (UNIVERSAL_SPACES as ReadonlyArray<string>).includes(value);

/** Code · Chat · Learn. Each space is a project set; switching opens that space's latest work. */
export function SpaceSwitcher() {
  const active = useActiveSpace();
  const setSpace = useSpaceStore((store) => store.setSpace);
  const environments = useSpaceStore((store) => store.environments);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const threads = useQuietThreadShells();
  const navigate = useNavigate();
  const handleNewThread = useNewThreadHandler();

  const open = (space: UniversalSpace) => {
    setSpace(space);
    if (space === "learn") {
      void navigate({ to: "/learn" });
      return;
    }
    const latest = threads
      .filter((thread) => thread.archivedAt === null && threadBelongsToSpace(thread.projectId, space))
      .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (latest !== undefined) {
      void navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId: latest.environmentId, threadId: latest.id },
      });
      return;
    }
    const environmentId = (space === "chat" ? environments.chat : undefined) ?? primaryEnvironmentId;
    if (space === "chat" && environmentId !== null) {
      void handleNewThread(scopeProjectRef(environmentId, UNIVERSAL_SPACE_PROJECT_IDS.chat));
      return;
    }
    void navigate({ to: "/" });
  };

  return (
    <div className="px-2 pb-2">
      <ToggleGroup
        aria-label="Space"
        className="w-full *:flex-1"
        value={[active]}
        onValueChange={(next) => {
          const value = next[0];
          if (isSpace(value)) open(value);
        }}
      >
        {UNIVERSAL_SPACES.map((space) => (
          <Toggle key={space} value={space}>
            {LABELS[space]}
          </Toggle>
        ))}
      </ToggleGroup>
    </div>
  );
}
