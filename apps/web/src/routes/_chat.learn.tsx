import { createFileRoute } from "@tanstack/react-router";

import { LearnHome } from "../universal/learn/LearnHome";

export const Route = createFileRoute("/_chat/learn")({
  component: LearnHome,
});
