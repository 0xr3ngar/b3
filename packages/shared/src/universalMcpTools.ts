import type { T3McpToolDefinition } from "./t3McpToolPresentation.ts";

type MakeTool = (
  labels: T3McpToolDefinition["labels"],
  summaryAction: T3McpToolDefinition["summaryAction"],
) => T3McpToolDefinition;

/** b3 fork tools, labelled like upstream's own T3 tools. */
export const universalT3McpTools = (tool: MakeTool): Record<string, T3McpToolDefinition> => ({
  memory_search: tool(["Search", "Searching", "Searched", "memory"], "memory"),
  memory_save: tool(["Remember", "Remembering", "Remembered", "a note"], "memory"),
  memory_forget: tool(["Forget", "Forgetting", "Forgot", "a note"], "memory"),
  memory_next_batch: tool(["Read", "Reading", "Read", "recent chats"], "memory"),
  memory_commit: tool(["Save", "Saving", "Saved", "memories"], "memory"),
  learn_map_read: tool(["Read", "Reading", "Read", "the knowledge map"], "learn"),
  learn_plan_set: tool(["Plan", "Planning", "Planned", "a route"], "learn"),
  learn_ask: tool(["Ask", "Asking", "Asked", "a question"], "learn"),
  learn_record: tool(["Record", "Recording", "Recorded", "practice"], "learn"),
  learn_review_next: tool(["Check", "Checking", "Checked", "due reviews"], "learn"),
  learn_session_end: tool(["End", "Ending", "Ended", "the session"], "learn"),
  learn_suggest: tool(["Suggest", "Suggesting", "Suggested", "a concept"], "learn"),
});
