import { UNIVERSAL_SPACE_PROJECT_IDS, type ContextMenuItem } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { spaceFromAltDigit, withLearnThisMenu } from "./learnThisMenu";

const menu: readonly ContextMenuItem<"archive" | "delete">[] = [
  { id: "archive", label: "Archive thread" },
  { id: "delete", label: "Delete" },
];

describe("withLearnThisMenu", () => {
  it("hides Learn this for Learn threads", () => {
    expect(
      withLearnThisMenu(menu, UNIVERSAL_SPACE_PROJECT_IDS.learn).map((item) => item.id),
    ).toEqual(["archive", "delete"]);
    expect(withLearnThisMenu(menu, null).map((item) => item.id)).toEqual(["archive", "delete"]);
  });

  it("offers Learn this above archive for Code and Chat threads", () => {
    expect(withLearnThisMenu(menu, "project-1").map((item) => item.label)).toEqual([
      "Learn this",
      "Archive thread",
      "Delete",
    ]);
    expect(
      withLearnThisMenu(menu, UNIVERSAL_SPACE_PROJECT_IDS.chat).map((item) => item.id),
    ).toEqual(["learn-this", "archive", "delete"]);
  });
});

describe("spaceFromAltDigit", () => {
  const event = (
    patch: Partial<{
      altKey: boolean;
      metaKey: boolean;
      ctrlKey: boolean;
      shiftKey: boolean;
      code: string;
      repeat: boolean;
    }> = {},
  ) => ({
    altKey: true,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    code: "Digit1",
    repeat: false,
    ...patch,
  });

  it("maps Alt+1/2/3 to Code, Chat, and Learn", () => {
    expect(spaceFromAltDigit(event({ code: "Digit1" }))).toBe("code");
    expect(spaceFromAltDigit(event({ code: "Digit2" }))).toBe("chat");
    expect(spaceFromAltDigit(event({ code: "Digit3" }))).toBe("learn");
  });

  it("leaves Cmd/Ctrl+digit and other keys alone", () => {
    expect(spaceFromAltDigit(event({ metaKey: true }))).toBeNull();
    expect(spaceFromAltDigit(event({ ctrlKey: true }))).toBeNull();
    expect(spaceFromAltDigit(event({ shiftKey: true }))).toBeNull();
    expect(spaceFromAltDigit(event({ altKey: false }))).toBeNull();
    expect(spaceFromAltDigit(event({ code: "Digit4" }))).toBeNull();
    expect(spaceFromAltDigit(event({ repeat: true }))).toBeNull();
  });
});
