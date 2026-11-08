import Svg, { Circle, Path } from "react-native-svg";

import type { LearnStationState } from "@t3tools/contracts";

/** Stop mark: solid dot, recall ring, due diamond, or a dashed ready ring. */
export function StationGlyph(props: {
  readonly state: LearnStationState;
  readonly color: string;
  readonly surface: string;
  readonly recall: number | null;
}) {
  const recall = props.recall === null ? 0 : Math.max(0, Math.min(1, props.recall));
  const ring = 2 * Math.PI * 5;
  return (
    <Svg width={28} height={28} viewBox="0 0 28 28" accessible={false}>
      {props.state === "due" ? (
        <Path
          d="M14 5 L23 14 L14 23 L5 14 Z"
          fill={props.color}
          stroke={props.surface}
          strokeLinejoin="round"
          strokeWidth={2}
        />
      ) : props.state === "solid" ? (
        <Circle cx={14} cy={14} r={6} fill={props.color} stroke={props.surface} strokeWidth={2} />
      ) : (
        <Circle
          cx={14}
          cy={14}
          r={6}
          fill={props.surface}
          stroke={props.color}
          strokeWidth={2}
          strokeDasharray={
            props.state === "ready" || props.state === "suggested" ? "2.4 2" : undefined
          }
        />
      )}
      {props.state === "learning" && recall > 0 ? (
        <Circle
          cx={14}
          cy={14}
          r={5}
          fill="none"
          stroke={props.color}
          strokeWidth={4}
          strokeDasharray={`${recall * ring} ${ring}`}
          rotation={-90}
          origin="14, 14"
        />
      ) : null}
    </Svg>
  );
}
