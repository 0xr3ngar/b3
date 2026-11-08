import { UNIVERSAL_SPACES, type UniversalSpace } from "@t3tools/contracts";
import { useNavigation } from "@react-navigation/native";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../components/ui/AppText";
import { SymbolView } from "../components/ui/AppSymbol";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { useAppearancePreferences } from "../features/settings/appearance/AppearancePreferencesProvider";
import { useEnvironmentQuery } from "../state/query";
import { StationGlyph } from "./StationGlyph";
import { universal } from "./state";
import { setSpace, useSpaceStore } from "./spaceStore";
import { useOpenThreadSpace, useSpaceEnvironmentId } from "./useSpace";

const LABELS: Record<UniversalSpace, string> = { code: "Code", chat: "Chat", learn: "Learn" };

const OPTIONS = UNIVERSAL_SPACES.map((space) => ({ value: space, label: LABELS[space] }));

/** Code · Chat · Learn, plus the Learn home card when that space is selected. */
export function UniversalThreadListHeader() {
  useOpenThreadSpace();
  const navigation = useNavigation();
  const space = useSpaceStore((current) => current.space);
  const environmentId = useSpaceEnvironmentId("learn");
  const status = useEnvironmentQuery(
    space === "learn" && environmentId !== null
      ? universal.status({ environmentId, input: {} })
      : null,
  );
  const { themeVariables } = useAppearancePreferences();
  const detail = status.data
    ? `${status.data.learn.concepts} concepts, ${status.data.learn.due} due`
    : (status.error ?? "Concepts and reviews");

  return (
    <View className="px-2 pt-2">
      <SegmentedControl
        options={OPTIONS}
        selected={space}
        onSelect={setSpace}
        size="compact"
        role="tab"
      />
      {space === "learn" ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Knowledge map, ${detail}`}
          onPress={() => navigation.navigate("LearnMap")}
          className="mt-2 flex-row items-center gap-3 rounded-2xl bg-grouped-card px-3 py-3 active:opacity-70"
        >
          <StationGlyph
            state="learning"
            color={themeVariables["--color-primary"]}
            surface={themeVariables["--color-screen"]}
            recall={0.62}
          />
          <View className="min-w-0 flex-1">
            <Text className="text-base text-foreground">Knowledge map</Text>
            <Text className="text-sm text-foreground-muted">{detail}</Text>
          </View>
          <SymbolView name="chevron.right" size={16} tintColorClassName="accent-chevron" />
        </Pressable>
      ) : null}
    </View>
  );
}
