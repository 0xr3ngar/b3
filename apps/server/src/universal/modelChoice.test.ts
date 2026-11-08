import {
  type ModelSelection,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { pickRunnableModel } from "./modelChoice.ts";

const provider = (id: string, overrides: Partial<ServerProvider> = {}): ServerProvider => ({
  instanceId: ProviderInstanceId.make(id),
  driver: ProviderDriverKind.make(id),
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-11-08T00:00:00.000Z",
  models: [
    { slug: `${id}-small`, name: "Small", isCustom: false, capabilities: null },
    { slug: `${id}-main`, name: "Main", isCustom: false, isDefault: true, capabilities: null },
  ],
  slashCommands: [],
  skills: [],
  ...overrides,
});

const selection = (id: string): ModelSelection => ({
  instanceId: ProviderInstanceId.make(id),
  model: `${id}-pinned`,
});

describe("pickRunnableModel", () => {
  it.each([
    {
      name: "keeps the first fallback whose provider can run",
      candidates: [selection("codex"), selection("claude")],
      providers: [provider("codex"), provider("claude")],
      expected: selection("codex"),
    },
    {
      name: "skips a fallback whose provider is not installed",
      candidates: [selection("codex"), selection("claude")],
      providers: [provider("codex", { installed: false, status: "error" }), provider("claude")],
      expected: selection("claude"),
    },
    {
      name: "uses an installed provider's default model when no fallback can run",
      candidates: [selection("codex"), null],
      providers: [
        provider("codex", { installed: false }),
        provider("cursor", { enabled: false }),
        provider("pi", { availability: "unavailable" }),
        provider("claude"),
      ],
      expected: { instanceId: ProviderInstanceId.make("claude"), model: "claude-main" },
    },
    {
      name: "trusts the fallback before providers have been probed",
      candidates: [undefined, selection("codex")],
      providers: [],
      expected: selection("codex"),
    },
    {
      name: "gives up when nothing can run",
      candidates: [selection("codex")],
      providers: [provider("codex", { status: "disabled" })],
      expected: null,
    },
  ])("$name", ({ candidates, providers, expected }) => {
    expect(pickRunnableModel(candidates, providers)).toEqual(expected);
  });
});
