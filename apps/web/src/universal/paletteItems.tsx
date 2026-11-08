import { canOfferLearnThis, type ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { CodeIcon, GraduationCapIcon, MessagesSquareIcon, WaypointsIcon } from "lucide-react";

import { ITEM_ICON_CLASS, type CommandPaletteActionItem } from "../components/CommandPalette.logic";
import { useLearnThis } from "./useLearnThis";
import { useOpenSpace } from "./useOpenSpace";
import { useSpaceStore } from "./spaceStore";

interface PaletteThread {
  readonly id: ThreadId;
  readonly projectId: string;
  readonly title: string;
}

export function useUniversalPaletteItems(thread: PaletteThread | null): CommandPaletteActionItem[] {
  const openSpace = useOpenSpace();
  const learnThis = useLearnThis();
  const setSpace = useSpaceStore((store) => store.setSpace);
  const navigate = useNavigate();

  const go = (
    value: string,
    title: string,
    searchTerms: readonly string[],
    icon: CommandPaletteActionItem["icon"],
    description: string,
    run: () => Promise<void> | void,
  ): CommandPaletteActionItem => ({
    kind: "action",
    value,
    title,
    description,
    searchTerms: [...searchTerms],
    icon,
    run: async () => {
      await run();
    },
  });

  const items: CommandPaletteActionItem[] = [
    go(
      "action:go-to-code",
      "Go to Code",
      ["space", "code"],
      <CodeIcon className={ITEM_ICON_CLASS} />,
      "Alt+1",
      () => openSpace("code"),
    ),
    go(
      "action:go-to-chat",
      "Go to Chat",
      ["space", "chat", "assistant"],
      <MessagesSquareIcon className={ITEM_ICON_CLASS} />,
      "Alt+2",
      () => openSpace("chat"),
    ),
    go(
      "action:go-to-learn",
      "Go to Learn",
      ["space", "learn", "tutor"],
      <GraduationCapIcon className={ITEM_ICON_CLASS} />,
      "Alt+3",
      () => openSpace("learn"),
    ),
    go(
      "action:open-knowledge-map",
      "Open knowledge map",
      ["map", "knowledge", "transit", "learn"],
      <WaypointsIcon className={ITEM_ICON_CLASS} />,
      "Learn",
      async () => {
        setSpace("learn");
        await navigate({ to: "/learn" });
      },
    ),
  ];
  if (thread !== null && canOfferLearnThis(thread.projectId)) {
    items.push(
      go(
        "action:learn-this-thread",
        "Learn this thread",
        ["learn", "tutor", "understand", thread.title],
        <GraduationCapIcon className={ITEM_ICON_CLASS} />,
        thread.title,
        () => learnThis(thread),
      ),
    );
  }
  return items;
}
