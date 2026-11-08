import { createFileRoute } from "@tanstack/react-router";

import { ChatMemorySettings } from "../universal/settings/ChatMemorySettings";

export const Route = createFileRoute("/_chat/settings/chat-memory")({
  component: ChatMemorySettings,
});
