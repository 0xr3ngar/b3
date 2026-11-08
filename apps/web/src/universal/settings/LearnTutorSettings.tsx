import {
  AuthSettingsWriteScope,
  type ModelSelection,
  type UniversalSettingsPatch,
} from "@t3tools/contracts";

import {
  SettingResetButton,
  SettingsRow,
  SettingsSection,
} from "../../components/settings/settingsLayout";
import { searchableSetting } from "../../components/settings/settingsSearch";
import { Input } from "../../components/ui/input";
import { Switch } from "../../components/ui/switch";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { universal } from "../state";
import { useUniversalAction } from "./command";
import { ModelSettingControl } from "./ModelSettingControl";
import { RunsOnSection } from "./RunsOnRow";
import {
  SettingsQueryMessage,
  SpaceSettingsPage,
  type SpaceEnvironmentTarget,
} from "./spaceEnvironment";
import { clampRetention, parseDailyReviewTime } from "./settingsLogic";
import { useState } from "react";

export function LearnTutorSettings() {
  return (
    <SpaceSettingsPage space="learn" unavailable="Connect an environment to change the tutor.">
      {(target) => <TutorSettings {...target} />}
    </SpaceSettingsPage>
  );
}

function TutorSettings(props: SpaceEnvironmentTarget) {
  const settingsQuery = useEnvironmentQuery(
    universal.settings({ environmentId: props.environmentId, input: {} }),
  );
  const canWrite = useEnvironmentScope(props.environmentId, AuthSettingsWriteScope);
  const updateSettings = useAtomCommand(universal.updateSettings, {
    label: "save tutor settings",
    reportFailure: false,
  });
  const action = useUniversalAction();
  const [retentionDraft, setRetentionDraft] = useState<string | null>(null);
  const settings = settingsQuery.data;
  const disabled = !canWrite || action.pending;

  const save = (patch: UniversalSettingsPatch) =>
    action.run(
      "Settings not saved",
      () => updateSettings({ environmentId: props.environmentId, input: patch }),
      () => settingsQuery.refresh(),
    );

  return (
    <>
      <RunsOnSection
        searchId="learn-runs-on"
        description="Learn on this machine keeps its own tutor and knowledge map."
        connected={props.connected}
        environmentId={props.environmentId}
        onEnvironment={props.setEnvironment}
      />
      {settings === null ? (
        <SettingsQueryMessage error={settingsQuery.error} />
      ) : (
        <SettingsSection title="Tutor">
          <SettingsRow
            {...searchableSetting("learn-tutor-model")}
            description="Model for lessons and reviews. Reset it to use this machine's default model."
            resetAction={
              settings.learn.tutorModel !== null ? (
                <SettingResetButton
                  label="tutor model"
                  tooltip="Use server default"
                  disabled={disabled}
                  onClick={() => void save({ learn: { tutorModel: null } })}
                />
              ) : null
            }
            control={
              <ModelSettingControl
                environmentId={props.environmentId}
                selection={settings.learn.tutorModel}
                fallbackSelection={null}
                emptyLabel="Use server default"
                ariaLabel="Tutor model"
                disabled={disabled}
                onChange={(tutorModel: ModelSelection) => void save({ learn: { tutorModel } })}
              />
            }
          />
          <SettingsRow
            {...searchableSetting("learn-review-time")}
            description="When the daily review starts. Turn it off to skip the schedule."
            control={
              <div className="flex items-center gap-2">
                <Switch
                  checked={settings.learn.dailyReviewTime !== null}
                  disabled={disabled}
                  aria-label="Daily review"
                  onCheckedChange={(checked) =>
                    void save({
                      learn: {
                        dailyReviewTime:
                          checked === true ? (settings.learn.dailyReviewTime ?? "09:00") : null,
                      },
                    })
                  }
                />
                {settings.learn.dailyReviewTime !== null ? (
                  <div className="w-32">
                    <Input
                      nativeInput
                      size="sm"
                      type="time"
                      aria-label="Daily review time"
                      value={settings.learn.dailyReviewTime}
                      disabled={disabled}
                      onChange={(event) => {
                        const time = parseDailyReviewTime(event.currentTarget.value);
                        if (time === null || time === settings.learn.dailyReviewTime) return;
                        void save({ learn: { dailyReviewTime: time } });
                      }}
                    />
                  </div>
                ) : null}
              </div>
            }
          />
          <SettingsRow
            {...searchableSetting("learn-review-notifications")}
            description="Notify you when reviews are due."
            control={
              <Switch
                checked={settings.learn.reviewNotifications}
                disabled={disabled}
                aria-label="Review notifications"
                onCheckedChange={(checked) =>
                  void save({ learn: { reviewNotifications: checked === true } })
                }
              />
            }
          />
          <SettingsRow
            {...searchableSetting("learn-retention")}
            description="Target chance of remembering a concept at review, from 0.80 to 0.97."
            control={
              <div className="w-24">
                <Input
                  nativeInput
                  size="sm"
                  type="number"
                  inputMode="decimal"
                  min={0.8}
                  max={0.97}
                  step={0.01}
                  aria-label="Desired retention"
                  value={retentionDraft ?? String(settings.learn.desiredRetention)}
                  disabled={disabled}
                  onChange={(event) => setRetentionDraft(event.currentTarget.value)}
                  onBlur={() => {
                    const raw = retentionDraft;
                    setRetentionDraft(null);
                    if (raw === null || raw.trim().length === 0) return;
                    const next = clampRetention(Number(raw));
                    if (next === null || next === settings.learn.desiredRetention) return;
                    void save({ learn: { desiredRetention: next } });
                  }}
                />
              </div>
            }
          />
          <SettingsRow
            {...searchableSetting("learn-use-memory")}
            description="Let the tutor read what Chat knows about you."
            control={
              <Switch
                checked={settings.learn.useMemoryProfile}
                disabled={disabled}
                aria-label="Use what Chat knows about me"
                onCheckedChange={(checked) =>
                  void save({ learn: { useMemoryProfile: checked === true } })
                }
              />
            }
          />
        </SettingsSection>
      )}
    </>
  );
}
