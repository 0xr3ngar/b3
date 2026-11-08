import { canOfferLearnThis, type ThreadId } from "@t3tools/contracts";
import type { MenuAction } from "@react-native-menu/menu";

import * as Dialog from "../components/ui/Dialog";
import { useSelectWorkspaceDetail } from "../features/layout/workspace/useSelectWorkspaceDetail";
import { useAtomCommand } from "../state/use-atom-command";
import { setSpace } from "./spaceStore";
import { universal } from "./state";
import { useSpaceEnvironmentId } from "./useSpace";

export function learnThisMenuAction(projectId: string): MenuAction[] {
  if (!canOfferLearnThis(projectId)) return [];
  return [{ id: "learn-this", title: "Learn this", image: "graduationcap" }];
}

export function useLearnThisThread(): (thread: {
  readonly id: ThreadId;
  readonly projectId: string;
  readonly title: string;
}) => Promise<void> {
  const environmentId = useSpaceEnvironmentId("learn");
  const learnStart = useAtomCommand(universal.learnStart, "learn this");
  const selectDetail = useSelectWorkspaceDetail();

  return async (thread) => {
    if (!canOfferLearnThis(thread.projectId)) return;
    if (environmentId === null) {
      Dialog.alert("Learn is not connected", "Connect an environment to start a lesson.");
      return;
    }
    const result = await learnStart({
      environmentId,
      input: { kind: "from_thread", sourceThreadId: thread.id, text: thread.title },
    });
    if (result._tag !== "Success") return;
    setSpace("learn");
    selectDetail({
      name: "Thread",
      params: {
        environmentId: String(environmentId),
        threadId: String(result.value.threadId),
      },
    });
  };
}
