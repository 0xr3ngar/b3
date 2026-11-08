import { UNIVERSAL_SPACES, type UniversalSpace } from "@t3tools/contracts";
import { useEffect } from "react";

import { Toggle, ToggleGroup } from "../components/ui/toggle-group";
import { registerLearnThis } from "./learnThisMenu";
import { useActiveSpace } from "./useSpace";
import { registerSpaceShortcuts, useLearnThis } from "./useLearnThis";
import { useOpenSpace } from "./useOpenSpace";

const LABELS: Record<UniversalSpace, string> = { code: "Code", chat: "Chat", learn: "Learn" };

const isSpace = (value: unknown): value is UniversalSpace =>
  typeof value === "string" && (UNIVERSAL_SPACES as ReadonlyArray<string>).includes(value);

/** Code · Chat · Learn. Each space is a project set; switching opens that space's latest work. */
export function SpaceSwitcher() {
  const active = useActiveSpace();
  const open = useOpenSpace();
  const learnThis = useLearnThis();

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keydown and the thread menu reach this switcher from outside React
  useEffect(() => {
    const unregisterKeys = registerSpaceShortcuts(open);
    const unregisterLearn = registerLearnThis((thread) => {
      void learnThis(thread);
    });
    return () => {
      unregisterKeys();
      unregisterLearn();
    };
  }, [learnThis, open]);

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
