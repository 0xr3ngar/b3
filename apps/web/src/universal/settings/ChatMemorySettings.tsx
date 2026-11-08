import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  AuthOrchestrationOperateScope,
  AuthSettingsWriteScope,
  ThreadId,
  type EnvironmentId,
  type MemoryKind,
  type MemoryRecord,
  type MemoryTopicRule,
  type SensitiveCategory,
  type UniversalSettingsPatch,
} from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import {
  SettingResetButton,
  SettingsRow,
  SettingsSection,
} from "../../components/settings/settingsLayout";
import { searchableSetting } from "../../components/settings/settingsSearch";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../../components/ui/collapsible";
import { Input } from "../../components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Switch } from "../../components/ui/switch";
import { toastManager } from "../../components/ui/toast";
import { requestConfirmDialog } from "../../confirmDialog";
import { formatBytes } from "../../lib/formatBytes";
import { randomUUID } from "../../lib/utils";
import { buildThreadRouteParams } from "../../threadRoutes";
import { useNowMinute } from "../../hooks/useNowMinute";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatRelativeTimeLabel, formatUpcomingTimestamp } from "../../timestampFormat";
import { universal } from "../state";
import { useUniversalAction } from "./command";
import { ModelSettingControl } from "./ModelSettingControl";
import { RunsOnSection } from "./RunsOnRow";
import {
  SettingsQueryMessage,
  SpaceSettingsPage,
  type SpaceEnvironmentTarget,
} from "./spaceEnvironment";
import {
  EXTRACTION_INTERVAL_LABELS,
  EXTRACTION_INTERVALS,
  MEMORY_KIND_LABELS,
  MEMORY_KINDS,
  MEMORY_ORIGIN_LABELS,
  SENSITIVE_CATEGORIES,
  SENSITIVE_CATEGORY_LABELS,
  embedderNeedsGeminiKey,
  embedderStatusLabel,
  formatTopicKeywords,
  isExtractionInterval,
  isMemoryKind,
  memorySearchModeLabel,
  parseTopicKeywords,
} from "./settingsLogic";

const PAGE_SIZE = 50;

export function ChatMemorySettings() {
  return (
    <SpaceSettingsPage space="chat" unavailable="Connect an environment to change memory.">
      {(target) => <MemorySettings {...target} />}
    </SpaceSettingsPage>
  );
}

function formatWhen(iso: string | null, nowMs: number, empty: string): string {
  if (iso === null) return empty;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return empty;
  if (at > nowMs) return formatUpcomingTimestamp(iso, "locale", nowMs) || empty;
  return formatRelativeTimeLabel(iso, nowMs) || empty;
}

function MemorySettings(props: SpaceEnvironmentTarget) {
  const nowMinute = useNowMinute();
  const nowMs = Date.parse(`${nowMinute}:00.000Z`);
  const settingsQuery = useEnvironmentQuery(
    universal.settings({ environmentId: props.environmentId, input: {} }),
  );
  const statusQuery = useEnvironmentQuery(
    universal.status({ environmentId: props.environmentId, input: {} }),
  );
  const profileQuery = useEnvironmentQuery(
    universal.memoryProfile({ environmentId: props.environmentId, input: {} }),
  );
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<MemoryKind | null>(null);
  const [offset, setOffset] = useState(0);
  const [geminiKey, setGeminiKey] = useState("");
  const trimmedQuery = query.trim();
  const listQuery = useEnvironmentQuery(
    universal.memoryList({
      environmentId: props.environmentId,
      input: {
        limit: PAGE_SIZE,
        offset,
        ...(trimmedQuery.length > 0 ? { query: trimmedQuery } : {}),
        ...(kind !== null ? { kind } : {}),
      },
    }),
  );
  const canWrite = useEnvironmentScope(props.environmentId, AuthSettingsWriteScope);
  const canOperate = useEnvironmentScope(props.environmentId, AuthOrchestrationOperateScope);
  const updateSettings = useAtomCommand(universal.updateSettings, {
    label: "save memory settings",
    reportFailure: false,
  });
  const memoryUpsert = useAtomCommand(universal.memoryUpsert, {
    label: "save memory",
    reportFailure: false,
  });
  const memoryDelete = useAtomCommand(universal.memoryDelete, {
    label: "delete memory",
    reportFailure: false,
  });
  const memoryPurge = useAtomCommand(universal.memoryPurge, {
    label: "purge memories",
    reportFailure: false,
  });
  const memoryRunNow = useAtomCommand(universal.memoryRunNow, {
    label: "run memory",
    reportFailure: false,
  });
  const action = useUniversalAction();
  const settings = settingsQuery.data;
  const status = statusQuery.data;
  const list = listQuery.data;
  const disabledWrite = !canWrite || action.pending;
  const disabledOperate = !canOperate || action.pending;

  const refreshMemory = () => {
    listQuery.refresh();
    profileQuery.refresh();
    statusQuery.refresh();
  };
  const saveSettings = (patch: UniversalSettingsPatch, refreshStatus = false) =>
    action.run(
      "Settings not saved",
      () => updateSettings({ environmentId: props.environmentId, input: patch }),
      () => {
        settingsQuery.refresh();
        if (refreshStatus) statusQuery.refresh();
      },
    );

  return (
    <>
      <RunsOnSection
        searchId="memory-runs-on"
        description="Memory on this machine stays on this machine."
        connected={props.connected}
        environmentId={props.environmentId}
        onEnvironment={props.setEnvironment}
      />
      {settings === null ? (
        <SettingsQueryMessage error={settingsQuery.error} />
      ) : (
        <>
          <SettingsSection {...searchableSetting("memory-known")}>
            <div className="px-3 py-3 sm:px-4">
              {profileQuery.data === null ? (
                <SettingsQueryMessage error={profileQuery.error} />
              ) : (
                <Collapsible>
                  <CollapsibleTrigger render={<Button variant="ghost" size="sm" />}>
                    Profile
                  </CollapsibleTrigger>
                  <CollapsiblePanel>
                    <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap font-mono text-xs">
                      {profileQuery.data.markdown.trim().length > 0
                        ? profileQuery.data.markdown
                        : "No profile yet."}
                    </pre>
                  </CollapsiblePanel>
                </Collapsible>
              )}
            </div>
            <div className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:px-4">
              <Input
                nativeInput
                size="sm"
                type="search"
                aria-label="Search memories"
                placeholder="Search memories"
                value={query}
                onChange={(event) => {
                  setQuery(event.currentTarget.value);
                  setOffset(0);
                }}
              />
              <div className="sm:w-40">
                <Select
                  value={kind ?? "all"}
                  onValueChange={(value) => {
                    setKind(value !== null && isMemoryKind(value) ? value : null);
                    setOffset(0);
                  }}
                >
                  <SelectTrigger size="sm" aria-label="Memory kind">
                    <SelectValue>
                      {(value: string | null) =>
                        value !== null && isMemoryKind(value)
                          ? MEMORY_KIND_LABELS[value]
                          : "All kinds"
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup align="end">
                    <SelectItem hideIndicator value="all">
                      All kinds
                    </SelectItem>
                    {MEMORY_KINDS.map((item) => (
                      <SelectItem key={item} hideIndicator value={item}>
                        {MEMORY_KIND_LABELS[item]}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>
            </div>
            {list === null ? (
              <SettingsQueryMessage error={listQuery.error} />
            ) : list.rows.length === 0 ? (
              <p className="px-3 py-3 text-sm text-muted-foreground sm:px-4">
                {list.total === 0 && trimmedQuery.length === 0 && kind === null
                  ? "No memories yet."
                  : "No memories match."}
              </p>
            ) : (
              list.rows.map((record) => (
                <MemoryRow
                  key={record.id}
                  environmentId={props.environmentId}
                  record={record}
                  nowMs={nowMs}
                  disabled={disabledOperate}
                  onSave={(text) =>
                    action.run(
                      "Memory not saved",
                      () =>
                        memoryUpsert({
                          environmentId: props.environmentId,
                          input: {
                            id: record.id,
                            kind: record.kind,
                            text,
                            ...(record.topic !== null ? { topic: record.topic } : {}),
                          },
                        }),
                      refreshMemory,
                    )
                  }
                  onDelete={(neverAgain) =>
                    action.run(
                      neverAgain ? "Could not forget memory" : "Could not delete memory",
                      () =>
                        memoryDelete({
                          environmentId: props.environmentId,
                          input: { id: record.id, neverAgain },
                        }),
                      () => {
                        if (list.rows.length === 1 && offset > 0) {
                          setOffset(Math.max(0, offset - PAGE_SIZE));
                        }
                        refreshMemory();
                      },
                    )
                  }
                />
              ))
            )}
            {list !== null && (offset > 0 || list.total > PAGE_SIZE) ? (
              <div className="flex items-center justify-between gap-2 px-3 py-3 sm:px-4">
                <p className="text-xs text-muted-foreground">
                  {offset + 1}–{offset + (list?.rows.length ?? 0)} of {list.total}
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={offset === 0 || action.pending}
                    onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                  >
                    Previous
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={offset + PAGE_SIZE >= list.total || action.pending}
                    onClick={() => setOffset(offset + PAGE_SIZE)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            ) : null}
            <AddMemoryForm
              disabled={disabledOperate}
              onAdd={(nextKind, text) =>
                action.run(
                  "Memory not saved",
                  () =>
                    memoryUpsert({
                      environmentId: props.environmentId,
                      input: { kind: nextKind, text },
                    }),
                  refreshMemory,
                )
              }
            />
          </SettingsSection>

          <SettingsSection id="memory-build" title="How memory is built">
            <SettingsRow
              {...searchableSetting("memory-extraction-model")}
              description="Reads chats and writes memories. Reset it to use the Chat model."
              resetAction={
                settings.chat.extractionModel !== null ? (
                  <SettingResetButton
                    label="extraction model"
                    tooltip="Use the writing model"
                    disabled={disabledWrite}
                    onClick={() => void saveSettings({ chat: { extractionModel: null } })}
                  />
                ) : null
              }
              control={
                <ModelSettingControl
                  environmentId={props.environmentId}
                  selection={settings.chat.extractionModel}
                  fallbackSelection={settings.chat.defaultModel}
                  emptyLabel="Use the writing model"
                  ariaLabel="Extraction model"
                  disabled={disabledWrite}
                  onChange={(extractionModel) => void saveSettings({ chat: { extractionModel } })}
                />
              }
            />
            <SettingsRow
              {...searchableSetting("memory-schedule")}
              description="How often chats are read for new memories."
              control={
                <Select
                  value={settings.chat.extractionInterval}
                  onValueChange={(value) => {
                    if (
                      value === null ||
                      !isExtractionInterval(value) ||
                      value === settings.chat.extractionInterval
                    ) {
                      return;
                    }
                    void saveSettings({ chat: { extractionInterval: value } });
                  }}
                >
                  <SelectTrigger size="sm" aria-label="Schedule" disabled={disabledWrite}>
                    <SelectValue>
                      {(value: string | null) =>
                        value !== null && isExtractionInterval(value)
                          ? EXTRACTION_INTERVAL_LABELS[value]
                          : "Schedule"
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup align="end">
                    {EXTRACTION_INTERVALS.map((interval) => (
                      <SelectItem key={interval} hideIndicator value={interval}>
                        {EXTRACTION_INTERVAL_LABELS[interval]}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              }
            />
            <SettingsRow
              {...searchableSetting("memory-run-now")}
              description="Read new chats now instead of waiting for the schedule."
              control={
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabledOperate}
                  onClick={() =>
                    void action.run(
                      "Could not run memory",
                      () => memoryRunNow({ environmentId: props.environmentId, input: {} }),
                      (result) => {
                        toastManager.add({
                          type: result.started ? "success" : "info",
                          title: "Memory",
                          description: result.message,
                        });
                        refreshMemory();
                      },
                    )
                  }
                >
                  Run now
                </Button>
              }
            />
          </SettingsSection>

          <SettingsSection id="memory-embeddings" title="Embeddings">
            <SettingsRow
              {...searchableSetting("memory-embedder")}
              description="Turns memories into vectors for search. The first run downloads a local model."
              status={
                status === null
                  ? (statusQuery.error ?? "Loading embedder status…")
                  : embedderStatusLabel(status.embedder)
              }
              control={
                <Select
                  value={settings.chat.embedderId}
                  disabled={disabledWrite || status === null || status.embedderModels.length === 0}
                  onValueChange={(value) => {
                    if (value === null || value === settings.chat.embedderId) return;
                    void saveSettings({ chat: { embedderId: value } }, true);
                  }}
                >
                  <SelectTrigger size="sm" aria-label="Embedding model">
                    <SelectValue>
                      {(value: string | null) =>
                        status?.embedderModels.find((model) => model.id === value)?.label ??
                        value ??
                        "Choose a model"
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup align="end" matchTriggerWidth={false}>
                    {(status?.embedderModels ?? []).map((model) => (
                      <SelectItem key={model.id} hideIndicator value={model.id}>
                        <span className="flex min-w-0 flex-col py-0.5">
                          <span>{model.label}</span>
                          <span className="text-xs text-muted-foreground">
                            {model.approxDownloadMb} MB · {model.dims} dims · {model.description}
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              }
            />
            {embedderNeedsGeminiKey(
              status?.embedderModels.find((model) => model.id === settings.chat.embedderId) ??
                (settings.chat.embedderId === "gemini-embedding-2"
                  ? { id: settings.chat.embedderId, provider: "gemini" }
                  : null),
            ) ? (
              <SettingsRow
                id="memory-gemini-key"
                title="Gemini API key"
                description={
                  settings.geminiApiKeySet
                    ? "Key saved. Enter a new key to replace it."
                    : "Gemini embeddings need a paid API key, stored on this machine."
                }
                control={
                  settings.geminiApiKeySet ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={disabledWrite}
                      onClick={() => {
                        setGeminiKey("");
                        void saveSettings({ geminiApiKey: null }, true);
                      }}
                    >
                      Clear key
                    </Button>
                  ) : null
                }
              >
                <div className="flex flex-col gap-2 pb-3 sm:flex-row sm:items-center">
                  <Input
                    nativeInput
                    size="sm"
                    type="password"
                    autoComplete="off"
                    aria-label="Gemini API key"
                    value={geminiKey}
                    disabled={disabledWrite}
                    onChange={(event) => setGeminiKey(event.currentTarget.value)}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={disabledWrite || geminiKey.trim().length === 0}
                    onClick={() =>
                      void action.run(
                        "API key not saved",
                        () =>
                          updateSettings({
                            environmentId: props.environmentId,
                            input: { geminiApiKey: geminiKey.trim() },
                          }),
                        () => {
                          setGeminiKey("");
                          settingsQuery.refresh();
                          statusQuery.refresh();
                        },
                      )
                    }
                  >
                    Save key
                  </Button>
                </div>
              </SettingsRow>
            ) : null}
            <SettingsRow
              {...searchableSetting("memory-search-mode")}
              description="How memories are retrieved."
              status={
                status === null
                  ? (statusQuery.error ?? "Loading…")
                  : memorySearchModeLabel(
                      status.memory.vectorSearch,
                      status.memory.vectorUnavailableReason,
                    )
              }
            />
          </SettingsSection>

          <SettingsSection id="memory-privacy" title="Privacy">
            <p className="px-3 pt-3 text-xs text-muted-foreground sm:px-4">
              Sensitive topics stay off until you opt in.
            </p>
            {SENSITIVE_CATEGORIES.map((category) => (
              <SettingsRow
                key={category}
                title={SENSITIVE_CATEGORY_LABELS[category]}
                description={`Allow memories about ${SENSITIVE_CATEGORY_LABELS[category].toLowerCase()}.`}
                control={
                  <Switch
                    checked={settings.chat.sensitiveOptIn.includes(category)}
                    disabled={disabledWrite}
                    aria-label={SENSITIVE_CATEGORY_LABELS[category]}
                    onCheckedChange={(checked) =>
                      void saveSettings({
                        chat: {
                          sensitiveOptIn: nextSensitive(
                            settings.chat.sensitiveOptIn,
                            category,
                            checked === true,
                          ),
                        },
                      })
                    }
                  />
                }
              />
            ))}
            <SettingsRow
              {...searchableSetting("memory-topic-rules")}
              description="Skip these topics, and never learn them again."
            >
              <TopicRulesEditor
                rules={settings.chat.topicRules}
                disabled={disabledWrite}
                onChange={(topicRules) => saveSettings({ chat: { topicRules } })}
              />
            </SettingsRow>
            <SettingsRow
              {...searchableSetting("memory-purge")}
              description="Removes every memory on this machine. Topic rules stay."
              control={
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={disabledWrite}
                  onClick={() =>
                    void purgeMemories(() =>
                      action.run(
                        "Could not delete memories",
                        () => memoryPurge({ environmentId: props.environmentId, input: {} }),
                        (result) => {
                          toastManager.add({
                            type: "success",
                            title: "Memories deleted",
                            description: `${result.deleted} ${result.deleted === 1 ? "memory" : "memories"} deleted`,
                          });
                          setOffset(0);
                          refreshMemory();
                        },
                      ),
                    )
                  }
                >
                  Delete all memories
                </Button>
              }
            />
          </SettingsSection>

          <SettingsSection {...searchableSetting("memory-health")}>
            {status === null ? (
              <SettingsQueryMessage error={statusQuery.error} />
            ) : (
              <ul className="space-y-1 px-3 py-3 text-sm text-muted-foreground sm:px-4">
                <li>
                  {status.memory.count} {status.memory.count === 1 ? "memory" : "memories"}
                </li>
                <li>Last run {formatWhen(status.memory.lastRunAt, nowMs, "never")}</li>
                {status.memory.lastRunError !== null ? (
                  <li>Last error: {status.memory.lastRunError}</li>
                ) : null}
                <li>Next run {formatWhen(status.memory.nextRunAt, nowMs, "not scheduled")}</li>
                <li>
                  {status.memory.pendingMessages}{" "}
                  {status.memory.pendingMessages === 1 ? "message" : "messages"} waiting
                </li>
                <li>Database {formatBytes(status.memory.databaseBytes)}</li>
              </ul>
            )}
          </SettingsSection>
        </>
      )}
    </>
  );
}

function nextSensitive(
  current: readonly SensitiveCategory[],
  category: SensitiveCategory,
  checked: boolean,
): SensitiveCategory[] {
  if (checked) return current.includes(category) ? [...current] : [...current, category];
  return current.filter((item) => item !== category);
}

async function purgeMemories(purge: () => Promise<boolean>) {
  const confirmed = await requestConfirmDialog("Delete all memories? This cannot be undone.", {
    variant: "destructive",
  });
  if (confirmed !== true) return;
  await purge();
}

function MemoryThreadLink(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: string;
  readonly title: string | null;
}) {
  const ref = scopeThreadRef(props.environmentId, ThreadId.make(props.threadId));
  return (
    <Link
      to="/$environmentId/$threadId"
      params={buildThreadRouteParams(ref)}
      className="truncate underline underline-offset-2"
    >
      {props.title && props.title.trim().length > 0 ? props.title : "Open chat"}
    </Link>
  );
}

function MemoryRow(props: {
  readonly environmentId: EnvironmentId;
  readonly record: MemoryRecord;
  readonly nowMs: number;
  readonly disabled: boolean;
  readonly onSave: (text: string) => Promise<boolean>;
  readonly onDelete: (neverAgain: boolean) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(props.record.text);
  const meta = [
    formatRelativeTimeLabel(props.record.updatedAt, props.nowMs),
    MEMORY_ORIGIN_LABELS[props.record.origin],
    props.record.reason,
  ].filter((part): part is string => part !== null && part.length > 0);

  const save = async () => {
    const next = text.trim();
    if (next.length === 0) return;
    if (next === props.record.text) {
      setEditing(false);
      return;
    }
    const saved = await props.onSave(next);
    if (saved) setEditing(false);
  };

  return (
    <div className="flex flex-col gap-2 px-3 py-3 sm:px-4">
      {editing ? (
        <div className="flex flex-col gap-2">
          <Input
            nativeInput
            size="sm"
            aria-label="Memory text"
            value={text}
            disabled={props.disabled}
            onChange={(event) => setText(event.currentTarget.value)}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={props.disabled || text.trim().length === 0}
              onClick={() => void save()}
            >
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setText(props.record.text);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2">
          <Badge variant="secondary" size="sm">
            {MEMORY_KIND_LABELS[props.record.kind]}
          </Badge>
          <p className="min-w-0 text-sm wrap-anywhere">{props.record.text}</p>
        </div>
      )}
      <p className="flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
        <span>{meta.join(" · ")}</span>
        {props.record.sourceThreadId !== null ? (
          <>
            <span>·</span>
            <MemoryThreadLink
              environmentId={props.environmentId}
              threadId={props.record.sourceThreadId}
              title={props.record.sourceThreadTitle}
            />
          </>
        ) : null}
      </p>
      {editing ? null : (
        <div className="flex flex-wrap gap-2">
          <Button
            size="xs"
            variant="ghost"
            disabled={props.disabled}
            onClick={() => {
              setText(props.record.text);
              setEditing(true);
            }}
          >
            Edit
          </Button>
          <Button
            size="xs"
            variant="ghost"
            disabled={props.disabled}
            onClick={() => void props.onDelete(false)}
          >
            Delete
          </Button>
          <Button
            size="xs"
            variant="ghost-destructive"
            disabled={props.disabled}
            onClick={() => void props.onDelete(true)}
          >
            Forget and never relearn
          </Button>
        </div>
      )}
    </div>
  );
}

function AddMemoryForm(props: {
  readonly disabled: boolean;
  readonly onAdd: (kind: MemoryKind, text: string) => Promise<boolean>;
}) {
  const [kind, setKind] = useState<MemoryKind>("fact");
  const [text, setText] = useState("");
  const add = async () => {
    const next = text.trim();
    if (next.length === 0) return;
    const saved = await props.onAdd(kind, next);
    if (saved) setText("");
  };
  return (
    <div className="flex flex-col gap-2 px-3 py-3 sm:px-4">
      <p className="text-sm font-medium">Add memory</p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="sm:w-36">
          <Select
            value={kind}
            onValueChange={(value) => {
              if (value !== null && isMemoryKind(value)) setKind(value);
            }}
          >
            <SelectTrigger size="sm" aria-label="New memory kind" disabled={props.disabled}>
              <SelectValue>{MEMORY_KIND_LABELS[kind]}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end">
              {MEMORY_KINDS.map((item) => (
                <SelectItem key={item} hideIndicator value={item}>
                  {MEMORY_KIND_LABELS[item]}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
        <Input
          nativeInput
          size="sm"
          aria-label="New memory"
          placeholder="Something to remember"
          value={text}
          disabled={props.disabled}
          onChange={(event) => setText(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void add();
            }
          }}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={props.disabled || text.trim().length === 0}
          onClick={() => void add()}
        >
          Add
        </Button>
      </div>
    </div>
  );
}

function TopicRulesEditor(props: {
  readonly rules: readonly MemoryTopicRule[];
  readonly disabled: boolean;
  readonly onChange: (rules: MemoryTopicRule[]) => Promise<boolean>;
}) {
  const [draftTopic, setDraftTopic] = useState("");
  const [draftKeywords, setDraftKeywords] = useState("");
  const add = async () => {
    const topic = draftTopic.trim();
    if (topic.length === 0 || props.disabled) return;
    const saved = await props.onChange([
      ...props.rules,
      { id: randomUUID(), topic, keywords: parseTopicKeywords(draftKeywords) },
    ]);
    if (!saved) return;
    setDraftTopic("");
    setDraftKeywords("");
  };
  return (
    <div className="flex flex-col gap-3 pb-3">
      {props.rules.map((rule) => (
        <div key={rule.id} className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            key={`${rule.id}:${rule.topic}`}
            nativeInput
            size="sm"
            aria-label="Topic"
            defaultValue={rule.topic}
            disabled={props.disabled}
            onBlur={(event) => {
              const topic = event.currentTarget.value.trim();
              if (topic.length === 0 || topic === rule.topic) return;
              void props.onChange(
                props.rules.map((item) => (item.id === rule.id ? { ...item, topic } : item)),
              );
            }}
          />
          <Input
            key={`${rule.id}:${formatTopicKeywords(rule.keywords)}`}
            nativeInput
            size="sm"
            aria-label="Keywords, comma-separated"
            defaultValue={formatTopicKeywords(rule.keywords)}
            disabled={props.disabled}
            onBlur={(event) => {
              const keywords = parseTopicKeywords(event.currentTarget.value);
              if (formatTopicKeywords(keywords) === formatTopicKeywords(rule.keywords)) return;
              void props.onChange(
                props.rules.map((item) => (item.id === rule.id ? { ...item, keywords } : item)),
              );
            }}
          />
          <Button
            size="sm"
            variant="ghost"
            disabled={props.disabled}
            onClick={() => void props.onChange(props.rules.filter((item) => item.id !== rule.id))}
          >
            Remove
          </Button>
        </div>
      ))}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          nativeInput
          size="sm"
          aria-label="New topic"
          placeholder="Topic"
          value={draftTopic}
          disabled={props.disabled}
          onChange={(event) => setDraftTopic(event.currentTarget.value)}
        />
        <Input
          nativeInput
          size="sm"
          aria-label="New topic keywords, comma-separated"
          placeholder="Keywords, comma-separated"
          value={draftKeywords}
          disabled={props.disabled}
          onChange={(event) => setDraftKeywords(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void add();
            }
          }}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={props.disabled || draftTopic.trim().length === 0}
          onClick={() => void add()}
        >
          Add topic
        </Button>
      </div>
    </div>
  );
}
