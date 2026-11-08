import type { UniversalSpace } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";

import { toastManager } from "../components/ui/toast";
import { useStableCallback } from "../hooks/useStableCallback";
import { isEditableFocused } from "../lib/editableFocus";
import { isTerminalFocused } from "../lib/terminalFocus";
import { registerCommands } from "../shortcuts/dispatcher";
import { usePrimaryEnvironmentId } from "../state/environments";
import { useAtomCommand } from "../state/use-atom-command";
import { type LearnThisThread, spaceFromAltDigit } from "./learnThisMenu";
import { useSpaceStore } from "./spaceStore";
import { universal } from "./state";

export function useLearnThis(): (thread: LearnThisThread) => Promise<void> {
  const learnEnvironment = useSpaceStore((store) => store.environments.learn);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const environmentId = learnEnvironment ?? primaryEnvironmentId;
  const learnStart = useAtomCommand(universal.learnStart, "learn this");
  const navigate = useNavigate();
  const setSpace = useSpaceStore((store) => store.setSpace);

  return useStableCallback(async (thread: LearnThisThread) => {
    if (environmentId === null) {
      toastManager.add({
        type: "error",
        title: "Learn is not connected",
        description: "Connect an environment to start a lesson.",
      });
      return;
    }
    const result = await learnStart({
      environmentId,
      input: { kind: "from_thread", sourceThreadId: thread.id, text: thread.title },
    });
    if (result._tag !== "Success") return;
    setSpace("learn");
    await navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId, threadId: result.value.threadId },
    });
  });
}

/** Alt+1/2/3 switch spaces. An editable or the terminal keeps the key. */
export function registerSpaceShortcuts(open: (space: UniversalSpace) => void): () => void {
  return registerCommands(
    {},
    {
      onKeyDown: (event) => {
        if (isEditableFocused(event.target) || isTerminalFocused()) return false;
        const space = spaceFromAltDigit(event);
        if (space === null) return false;
        event.preventDefault();
        open(space);
      },
    },
  );
}
