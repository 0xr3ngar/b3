import type { EnvironmentId, ModelSelection, ProviderInstanceId } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { useNavigate } from "@tanstack/react-router";

import { ProviderModelPicker } from "../../components/chat/ProviderModelPicker";
import { TraitsPicker } from "../../components/chat/TraitsPicker";
import { SETTINGS_PICKER_TRIGGER_CLASSNAME } from "../../components/settings/settingsLayout";
import { toastManager } from "../../components/ui/toast";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import {
  getCustomModelOptionsByInstance,
  resolveAppModelSelectionState,
} from "../../modelSelection";
import { providerInstanceEntriesFor } from "../../providerInstances";
import { useEnvironmentProviders } from "../../state/environments";
import { EMPTY_SERVER_PROVIDERS } from "../../state/server";

export function ModelSettingControl(props: {
  readonly environmentId: EnvironmentId;
  readonly selection: ModelSelection | null;
  readonly fallbackSelection: ModelSelection | null;
  readonly emptyLabel: string;
  readonly ariaLabel: string;
  readonly disabled: boolean;
  readonly onChange: (selection: ModelSelection) => void;
}) {
  const settings = useEnvironmentSettings(props.environmentId);
  const providersByEnvironment = useEnvironmentProviders();
  const navigate = useNavigate();
  const providers = providersByEnvironment.get(props.environmentId) ?? EMPTY_SERVER_PROVIDERS;
  const textProviders = providers.filter((provider) => provider.supportsTextGeneration !== false);
  const entries = providerInstanceEntriesFor(textProviders, settings, null);
  const basis = props.selection ?? props.fallbackSelection;
  const resolved = resolveAppModelSelectionState(
    {
      ...settings,
      textGenerationModelSelection: basis ?? settings.textGenerationModelSelection,
    },
    textProviders,
  );
  const modelOptions = getCustomModelOptionsByInstance(
    settings,
    textProviders,
    resolved.instanceId,
    resolved.model,
  );
  const entry = entries.find((candidate) => candidate.instanceId === resolved.instanceId);
  const unavailable = (instanceId: ProviderInstanceId, model: string) => {
    const candidate = entries.find((item) => item.instanceId === instanceId);
    const options = modelOptions.get(instanceId);
    if (
      !candidate?.enabled ||
      !candidate.isAvailable ||
      !options?.some((option) => option.slug === model && option.isUnavailable !== true)
    ) {
      return "This model is unavailable on this environment.";
    }
    return null;
  };

  if (resolved.model === "" || entry === undefined) {
    return <span className="text-sm text-muted-foreground">No providers available</span>;
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
      <ProviderModelPicker
        environmentId={props.environmentId}
        activeInstanceId={resolved.instanceId}
        model={resolved.model}
        lockedProvider={null}
        instanceEntries={entries}
        modelOptionsByInstance={modelOptions}
        triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
        triggerAriaLabel={props.ariaLabel}
        {...(props.selection === null ? { triggerLabel: props.emptyLabel } : {})}
        disabled={props.disabled}
        getModelDisabledReason={unavailable}
        onOpenProviderSetup={(instanceId) => {
          void navigate({
            to: "/settings/providers",
            search: { environmentId: props.environmentId, instanceId },
          });
        }}
        onInstanceModelChange={(instanceId, model) => {
          const reason = unavailable(instanceId, model);
          if (reason !== null) {
            toastManager.add({ type: "error", title: "Model not saved", description: reason });
            return;
          }
          props.onChange(createModelSelection(instanceId, model));
        }}
      />
      <TraitsPicker
        provider={entry.driverKind}
        models={entry.models}
        model={resolved.model}
        modelOptions={props.selection?.options ?? resolved.options ?? []}
        allowPromptInjectedEffort={false}
        planModeEnabled={settings.planModeEnabled}
        triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
        disabled={props.disabled}
        onModelOptionsChange={(options) =>
          props.onChange(createModelSelection(resolved.instanceId, resolved.model, options))
        }
      />
    </div>
  );
}
