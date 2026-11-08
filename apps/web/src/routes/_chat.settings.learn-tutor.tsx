import { createFileRoute } from "@tanstack/react-router";

import { LearnTutorSettings } from "../universal/settings/LearnTutorSettings";

export const Route = createFileRoute("/_chat/settings/learn-tutor")({
  component: LearnTutorSettings,
});
