import { AuthSettingsWriteScope, type ModelSelection } from "@t3tools/contracts";

import {
  SettingResetButton,
  SettingsRow,
  SettingsSection,
} from "../../components/settings/settingsLayout";
import { searchableSetting } from "../../components/settings/settingsSearch";
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

export function ChatAssistantSettings() {
  return (
    <SpaceSettingsPage space="chat" unavailable="Connect an environment to change the assistant.">
      {(target) => <AssistantSettings {...target} />}
    </SpaceSettingsPage>
  );
}

function AssistantSettings(props: SpaceEnvironmentTarget) {
  const settingsQuery = useEnvironmentQuery(
    universal.settings({ environmentId: props.environmentId, input: {} }),
  );
  const canWrite = useEnvironmentScope(props.environmentId, AuthSettingsWriteScope);
  const updateSettings = useAtomCommand(universal.updateSettings, {
    label: "save assistant settings",
    reportFailure: false,
  });
  const action = useUniversalAction();
  const settings = settingsQuery.data;

  const saveModel = (defaultModel: ModelSelection | null) =>
    action.run(
      "Default model not saved",
      () =>
        updateSettings({
          environmentId: props.environmentId,
          input: { chat: { defaultModel } },
        }),
      () => settingsQuery.refresh(),
    );

  return (
    <>
      <RunsOnSection
        searchId="chat-runs-on"
        description="Chat on this machine keeps its own model and memory."
        connected={props.connected}
        environmentId={props.environmentId}
        onEnvironment={props.setEnvironment}
      />
      {settings === null ? (
        <SettingsQueryMessage error={settingsQuery.error} />
      ) : (
        <SettingsSection title="Assistant">
          <SettingsRow
            {...searchableSetting("chat-default-model")}
            description="Model for new chats. Reset it to use this machine's default model."
            resetAction={
              settings.chat.defaultModel !== null ? (
                <SettingResetButton
                  label="default Chat model"
                  tooltip="Use server default"
                  disabled={!canWrite || action.pending}
                  onClick={() => void saveModel(null)}
                />
              ) : null
            }
            control={
              <ModelSettingControl
                environmentId={props.environmentId}
                selection={settings.chat.defaultModel}
                fallbackSelection={null}
                emptyLabel="Use server default"
                ariaLabel="Default Chat model"
                disabled={!canWrite || action.pending}
                onChange={(selection) => void saveModel(selection)}
              />
            }
          />
          <SettingsRow
            {...searchableSetting("chat-memory-enabled")}
            description="Save facts from chats so the assistant can use them later."
            control={
              <Switch
                checked={settings.chat.memoryEnabled}
                disabled={!canWrite || action.pending}
                aria-label="Remember things about me"
                onCheckedChange={(checked) =>
                  void action.run(
                    "Settings not saved",
                    () =>
                      updateSettings({
                        environmentId: props.environmentId,
                        input: { chat: { memoryEnabled: checked === true } },
                      }),
                    () => settingsQuery.refresh(),
                  )
                }
              />
            }
          />
          <SettingsRow
            {...searchableSetting("chat-learn-signals")}
            description="Suggest Learn topics from chats. Nothing is added until you accept it."
            control={
              <Switch
                checked={settings.chat.learnSignals}
                disabled={!canWrite || action.pending}
                aria-label="Suggest Learn topics from chats"
                onCheckedChange={(checked) =>
                  void action.run(
                    "Settings not saved",
                    () =>
                      updateSettings({
                        environmentId: props.environmentId,
                        input: { chat: { learnSignals: checked === true } },
                      }),
                    () => settingsQuery.refresh(),
                  )
                }
              />
            }
          />
        </SettingsSection>
      )}
    </>
  );
}
