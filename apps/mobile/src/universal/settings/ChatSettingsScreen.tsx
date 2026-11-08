import {
  type ExtractionInterval,
  type MemoryRecord,
  type UniversalChatSettings,
  type UniversalSettingsPatch,
} from "@t3tools/contracts";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { AppTextInput, AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import * as Dialog from "../../components/ui/Dialog";
import { ListChoiceRow } from "../../components/ui/ListChoiceRow";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { SettingsScreen } from "../../features/settings/components/SettingsScreen";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { SettingsSwitchRow } from "../../features/settings/components/SettingsSwitchRow";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { universal } from "../state";
import { useSpaceEnvironmentId } from "../useSpace";
import { RunsOnSection } from "./RunsOnSection";

const INTERVALS: ReadonlyArray<{ readonly value: ExtractionInterval; readonly label: string }> = [
  { value: "hourly", label: "Hourly" },
  { value: "6h", label: "6h" },
  { value: "daily", label: "Daily" },
  { value: "off", label: "Off" },
];

function modelLabel(selection: { readonly model: string } | null): string {
  return selection === null ? "Default" : selection.model;
}

function formatWhen(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function ChatSettingsScreen() {
  const insets = useSafeAreaInsets();
  const environmentId = useSpaceEnvironmentId("chat");
  const settingsQuery = useEnvironmentQuery(
    environmentId === null ? null : universal.settings({ environmentId, input: {} }),
  );
  const statusQuery = useEnvironmentQuery(
    environmentId === null ? null : universal.status({ environmentId, input: {} }),
  );
  const [query, setQuery] = useState("");
  const trimmed = query.trim();
  const memoryQuery = useEnvironmentQuery(
    environmentId === null
      ? null
      : universal.memoryList({
          environmentId,
          input: { limit: 50, offset: 0, ...(trimmed.length > 0 ? { query: trimmed } : {}) },
        }),
  );
  const profileQuery = useEnvironmentQuery(
    environmentId === null ? null : universal.memoryProfile({ environmentId, input: {} }),
  );
  const updateSettings = useAtomCommand(universal.updateSettings, "chat settings");
  const deleteMemory = useAtomCommand(universal.memoryDelete, "forget memory");
  const purgeMemory = useAtomCommand(universal.memoryPurge, "purge memory");
  const runNow = useAtomCommand(universal.memoryRunNow, "run memory");
  const [running, setRunning] = useState(false);
  const settings = settingsQuery.data?.chat ?? null;
  const models = statusQuery.data?.embedderModels ?? [];

  const patch = async (chat: Partial<UniversalChatSettings>) => {
    if (environmentId === null) return;
    const input: UniversalSettingsPatch = { chat };
    const result = await updateSettings({ environmentId, input });
    if (result._tag === "Success") {
      settingsQuery.refresh();
      statusQuery.refresh();
    }
  };

  const refreshMemories = () => {
    memoryQuery.refresh();
    profileQuery.refresh();
    statusQuery.refresh();
  };

  const forget = async (id: string, neverAgain: boolean) => {
    if (environmentId === null) return;
    const result = await deleteMemory({ environmentId, input: { id, neverAgain } });
    if (result._tag === "Success") refreshMemories();
  };

  const purge = () => {
    Dialog.alert("Purge memory?", "Every memory on this environment is deleted.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Purge",
        style: "destructive",
        onPress: () => {
          if (environmentId === null) return;
          void purgeMemory({ environmentId, input: {} }).then((result) => {
            if (result._tag === "Success") refreshMemories();
          });
        },
      },
    ]);
  };

  const extract = async () => {
    if (environmentId === null || running) return;
    setRunning(true);
    const result = await runNow({ environmentId, input: {} });
    setRunning(false);
    if (result._tag === "Success") statusQuery.refresh();
  };

  return (
    <SettingsScreen title="Assistant & Memory">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-4 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
        keyboardShouldPersistTaps="handled"
      >
        <RunsOnSection space="chat" />
        {environmentId !== null && settingsQuery.isPending && settings === null ? (
          <AppActivityIndicator colorClassName="accent-icon-muted" />
        ) : null}
        {settingsQuery.error ? (
          <Text className="px-2 text-sm text-danger-foreground">{settingsQuery.error}</Text>
        ) : null}
        <SettingsSection title="Memory">
          <SettingsSwitchRow
            label="Memory"
            subtitle="Remember useful facts from Chat."
            value={settings?.memoryEnabled ?? false}
            disabled={settings === null}
            onValueChange={(memoryEnabled) => void patch({ memoryEnabled })}
          />
        </SettingsSection>
        <SettingsSection title="Extraction">
          <View className="px-3 py-3">
            <SegmentedControl
              options={INTERVALS}
              selected={settings?.extractionInterval ?? "6h"}
              onSelect={(extractionInterval) => void patch({ extractionInterval })}
              size="compact"
            />
          </View>
          <View className="px-4 pb-3">
            <Button
              label="Run now"
              loading={running}
              disabled={environmentId === null || settings === null}
              onPress={() => void extract()}
            />
          </View>
          {statusQuery.data?.memory.lastRunError ? (
            <Text className="px-4 pb-3 text-sm text-danger-foreground">
              {statusQuery.data.memory.lastRunError}
            </Text>
          ) : statusQuery.data?.memory.lastRunAt ? (
            <Text className="px-4 pb-3 text-sm text-foreground-muted">
              Last run {formatWhen(statusQuery.data.memory.lastRunAt)}
            </Text>
          ) : null}
        </SettingsSection>
        <SettingsSection title="Models" footer="Change on desktop or web.">
          <View className="gap-2 px-4 py-3">
            <Text className="text-sm text-foreground-muted">Assistant</Text>
            <Text className="text-base text-foreground">
              {settings === null ? "…" : modelLabel(settings.defaultModel)}
            </Text>
            <Text className="pt-2 text-sm text-foreground-muted">Extraction</Text>
            <Text className="text-base text-foreground">
              {settings === null ? "…" : modelLabel(settings.extractionModel)}
            </Text>
          </View>
        </SettingsSection>
        <SettingsSection title="Embedding model">
          {models.length === 0 ? (
            <View className="px-4 py-3">
              <Text className="text-base text-foreground">{settings?.embedderId ?? "…"}</Text>
            </View>
          ) : (
            models.map((model, index) => (
              <ListChoiceRow
                key={model.id}
                label={model.label}
                description={model.description}
                selected={settings?.embedderId === model.id}
                separated={index > 0}
                disabled={settings === null}
                onPress={() => void patch({ embedderId: model.id })}
              />
            ))
          )}
        </SettingsSection>
        <SettingsSection title="Profile">
          <View className="px-4 py-3">
            <Text className="text-base text-foreground">
              {profileQuery.data?.markdown.trim() ||
                (profileQuery.isPending ? "…" : "No profile yet.")}
            </Text>
          </View>
        </SettingsSection>
        <SettingsSection
          title="Memories"
          footer={
            memoryQuery.data && memoryQuery.data.total > memoryQuery.data.rows.length
              ? `Showing ${memoryQuery.data.rows.length} of ${memoryQuery.data.total}.`
              : undefined
          }
        >
          <View className="px-4 py-3">
            <AppTextInput
              accessibilityLabel="Search memories"
              value={query}
              onChangeText={setQuery}
              placeholder="Search memories"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          {memoryQuery.error ? (
            <Text className="px-4 pb-3 text-sm text-danger-foreground">{memoryQuery.error}</Text>
          ) : null}
          {memoryQuery.data?.rows.map((memory) => (
            <MemoryRow
              key={memory.id}
              memory={memory}
              onDelete={() => void forget(memory.id, false)}
              onNeverAgain={() =>
                Dialog.alert("Forget and never relearn?", memory.text, [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Forget",
                    style: "destructive",
                    onPress: () => void forget(memory.id, true),
                  },
                ])
              }
            />
          ))}
        </SettingsSection>
        <Button
          label="Purge memory"
          tone="danger"
          disabled={environmentId === null}
          onPress={purge}
        />
      </ScrollView>
    </SettingsScreen>
  );
}

function MemoryRow(props: {
  readonly memory: MemoryRecord;
  readonly onDelete: () => void;
  readonly onNeverAgain: () => void;
}) {
  return (
    <View className="gap-2 border-t border-border-subtle px-4 py-3">
      <Text className="text-base text-foreground">{props.memory.text}</Text>
      <Text className="text-sm text-foreground-muted">
        {props.memory.kind} · {formatWhen(props.memory.updatedAt)}
        {props.memory.reason ? ` · ${props.memory.reason}` : ""}
      </Text>
      <View className="flex-row gap-4">
        <Pressable
          accessibilityRole="button"
          onPress={props.onDelete}
          className="active:opacity-70"
        >
          <Text className="text-sm font-t3-medium text-danger-foreground">Delete</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={props.onNeverAgain}
          className="active:opacity-70"
        >
          <Text className="text-sm font-t3-medium text-foreground-muted">Never relearn</Text>
        </Pressable>
      </View>
    </View>
  );
}
