import type { EnvironmentId } from "@t3tools/contracts";

import { SettingsRow, SettingsSection } from "../../components/settings/settingsLayout";
import {
  searchableSetting,
  type SettingsSearchItemId,
} from "../../components/settings/settingsSearch";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import type { EnvironmentPresentation } from "../../state/environments";

export function RunsOnSection(props: {
  readonly searchId: SettingsSearchItemId;
  readonly description: string;
  readonly connected: readonly EnvironmentPresentation[];
  readonly environmentId: EnvironmentId;
  readonly onEnvironment: (environmentId: EnvironmentId) => void;
}) {
  const selected = props.connected.find(
    (environment) => environment.environmentId === props.environmentId,
  );
  return (
    <SettingsSection title="Machine" hideTitle>
      <SettingsRow
        {...searchableSetting(props.searchId)}
        description={props.description}
        control={
          <Select
            value={props.environmentId}
            onValueChange={(value) => {
              const match = props.connected.find(
                (environment) => environment.environmentId === value,
              );
              if (match) props.onEnvironment(match.environmentId);
            }}
          >
            <SelectTrigger size="sm" aria-label="Runs on">
              <SelectValue>{selected?.label ?? "Choose a machine"}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end">
              {props.connected.map((environment) => (
                <SelectItem
                  key={environment.environmentId}
                  hideIndicator
                  value={environment.environmentId}
                >
                  {environment.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
    </SettingsSection>
  );
}
