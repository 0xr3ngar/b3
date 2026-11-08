import { createFileRoute } from "@tanstack/react-router";

import { LearnKnowledgeSettings } from "../universal/settings/LearnKnowledgeSettings";

export const Route = createFileRoute("/_chat/settings/learn-knowledge")({
  component: LearnKnowledgeSettings,
});
