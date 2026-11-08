import { ListChoiceRow } from "../../components/ui/ListChoiceRow";
import { useWorkspaceEnvironments } from "../../state/workspace";
import { setSpaceEnvironment } from "../spaceStore";
import { useSpaceEnvironmentId } from "../useSpace";
import { SettingsSection } from "../../features/settings/components/SettingsSection";

export function RunsOnSection(props: { readonly space: "chat" | "learn" }) {
  const environments = useWorkspaceEnvironments().filter((environment) => environment.isEnabled);
  const environmentId = useSpaceEnvironmentId(props.space);
  return (
    <SettingsSection
      title="Runs on"
      footer={environments.length === 0 ? "Connect an environment first." : undefined}
    >
      {environments.map((environment, index) => (
        <ListChoiceRow
          key={environment.environmentId}
          label={environment.environmentLabel}
          selected={environment.environmentId === environmentId}
          separated={index > 0}
          onPress={() => setSpaceEnvironment(props.space, environment.environmentId)}
        />
      ))}
    </SettingsSection>
  );
}
