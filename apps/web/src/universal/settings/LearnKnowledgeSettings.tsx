import { AuthOrchestrationOperateScope, type LearnMap } from "@t3tools/contracts";
import { useState } from "react";

import { searchableSetting } from "../../components/settings/settingsSearch";
import { SettingsSection } from "../../components/settings/settingsLayout";
import { Button } from "../../components/ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../../components/ui/collapsible";
import { requestConfirmDialog } from "../../confirmDialog";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { universal } from "../state";
import { useUniversalAction } from "./command";
import { RunsOnSection } from "./RunsOnRow";
import {
  SettingsQueryMessage,
  SpaceSettingsPage,
  type SpaceEnvironmentTarget,
} from "./spaceEnvironment";

export function LearnKnowledgeSettings() {
  return (
    <SpaceSettingsPage
      space="learn"
      unavailable="Connect an environment to change the knowledge map."
    >
      {(target) => <KnowledgeSettings {...target} />}
    </SpaceSettingsPage>
  );
}

function downloadLearnMap(map: LearnMap) {
  const blob = new Blob([JSON.stringify(map, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "learn-map.json";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function KnowledgeSettings(props: SpaceEnvironmentTarget) {
  const mapQuery = useEnvironmentQuery(
    universal.learnMap({ environmentId: props.environmentId, input: {} }),
  );
  const canOperate = useEnvironmentScope(props.environmentId, AuthOrchestrationOperateScope);
  const learnAction = useAtomCommand(universal.learnAction, {
    label: "learn map action",
    reportFailure: false,
  });
  const action = useUniversalAction();
  const map = mapQuery.data;
  const disabled = !canOperate || action.pending;

  const run = (
    title: string,
    kind: "delete_line" | "reset_concept" | "accept_suggestion" | "dismiss_suggestion",
    id: string,
  ) =>
    action.run(
      title,
      () =>
        learnAction({
          environmentId: props.environmentId,
          input: { action: kind, id },
        }),
      () => mapQuery.refresh(),
    );

  const deleteLine = async (id: string, title: string) => {
    const confirmed = await requestConfirmDialog(
      `Delete “${title}” and its progress? This cannot be undone.`,
      { variant: "destructive" },
    );
    if (confirmed !== true) return;
    await run("Could not delete topic", "delete_line", id);
  };

  return (
    <>
      <RunsOnSection
        searchId="knowledge-runs-on"
        description="The knowledge map lives on this machine."
        connected={props.connected}
        environmentId={props.environmentId}
        onEnvironment={props.setEnvironment}
      />
      {map === null ? (
        <SettingsQueryMessage error={mapQuery.error} />
      ) : (
        <>
          <SettingsSection
            {...searchableSetting("learn-topics")}
            headerAction={
              <Button size="sm" variant="outline" onClick={() => downloadLearnMap(map)}>
                Export map
              </Button>
            }
          >
            {map.lines.length === 0 ? (
              <p className="px-3 py-3 text-sm text-muted-foreground sm:px-4">No topics yet.</p>
            ) : (
              map.lines.map((line) => (
                <TopicRow
                  key={line.id}
                  map={map}
                  lineId={line.id}
                  title={line.title}
                  color={line.color}
                  disabled={disabled}
                  onDelete={() => void deleteLine(line.id, line.title)}
                  onReset={(conceptId) =>
                    void run("Could not reset progress", "reset_concept", conceptId)
                  }
                />
              ))
            )}
          </SettingsSection>
          <SettingsSection {...searchableSetting("learn-suggestions")}>
            {map.stations.filter((station) => station.state === "suggested").length === 0 ? (
              <p className="px-3 py-3 text-sm text-muted-foreground sm:px-4">No suggestions.</p>
            ) : (
              map.stations
                .filter((station) => station.state === "suggested")
                .map((station) => (
                  <div
                    key={station.id}
                    className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4"
                  >
                    <p className="min-w-0 text-sm wrap-anywhere">{station.title}</p>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={disabled}
                        onClick={() =>
                          void run("Could not accept suggestion", "accept_suggestion", station.id)
                        }
                      >
                        Accept
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={disabled}
                        onClick={() =>
                          void run("Could not dismiss suggestion", "dismiss_suggestion", station.id)
                        }
                      >
                        Dismiss
                      </Button>
                    </div>
                  </div>
                ))
            )}
          </SettingsSection>
        </>
      )}
    </>
  );
}

function TopicRow(props: {
  readonly map: LearnMap;
  readonly lineId: string;
  readonly title: string;
  readonly color: string;
  readonly disabled: boolean;
  readonly onDelete: () => void;
  readonly onReset: (conceptId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const concepts = props.map.stations.filter(
    (station) => station.state !== "suggested" && station.lineIds.includes(props.lineId),
  );
  const due = concepts.filter((station) => station.state === "due").length;
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm">
          <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: props.color }} />
          <span className="truncate font-medium">{props.title}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {concepts.length} {concepts.length === 1 ? "concept" : "concepts"}
            {due > 0 ? ` · ${due} due` : ""}
          </span>
        </CollapsibleTrigger>
        <Button
          size="sm"
          variant="ghost-destructive"
          disabled={props.disabled}
          onClick={props.onDelete}
        >
          Delete topic
        </Button>
      </div>
      <CollapsiblePanel>
        {concepts.length === 0 ? (
          <p className="px-3 pb-3 text-sm text-muted-foreground sm:px-4">No concepts.</p>
        ) : (
          <ul className="pb-2">
            {concepts.map((station) => (
              <li
                key={station.id}
                className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:px-4"
              >
                <span className="min-w-0 text-sm wrap-anywhere">{station.title}</span>
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={props.disabled}
                  onClick={() => props.onReset(station.id)}
                >
                  Reset progress
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CollapsiblePanel>
    </Collapsible>
  );
}
