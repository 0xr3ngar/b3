import type { LearnMap, LearnMapStation } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { TransitMap } from "./TransitMap";

function station(
  id: string,
  title: string,
  lineIds: string[],
  state: LearnMapStation["state"],
  extra: Partial<LearnMapStation> = {},
): LearnMapStation {
  return {
    id,
    title,
    lineIds,
    state,
    recall: extra.recall === undefined ? null : extra.recall,
    mastery: 0,
    misconception: extra.misconception === undefined ? null : extra.misconception,
    dueAt: null,
    taughtIn: null,
    note: null,
    minutes: 12,
  };
}

const map: LearnMap = {
  lines: [
    { id: "chance", title: "Chance", color: "primary" },
    { id: "side", title: "Side", color: "success" },
  ],
  stations: [
    station("prob", "Probability", ["chance"], "solid", { recall: 0.9 }),
    station("lik", "Likelihood", ["chance"], "learning", {
      recall: 0.4,
      misconception: "The likelihood is not a probability of θ.",
    }),
    station("other", "Unrelated", ["side"], "solid", { recall: 1 }),
  ],
  edges: [{ from: "prob", to: "lik", planned: false }],
  anchors: {},
  here: "lik",
};

it("shows the detail card and dims the stops outside the focus", async () => {
  const container = document.createElement("div");
  container.style.width = "900px";
  container.style.height = "700px";
  await using screen = await render(
    <TransitMap map={map} onStart={vi.fn()} onAction={vi.fn()} onOpenThread={vi.fn()} />,
    { container },
  );

  await userEvent.click(screen.getByRole("button", { name: "Likelihood" }));

  await expect.element(screen.getByRole("heading", { name: "Likelihood" })).toBeVisible();
  const station = (id: string) => screen.container.querySelector(`[data-station="${id}"]`);
  expect(station("other")).toHaveAttribute("data-dim", "true");
  expect(station("prob")).toHaveAttribute("data-dim", "false");
  expect(station("lik")).toHaveAttribute("data-dim", "false");
});
