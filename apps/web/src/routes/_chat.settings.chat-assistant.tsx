import { createFileRoute } from "@tanstack/react-router";

import { ChatAssistantSettings } from "../universal/settings/ChatAssistantSettings";

export const Route = createFileRoute("/_chat/settings/chat-assistant")({
  component: ChatAssistantSettings,
});
