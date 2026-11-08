import { describe, expect, it } from "vite-plus/test";

import source from "./learn-widget.html?raw";
import { LEARN_WIDGET_HTML } from "./learnWidget.generated.ts";

describe("learn widget document", () => {
  it("matches the generated module", () => {
    expect(LEARN_WIDGET_HTML).toBe(source);
  });

  it("has no network URLs", () => {
    expect(source).not.toMatch(/https?:\/\//);
    expect(LEARN_WIDGET_HTML).not.toMatch(/https?:\/\//);
  });
});
