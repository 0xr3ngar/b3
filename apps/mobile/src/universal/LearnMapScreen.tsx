import {
  type LearnMap,
  type LearnMapLine,
  type LearnMapStation,
  type LearnStartInput,
  type LearnStationState,
} from "@t3tools/contracts";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppBar } from "../components/ui/AppBar";
import { AppActivityIndicator } from "../components/ui/AppActivityIndicator";
import { AppText as Text } from "../components/ui/AppText";
import { Button } from "../components/ui/Button";
import { ScreenScrollView as ScrollView } from "../components/ui/ScreenScrollView";
import { useAppearancePreferences } from "../features/settings/appearance/AppearancePreferencesProvider";
import { useSelectWorkspaceDetail } from "../features/layout/workspace/useSelectWorkspaceDetail";
import type { MobileThemeVariable, MobileThemeVariables } from "../lib/mobileTheme";
import { useEnvironmentQuery } from "../state/query";
import { useAtomCommand } from "../state/use-atom-command";
import { StationGlyph } from "./StationGlyph";
import { universal } from "./state";
import { useSpaceEnvironmentId } from "./useSpace";

const LINE_COLOR: Record<string, MobileThemeVariable> = {
  primary: "--color-primary",
  success: "--color-primary",
  warning: "--color-warning",
  info: "--color-primary",
  rust: "--color-warning",
  span: "--color-foreground",
};

const STATE_LABEL: Record<LearnStationState, string> = {
  solid: "Solid",
  learning: "Learning",
  due: "Due",
  ready: "Ready",
  locked: "Locked",
  suggested: "Suggested",
};

function lineColor(token: string, colors: MobileThemeVariables): string {
  if (token.startsWith("#") || token.startsWith("rgb")) return token;
  return colors[LINE_COLOR[token] ?? "--color-primary"];
}

function stationSubtitle(station: LearnMapStation, lines: readonly LearnMapLine[]): string {
  const names = lines.filter((line) => station.lineIds.includes(line.id)).map((line) => line.title);
  const recall = station.recall === null ? null : `Recall ${Math.round(station.recall * 100)}%`;
  return [names.join(", "), STATE_LABEL[station.state], recall, station.note]
    .filter((part) => part !== null && part.length > 0)
    .join(" · ");
}

export function LearnMapScreen() {
  const insets = useSafeAreaInsets();
  const environmentId = useSpaceEnvironmentId("learn");
  const mapQuery = useEnvironmentQuery(
    environmentId === null ? null : universal.learnMap({ environmentId, input: {} }),
  );
  const statusQuery = useEnvironmentQuery(
    environmentId === null ? null : universal.status({ environmentId, input: {} }),
  );
  const learnStart = useAtomCommand(universal.learnStart, "learn start");
  const selectDetail = useSelectWorkspaceDetail();
  const { themeVariables } = useAppearancePreferences();
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const map = mapQuery.data;
  const selected =
    map?.stations.find((station) => station.id === pickedId) ??
    map?.stations.find((station) => station.id === map.here) ??
    map?.stations[0] ??
    null;
  const dueCount =
    statusQuery.data?.learn.due ??
    map?.stations.filter((station) => station.state === "due").length ??
    0;
  const surface = themeVariables["--color-screen"];
  const warning = themeVariables["--color-warning"];

  const start = async (input: LearnStartInput) => {
    if (environmentId === null || starting) return;
    setStarting(true);
    const result = await learnStart({ environmentId, input });
    setStarting(false);
    if (result._tag !== "Success") return;
    selectDetail({
      name: "Thread",
      params: {
        environmentId: String(environmentId),
        threadId: String(result.value.threadId),
      },
    });
  };

  return (
    <View className="flex-1 bg-screen">
      <AppBar title="Knowledge map" />
      {/* TransitMap mounts above the sheet. */}
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-4 px-4 py-3"
        keyboardShouldPersistTaps="handled"
      >
        {environmentId === null ? (
          <Text className="text-sm text-foreground-muted">Connect an environment to learn.</Text>
        ) : mapQuery.isPending && map === null ? (
          <AppActivityIndicator colorClassName="accent-icon-muted" />
        ) : mapQuery.error ? (
          <Text className="text-sm text-danger-foreground">{mapQuery.error}</Text>
        ) : map === null || map.stations.length === 0 ? (
          <Text className="text-sm text-foreground-muted">No stops yet.</Text>
        ) : (
          <StationGroups
            map={map}
            selectedId={selected?.id ?? null}
            surface={surface}
            warning={warning}
            colors={themeVariables}
            onSelect={setPickedId}
          />
        )}
      </ScrollView>
      <View
        className="gap-3 border-t border-border-subtle bg-card px-4 pt-3"
        style={{ paddingBottom: Math.max(insets.bottom, 12) }}
      >
        {selected ? (
          <View className="gap-1">
            <Text className="text-sm text-foreground-muted">
              {stationSubtitle(selected, map?.lines ?? [])}
            </Text>
            <Text className="text-xl font-t3-bold text-foreground">{selected.title}</Text>
            {selected.misconception ? (
              <Text className="text-sm text-foreground-muted">{selected.misconception}</Text>
            ) : null}
          </View>
        ) : (
          <Text className="text-sm text-foreground-muted">Tap a stop.</Text>
        )}
        <View className="flex-row gap-2">
          {selected ? (
            <View className="flex-1">
              <Button
                fullWidth
                tone="primary"
                label={selected.state === "due" ? "Review now" : "Start lesson"}
                loading={starting}
                disabled={environmentId === null}
                onPress={() =>
                  void start(
                    selected.state === "due"
                      ? { kind: "review", conceptIds: [selected.id] }
                      : { kind: "lesson", conceptIds: [selected.id] },
                  )
                }
              />
            </View>
          ) : null}
          {dueCount > 0 ? (
            <View className="flex-1">
              <Button
                fullWidth
                tone={selected ? "secondary" : "primary"}
                label={`Review due (${dueCount})`}
                loading={starting && selected === null}
                disabled={environmentId === null}
                onPress={() => void start({ kind: "review" })}
              />
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function StationGroups(props: {
  readonly map: LearnMap;
  readonly selectedId: string | null;
  readonly surface: string;
  readonly warning: string;
  readonly colors: MobileThemeVariables;
  readonly onSelect: (id: string) => void;
}) {
  const grouped = new Set<string>();
  const sections = props.map.lines.map((line) => {
    const stations = props.map.stations.filter((station) => station.lineIds.includes(line.id));
    for (const station of stations) grouped.add(station.id);
    return { line, stations };
  });
  const rest = props.map.stations.filter((station) => !grouped.has(station.id));
  return (
    <View className="gap-4">
      {sections.map((section) =>
        section.stations.length === 0 ? null : (
          <StationSection
            key={section.line.id}
            title={section.line.title}
            stations={section.stations}
            color={lineColor(section.line.color, props.colors)}
            selectedId={props.selectedId}
            surface={props.surface}
            warning={props.warning}
            onSelect={props.onSelect}
          />
        ),
      )}
      {rest.length === 0 ? null : (
        <StationSection
          title="Other"
          stations={rest}
          color={props.colors["--color-primary"]}
          selectedId={props.selectedId}
          surface={props.surface}
          warning={props.warning}
          onSelect={props.onSelect}
        />
      )}
    </View>
  );
}

function StationSection(
  props: {
    readonly title: string;
    readonly stations: readonly LearnMapStation[];
    readonly color: string;
  } & Pick<Parameters<typeof StationGroups>[0], "selectedId" | "surface" | "warning" | "onSelect">,
) {
  return (
    <View className="gap-1">
      <Text className="px-1 text-sm font-t3-medium text-foreground-muted">{props.title}</Text>
      {props.stations.map((station) => {
        const selected = station.id === props.selectedId;
        const color = station.state === "due" ? props.warning : props.color;
        return (
          <Pressable
            key={station.id}
            accessibilityRole="button"
            accessibilityLabel={station.title}
            accessibilityState={{ selected }}
            onPress={() => props.onSelect(station.id)}
            className={
              selected
                ? "flex-row items-center gap-3 rounded-xl bg-thread-selected px-2 py-2"
                : "flex-row items-center gap-3 rounded-xl px-2 py-2 active:opacity-70"
            }
          >
            <StationGlyph
              state={station.state}
              color={color}
              surface={props.surface}
              recall={station.recall}
            />
            <View className="min-w-0 flex-1">
              <Text className="text-base text-foreground">{station.title}</Text>
              <Text className="text-sm text-foreground-muted">{STATE_LABEL[station.state]}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
