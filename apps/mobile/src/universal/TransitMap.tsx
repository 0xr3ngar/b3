import type { LearnMap, LearnMapStation } from "@t3tools/contracts";
import { prerequisiteClosure } from "@t3tools/universal-learn/graph";
import { layoutFor } from "@t3tools/universal-learn/mapModel";
import {
  focusSet,
  OTHER_LINE_ID,
  roundedPath,
  type LabelAt,
  type TransitLayout,
} from "@t3tools/universal-learn/transit";
import { useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, View, type LayoutChangeEvent } from "react-native";
import {
  GestureDetector,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
} from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import Svg, { Circle, G, Path, Rect, Text as SvgText } from "react-native-svg";

import { SymbolView } from "../components/ui/AppSymbol";
import type { MobileThemeVariables } from "../lib/mobileTheme";
import { learnLineColor } from "./learnColors";

export type MapFocus =
  | { readonly kind: "stop"; readonly id: string }
  | { readonly kind: "line"; readonly id: string }
  | { readonly kind: "route"; readonly id: string; readonly path: readonly string[] };

interface Fit {
  readonly scale: number;
  readonly minScale: number;
  readonly maxScale: number;
  readonly tx: number;
  readonly ty: number;
}

interface MapColors {
  readonly surface: string;
  readonly foreground: string;
  readonly muted: string;
  readonly primary: string;
  readonly onPrimary: string;
  readonly warning: string;
  readonly danger: string;
}

export function TransitMap(props: {
  readonly map: LearnMap;
  readonly focus: MapFocus | null;
  readonly colors: MobileThemeVariables;
  readonly onSelectStop: (id: string) => void;
  readonly onSelectLine: (id: string) => void;
  readonly onClear: () => void;
}) {
  const layout = useMemo(() => layoutFor(props.map), [props.map]);
  const colors = mapColors(props.colors);
  const lit = litIds(props.map, props.focus);
  const ringId =
    props.focus?.kind === "stop" || props.focus?.kind === "route" ? props.focus.id : null;
  const routeD = props.focus?.kind === "route" ? routeGeometry(layout, props.focus.path) : "";
  const byId = new Map(props.map.stations.map((station) => [station.id, station]));
  const lines = new Map(props.map.lines.map((line) => [line.id, line]));
  const here = props.map.here
    ? layout.stations.find((station) => station.id === props.map.here)
    : undefined;
  const hereAway = lit !== null && (props.map.here === null || !lit.has(props.map.here));

  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const minScale = useSharedValue(0.2);
  const maxScale = useSharedValue(4);
  const savedScale = useSharedValue(1);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);
  const startFocalX = useSharedValue(0);
  const startFocalY = useSharedValue(0);
  const viewportW = useSharedValue(0);
  const viewportH = useSharedValue(0);
  const mapW = useSharedValue(layout.width);
  const mapH = useSharedValue(layout.height);
  const [ready, setReady] = useState(false);

  const applyFit = (next: Fit) => {
    scale.set(next.scale);
    minScale.set(next.minScale);
    maxScale.set(next.maxScale);
    tx.set(next.tx);
    ty.set(next.ty);
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the fitted transform follows a new map size in Reanimated shared values
  useLayoutEffect(() => {
    mapW.set(layout.width);
    mapH.set(layout.height);
    const width = viewportW.value;
    const height = viewportH.value;
    if (width <= 0 || height <= 0) return;
    const next = fitTransform(width, height, layout.width, layout.height);
    scale.set(next.scale);
    minScale.set(next.minScale);
    maxScale.set(next.maxScale);
    tx.set(next.tx);
    ty.set(next.ty);
  }, [
    layout.height,
    layout.width,
    mapH,
    mapW,
    maxScale,
    minScale,
    scale,
    tx,
    ty,
    viewportH,
    viewportW,
  ]);

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width <= 0 || height <= 0) return;
    const changed =
      Math.abs(viewportW.value - width) > 0.5 || Math.abs(viewportH.value - height) > 0.5;
    viewportW.set(width);
    viewportH.set(height);
    if (changed) applyFit(fitTransform(width, height, mapW.value, mapH.value));
    setReady(true);
  };

  const onFit = () => {
    applyFit(fitTransform(viewportW.value, viewportH.value, mapW.value, mapH.value));
  };

  const pan = usePanGesture({
    maxPointers: 1,
    minDistance: 8,
    onActivate: () => {
      "worklet";
      savedTx.set(tx.value);
      savedTy.set(ty.value);
    },
    onUpdate: (event) => {
      "worklet";
      tx.set(savedTx.value + event.translationX);
      ty.set(savedTy.value + event.translationY);
    },
  });
  const pinch = usePinchGesture({
    onActivate: (event) => {
      "worklet";
      savedScale.set(scale.value);
      savedTx.set(tx.value);
      savedTy.set(ty.value);
      startFocalX.set(event.focalX);
      startFocalY.set(event.focalY);
    },
    onUpdate: (event) => {
      "worklet";
      const base = savedScale.value === 0 ? 1 : savedScale.value;
      const next = Math.min(maxScale.value, Math.max(minScale.value, base * event.scale));
      const contentX = (startFocalX.value - savedTx.value) / base;
      const contentY = (startFocalY.value - savedTy.value) / base;
      scale.set(next);
      tx.set(event.focalX - contentX * next);
      ty.set(event.focalY - contentY * next);
    },
  });
  const gesture = useSimultaneousGestures(pan, pinch);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  return (
    <View className="flex-1">
      <GestureDetector gesture={gesture}>
        <View className="flex-1 overflow-hidden" collapsable={false} onLayout={onLayout}>
          <Animated.View
            collapsable={false}
            style={[
              {
                width: layout.width,
                height: layout.height,
                opacity: ready ? 1 : 0,
                // Scale stays around the top-left, so translate is in screen pixels.
                transformOrigin: "left top",
              },
              animatedStyle,
            ]}
          >
            <Svg width={layout.width} height={layout.height}>
              <Rect
                x={0}
                y={0}
                width={layout.width}
                height={layout.height}
                fill={colors.surface}
                onPress={props.onClear}
              />
              {routeD ? (
                <G>
                  <Path
                    d={routeD}
                    fill="none"
                    stroke={colors.primary}
                    strokeWidth={12}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={0.22}
                  />
                  <Path
                    d={routeD}
                    fill="none"
                    stroke={colors.primary}
                    strokeWidth={2.2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray="2 5"
                  />
                </G>
              ) : null}
              <G>
                {layout.stubs.map((stub) => {
                  const shown = lit === null || originLit(props.map, stub.lineId, lit);
                  const line = lines.get(stub.lineId);
                  return (
                    <Path
                      key={stub.lineId}
                      d={roundedPath(stub.points)}
                      fill="none"
                      stroke={
                        stub.lineId === OTHER_LINE_ID
                          ? colors.muted
                          : line
                            ? learnLineColor(line.color, props.colors)
                            : colors.foreground
                      }
                      strokeWidth={lit !== null && shown ? 7 : 6}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      opacity={shown ? 1 : 0.15}
                    />
                  );
                })}
                {layout.segments.map((segment) => {
                  const shown = lit === null || (lit.has(segment.from) && lit.has(segment.to));
                  const line = segment.lineId ? lines.get(segment.lineId) : undefined;
                  const track = segment.kind === "track";
                  return (
                    <Path
                      key={`${segment.from}:${segment.to}:${segment.kind}`}
                      d={roundedPath(segment.points)}
                      fill="none"
                      stroke={
                        track && line ? learnLineColor(line.color, props.colors) : colors.muted
                      }
                      strokeWidth={
                        segment.kind === "link"
                          ? 1.2
                          : segment.kind === "planned"
                            ? 3
                            : lit !== null && shown
                              ? 7
                              : 6
                      }
                      strokeDasharray={
                        segment.kind === "planned"
                          ? "1 7"
                          : segment.kind === "link"
                            ? "2 3"
                            : undefined
                      }
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      opacity={shown ? 1 : 0.15}
                    />
                  );
                })}
              </G>
              <G>
                {layout.stations.map((laid) => {
                  const station = byId.get(laid.id);
                  if (!station) return null;
                  const dim = lit !== null && !lit.has(station.id);
                  const label = labelOrigin(laid.x, laid.y, laid.labelAt, laid.interchange);
                  const subtitle = stationSubtitle(station, station.id === props.map.here);
                  const muted = station.state === "locked" || station.state === "suggested";
                  return (
                    <G
                      key={station.id}
                      accessibilityLabel={station.title}
                      opacity={dim ? 0.15 : 1}
                      onPress={() => props.onSelectStop(station.id)}
                    >
                      <StationMark
                        x={laid.x}
                        y={laid.y}
                        state={station.state}
                        recall={station.recall}
                        color={stationColor(props.map, station, props.colors, colors.foreground)}
                        surface={colors.surface}
                        foreground={colors.foreground}
                        muted={colors.muted}
                        warning={colors.warning}
                        danger={colors.danger}
                        onPrimary={colors.onPrimary}
                        interchange={laid.interchange}
                        badge={station.misconception !== null}
                      />
                      <HaloText
                        x={label.x}
                        y={label.y}
                        fill={muted ? colors.muted : colors.foreground}
                        halo={colors.surface}
                        fontSize={12.5}
                        fontWeight={laid.interchange ? "800" : muted ? "500" : "600"}
                        textAnchor={label.anchor}
                      >
                        {station.title}
                      </HaloText>
                      {subtitle ? (
                        <HaloText
                          x={label.x}
                          y={label.y + 13}
                          fill={colors.muted}
                          halo={colors.surface}
                          fontSize={10.5}
                          fontWeight="500"
                          textAnchor={label.anchor}
                        >
                          {subtitle}
                        </HaloText>
                      ) : null}
                      {ringId === station.id ? (
                        <Circle
                          cx={laid.x}
                          cy={laid.y}
                          r={laid.interchange ? 15 : 13.5}
                          fill="none"
                          stroke={colors.foreground}
                          strokeWidth={1.6}
                        />
                      ) : null}
                      <Circle cx={laid.x} cy={laid.y} r={17} fill="transparent" />
                    </G>
                  );
                })}
              </G>
              <G>
                {layout.bullets.map((bullet) => {
                  const line = lines.get(bullet.lineId);
                  const other = bullet.lineId === OTHER_LINE_ID;
                  if (!line && !other) return null;
                  const title = line?.title ?? "Other";
                  const dim =
                    lit !== null &&
                    !props.map.stations.some(
                      (station) => lit.has(station.id) && onLine(station, bullet.lineId),
                    );
                  return (
                    <G
                      key={bullet.lineId}
                      accessibilityLabel={title}
                      opacity={dim ? 0.15 : 1}
                      onPress={() => props.onSelectLine(bullet.lineId)}
                    >
                      <Rect
                        x={bullet.x}
                        y={bullet.y - 9}
                        width={bullet.width}
                        height={18}
                        rx={4}
                        fill={
                          other
                            ? colors.muted
                            : line
                              ? learnLineColor(line.color, props.colors)
                              : colors.foreground
                        }
                      />
                      <SvgText
                        x={bullet.x + bullet.width / 2}
                        y={bullet.y + 3.8}
                        fill={other ? colors.surface : colors.onPrimary}
                        fontSize={11}
                        fontWeight="800"
                        textAnchor="middle"
                      >
                        {title}
                      </SvgText>
                    </G>
                  );
                })}
              </G>
              {here ? (
                <G opacity={hereAway ? 0.15 : 1}>
                  <Path d={herePin(here.x, here.y).d} fill={colors.foreground} />
                  <SvgText
                    x={here.x}
                    y={herePin(here.x, here.y).textY}
                    fill={colors.surface}
                    fontSize={10.5}
                    fontWeight="700"
                    textAnchor="middle"
                  >
                    You are here
                  </SvgText>
                </G>
              ) : null}
            </Svg>
          </Animated.View>
        </View>
      </GestureDetector>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Fit map"
        onPress={onFit}
        className="absolute end-3 bottom-3 size-11 items-center justify-center rounded-full bg-card active:opacity-70"
      >
        <SymbolView
          name="arrow.down.right.and.arrow.up.left"
          size={20}
          tintColor={colors.foreground}
        />
      </Pressable>
    </View>
  );
}

function HaloText(props: {
  readonly x: number;
  readonly y: number;
  readonly fill: string;
  readonly halo: string;
  readonly fontSize: number;
  readonly fontWeight: "500" | "600" | "700" | "800";
  readonly textAnchor: "start" | "middle" | "end";
  readonly children: string;
}) {
  return (
    <>
      <SvgText
        x={props.x}
        y={props.y}
        fill="none"
        stroke={props.halo}
        strokeWidth={4}
        strokeLinejoin="round"
        fontSize={props.fontSize}
        fontWeight={props.fontWeight}
        textAnchor={props.textAnchor}
      >
        {props.children}
      </SvgText>
      <SvgText
        x={props.x}
        y={props.y}
        fill={props.fill}
        fontSize={props.fontSize}
        fontWeight={props.fontWeight}
        textAnchor={props.textAnchor}
      >
        {props.children}
      </SvgText>
    </>
  );
}

function StationMark(props: {
  readonly x: number;
  readonly y: number;
  readonly state: LearnMapStation["state"];
  readonly recall: number | null;
  readonly color: string;
  readonly surface: string;
  readonly foreground: string;
  readonly muted: string;
  readonly warning: string;
  readonly danger: string;
  readonly onPrimary: string;
  readonly interchange: boolean;
  readonly badge: boolean;
}) {
  const { x, y } = props;
  const radius = 6.5;
  let mark: ReactNode;
  if (props.interchange && props.state === "solid") {
    mark = (
      <Rect
        x={x - 9}
        y={y - 9}
        width={18}
        height={18}
        rx={9}
        fill={props.surface}
        stroke={props.foreground}
        strokeWidth={2.6}
      />
    );
  } else if (props.state === "solid") {
    mark = (
      <Circle
        cx={x}
        cy={y}
        r={radius}
        fill={props.color}
        stroke={props.surface}
        strokeWidth={2.5}
      />
    );
  } else if (props.state === "learning") {
    const pie = recallPie(x, y, radius - 2.2, props.recall ?? 0);
    mark = (
      <>
        <Circle
          cx={x}
          cy={y}
          r={radius}
          fill={props.surface}
          stroke={props.color}
          strokeWidth={2.5}
        />
        {pie ? <Path d={pie} fill={props.color} /> : null}
      </>
    );
  } else if (props.state === "ready") {
    mark = (
      <Circle
        cx={x}
        cy={y}
        r={radius}
        fill={props.surface}
        stroke={props.color}
        strokeWidth={2.2}
        strokeDasharray="2.6 2"
      />
    );
  } else if (props.state === "due") {
    const reach = radius + 1.8;
    mark = (
      <Path
        d={`M${x},${y - reach} L${x + reach},${y} L${x},${y + reach} L${x - reach},${y} Z`}
        fill={props.warning}
        stroke={props.surface}
        strokeWidth={2.5}
        strokeLinejoin="round"
      />
    );
  } else if (props.state === "locked") {
    mark = (
      <Path
        d={`M${x - 7},${y} H${x + 7}`}
        stroke={props.muted}
        strokeWidth={3}
        strokeLinecap="round"
      />
    );
  } else {
    mark = (
      <Circle
        cx={x}
        cy={y}
        r={radius}
        fill="none"
        stroke={props.muted}
        strokeWidth={1.6}
        strokeDasharray="1.5 2.5"
      />
    );
  }
  const badgeX = x + 9;
  const badgeY = y - 9;
  return (
    <>
      {mark}
      {props.badge ? (
        <>
          <Circle
            cx={badgeX}
            cy={badgeY}
            r={5.5}
            fill={props.danger}
            stroke={props.surface}
            strokeWidth={2}
          />
          <Path
            d={`M${badgeX},${badgeY - 2.5} v3`}
            stroke={props.onPrimary}
            strokeWidth={1.6}
            strokeLinecap="round"
          />
          <Circle cx={badgeX} cy={badgeY + 2.7} r={0.9} fill={props.onPrimary} />
        </>
      ) : null}
    </>
  );
}

function mapColors(colors: MobileThemeVariables): MapColors {
  return {
    surface: colors["--color-screen"],
    foreground: colors["--color-foreground"],
    muted: colors["--color-foreground-muted"],
    primary: colors["--color-primary"],
    onPrimary: colors["--color-primary-foreground"],
    warning: colors["--color-warning"],
    danger: colors["--color-danger"],
  };
}

function fitTransform(viewportW: number, viewportH: number, mapW: number, mapH: number): Fit {
  const safeW = mapW > 0 ? mapW : 1;
  const safeH = mapH > 0 ? mapH : 1;
  const viewW = viewportW > 0 ? viewportW : safeW;
  const viewH = viewportH > 0 ? viewportH : safeH;
  const fit = Math.min(viewW / safeW, viewH / safeH);
  return {
    scale: fit,
    minScale: fit * (908 / 1600),
    maxScale: Math.max(fit, fit * (908 / 320)),
    tx: (viewW - safeW * fit) / 2,
    ty: (viewH - safeH * fit) / 2,
  };
}

function litIds(map: LearnMap, focus: MapFocus | null): ReadonlySet<string> | null {
  if (focus === null) return null;
  if (focus.kind === "stop") return focusSet(map.edges, focus.id);
  if (focus.kind === "line") {
    const ids = new Set<string>();
    for (const station of map.stations) {
      if (onLine(station, focus.id)) ids.add(station.id);
    }
    return ids;
  }
  const ids = new Set<string>(focus.path);
  const start = focus.path[0];
  if (start !== undefined) {
    for (const id of prerequisiteClosure(map.edges, start)) ids.add(id);
  }
  return ids;
}

function onLine(station: LearnMapStation, lineId: string): boolean {
  if (lineId === OTHER_LINE_ID) {
    return station.lineIds.length === 0 && station.state !== "suggested";
  }
  return station.lineIds.includes(lineId);
}

function originLit(map: LearnMap, lineId: string, lit: ReadonlySet<string>): boolean {
  for (const station of map.stations) {
    if (!lit.has(station.id) || !onLine(station, lineId)) continue;
    if (!map.edges.some((edge) => edge.to === station.id)) return true;
  }
  return false;
}

function routeGeometry(layout: TransitLayout, path: readonly string[]): string {
  const at = new Map(layout.stations.map((station) => [station.id, station]));
  let d = "";
  for (let index = 0; index < path.length - 1; index += 1) {
    const from = path[index];
    const to = path[index + 1];
    if (from === undefined || to === undefined) continue;
    const segment = layout.segments.find((item) => item.from === from && item.to === to);
    if (segment) {
      d += `${roundedPath(segment.points)} `;
      continue;
    }
    const start = at.get(from);
    const end = at.get(to);
    if (start && end) d += `M${start.x},${start.y} L${end.x},${end.y} `;
  }
  return d;
}

function labelOrigin(
  x: number,
  y: number,
  at: LabelAt,
  interchange: boolean,
): { readonly x: number; readonly y: number; readonly anchor: "start" | "middle" | "end" } {
  const gap = 13 + (interchange ? 3 : 0);
  let nextX = x;
  let anchor: "start" | "middle" | "end" = "middle";
  if (at === "e" || at === "ne" || at === "se") {
    nextX += gap;
    anchor = "start";
  } else if (at === "w" || at === "nw" || at === "sw") {
    nextX -= gap;
    anchor = "end";
  }
  let baseline = y + 4;
  if (at === "n") baseline = y - gap;
  else if (at === "ne" || at === "nw") baseline = y - gap + 4;
  else if (at === "s") baseline = y + gap + 9;
  else if (at === "se" || at === "sw") baseline = y + gap + 4;
  return { x: nextX, y: baseline, anchor };
}

function herePin(x: number, y: number): { readonly d: string; readonly textY: number } {
  const width = 78;
  const height = 19;
  const left = x - width / 2;
  const top = y - height - 17;
  return {
    d: `M${left},${top + 4} q0,-4 4,-4 h${width - 8} q4,0 4,4 v${height - 8} q0,4 -4,4 h-${width / 2 - 9} l-5,6 l-5,-6 h-${width / 2 - 9} q-4,0 -4,-4 z`,
    textY: top + height / 2 + 3.8,
  };
}

function recallPie(x: number, y: number, radius: number, fraction: number): string | null {
  if (fraction <= 0) return null;
  if (fraction >= 0.999) {
    return `M${x - radius},${y} a${radius},${radius} 0 1 1 ${radius * 2},0 a${radius},${radius} 0 1 1 ${-radius * 2},0`;
  }
  const angle = -Math.PI / 2 + fraction * Math.PI * 2;
  const endX = x + radius * Math.cos(angle);
  const endY = y + radius * Math.sin(angle);
  const large = fraction > 0.5 ? 1 : 0;
  return `M${x},${y} L${x},${y - radius} A${radius},${radius} 0 ${large} 1 ${endX},${endY} Z`;
}

function stationSubtitle(station: LearnMapStation, here: boolean): string | null {
  if (station.state === "suggested") return "From Chat";
  if (station.state === "ready" && station.note && station.note.length <= 32) return station.note;
  if (here && station.recall !== null) return `${Math.round(station.recall * 100)}% recall`;
  return null;
}

function stationColor(
  map: LearnMap,
  station: LearnMapStation,
  colors: MobileThemeVariables,
  foreground: string,
): string {
  for (const id of station.lineIds) {
    const line = map.lines.find((item) => item.id === id);
    if (line) return learnLineColor(line.color, colors);
  }
  return foreground;
}
