import type { UniversalLearnSettings, UniversalSettingsPatch } from "@t3tools/contracts";
import { useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { AppTextInput, AppText as Text } from "../../components/ui/AppText";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { SettingsScreen } from "../../features/settings/components/SettingsScreen";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { SettingsSwitchRow } from "../../features/settings/components/SettingsSwitchRow";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { universal } from "../state";
import { useSpaceEnvironmentId } from "../useSpace";
import { RunsOnSection } from "./RunsOnSection";

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function modelLabel(selection: { readonly model: string } | null): string {
  return selection === null ? "Default" : selection.model;
}

export function LearnSettingsScreen() {
  const insets = useSafeAreaInsets();
  const environmentId = useSpaceEnvironmentId("learn");
  const settingsQuery = useEnvironmentQuery(
    environmentId === null ? null : universal.settings({ environmentId, input: {} }),
  );
  const updateSettings = useAtomCommand(universal.updateSettings, "learn settings");
  const settings = settingsQuery.data?.learn ?? null;
  const [draftTime, setDraftTime] = useState<string | null>(null);
  const [draftRetention, setDraftRetention] = useState<string | null>(null);
  const reviewTime = draftTime ?? settings?.dailyReviewTime ?? "";
  const retention = draftRetention ?? (settings === null ? "" : String(settings.desiredRetention));

  const patch = async (learn: Partial<UniversalLearnSettings>) => {
    if (environmentId === null) return;
    const input: UniversalSettingsPatch = { learn };
    const result = await updateSettings({ environmentId, input });
    if (result._tag === "Success") settingsQuery.refresh();
  };

  const saveTime = () => {
    if (!TIME.test(reviewTime)) return;
    void patch({ dailyReviewTime: reviewTime });
  };

  const saveRetention = () => {
    const value = Number(retention);
    if (!Number.isFinite(value) || value <= 0 || value >= 1) return;
    void patch({ desiredRetention: value });
  };

  return (
    <SettingsScreen title="Tutor">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-4 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
        keyboardShouldPersistTaps="handled"
      >
        <RunsOnSection space="learn" />
        {environmentId !== null && settingsQuery.isPending && settings === null ? (
          <AppActivityIndicator colorClassName="accent-icon-muted" />
        ) : null}
        {settingsQuery.error ? (
          <Text className="px-2 text-sm text-danger-foreground">{settingsQuery.error}</Text>
        ) : null}
        <SettingsSection title="Tutor model" footer="Change on desktop or web.">
          <View className="px-4 py-3">
            <Text className="text-base text-foreground">
              {modelLabel(settings?.tutorModel ?? null)}
            </Text>
          </View>
        </SettingsSection>
        <SettingsSection title="Daily review">
          <View className="gap-2 px-4 py-3">
            <Text className="text-sm text-foreground-muted">Time</Text>
            <AppTextInput
              accessibilityLabel="Daily review time"
              value={reviewTime}
              onChangeText={setDraftTime}
              onEndEditing={saveTime}
              placeholder="09:00"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          <SettingsSwitchRow
            label="Notifications"
            subtitle="Remind you when reviews are due."
            value={settings?.reviewNotifications ?? false}
            disabled={settings === null}
            onValueChange={(reviewNotifications) => void patch({ reviewNotifications })}
          />
        </SettingsSection>
        <SettingsSection
          title="Retention"
          footer="A number between 0 and 1. 0.9 keeps about nine in ten."
        >
          <View className="px-4 py-3">
            <AppTextInput
              accessibilityLabel="Desired retention"
              value={retention}
              onChangeText={setDraftRetention}
              onEndEditing={saveRetention}
              keyboardType="decimal-pad"
              placeholder="0.9"
            />
          </View>
        </SettingsSection>
        <SettingsSection title="Memory">
          <SettingsSwitchRow
            label="Use memory profile"
            subtitle="The tutor can read what Chat remembers about you."
            value={settings?.useMemoryProfile ?? false}
            disabled={settings === null}
            onValueChange={(useMemoryProfile) => void patch({ useMemoryProfile })}
          />
        </SettingsSection>
      </ScrollView>
    </SettingsScreen>
  );
}
