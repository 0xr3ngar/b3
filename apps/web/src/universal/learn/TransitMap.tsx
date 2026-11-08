import type {
  LearnMap,
  LearnMapActionInput,
  LearnMapLine,
  LearnMapStation,
  LearnStartInput,
  ThreadId,
} from "@t3tools/contracts";
import { prerequisiteClosure } from "@t3tools/universal-learn/graph";
import {
  focusSet,
  roundedPath,
  type LabelAt,
  type TransitLayout,
} from "@t3tools/universal-learn/transit";
import { MinusIcon, PlusIcon, ScanIcon, XIcon } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from "~/components/ui/tooltip";

import "./learnMap.css";
import { layoutFor, linePaint, planRoute } from "./mapModel";

type FilterId = "solid" | "learning" | "due" | "ready";

interface Selection {
  readonly tick: number;
  readonly kind: "stop" | "line" | "filter" | "route";
  readonly id: string;
  readonly path?: readonly string[];
}

interface ViewBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const FILTERS: readonly { readonly id: FilterId; readonly label: string }[] = [
  { id: "solid", label: "solid" },
  { id: "learning", label: "learning" },
  { id: "due", label: "due" },
  { id: "ready", label: "ready to learn" },
];

const FILTER_TITLE: Record<FilterId, string> = {
  solid: "Solid",
  learning: "Learning",
  due: "Due today",
  ready: "Ready to learn",
};

const STATE_COPY: Record<
  LearnMapStation["state"],
  { readonly label: string; readonly tone: string }
> = {
  solid: { label: "Solid", tone: "var(--success-foreground, var(--success))" },
  learning: { label: "Learning", tone: "var(--info-foreground, var(--info))" },
  due: { label: "Due for review now", tone: "var(--warning-foreground, var(--warning))" },
  ready: { label: "Ready to learn", tone: "var(--primary)" },
  locked: { label: "Locked", tone: "var(--muted-foreground)" },
  suggested: { label: "Suggested from Chat", tone: "var(--muted-foreground)" },
};

export function TransitMap(props: {
  readonly map: LearnMap;
  readonly onStart: (input: LearnStartInput) => void;
  readonly onAction: (input: LearnMapActionInput) => void;
  readonly onOpenThread: (threadId: ThreadId) => void;
  readonly composer?: ReactNode;
}) {
  const layout = layoutFor(props.map);
  const [selection, setSelection] = useState<Selection | null>(null);
  const counts: Record<FilterId, number> = { solid: 0, learning: 0, due: 0, ready: 0 };
  for (const station of props.map.stations) {
    if (
      station.state === "solid" ||
      station.state === "learning" ||
      station.state === "due" ||
      station.state === "ready"
    ) {
      counts[station.state] += 1;
    }
  }

  const selectStop = (id: string) => {
    setSelection((current) => ({ kind: "stop", id, tick: (current?.tick ?? 0) + 1 }));
  };
  const selectLine = (id: string) => {
    setSelection((current) => ({ kind: "line", id, tick: (current?.tick ?? 0) + 1 }));
  };
  const selectFilter = (id: FilterId) => {
    setSelection((current) =>
      current?.kind === "filter" && current.id === id
        ? null
        : { kind: "filter", id, tick: (current?.tick ?? 0) + 1 },
    );
  };
  const plan = (id: string) => {
    setSelection((current) => ({
      kind: "route",
      id,
      path: planRoute(props.map, id),
      tick: (current?.tick ?? 0) + 1,
    }));
  };
  const clear = () => setSelection(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Escape clears the map from anywhere on the page
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSelection((current) => (current === null ? current : null));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col" data-learn-map="">
      <header className="z-10 flex h-12 shrink-0 items-center gap-1.5 pr-4 pl-5">
        <h1 className="mr-2.5 text-sm font-medium">Knowledge map</h1>
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Map filters">
          {FILTERS.map((filter) => {
            const on = selection?.kind === "filter" && selection.id === filter.id;
            return (
              <Button
                key={filter.id}
                size="xs"
                variant={on ? "outline" : "ghost-muted"}
                aria-pressed={on}
                onClick={() => selectFilter(filter.id)}
              >
                <FilterGlyph id={filter.id} />
                <span className="font-medium text-foreground">{counts[filter.id]}</span>{" "}
                {filter.label}
              </Button>
            );
          })}
        </div>
        <p className="ml-auto hidden text-xs font-normal text-muted-foreground sm:block">
          Click a stop or a line. Esc clears.
        </p>
      </header>
      <div className="relative min-h-0 flex-1">
        <MapStage
          map={props.map}
          layout={layout}
          selection={selection}
          onSelectStop={selectStop}
          onSelectLine={selectLine}
          onClear={clear}
        />
        {selection ? (
          <MapCard
            map={props.map}
            selection={selection}
            onSelectStop={selectStop}
            onStart={props.onStart}
            onAction={props.onAction}
            onOpenThread={props.onOpenThread}
            onClear={clear}
            onRoute={plan}
          />
        ) : null}
        {props.composer ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10" data-part="comp">
            {props.composer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MapStage(props: {
  readonly map: LearnMap;
  readonly layout: TransitLayout;
  readonly selection: Selection | null;
  readonly onSelectStop: (id: string) => void;
  readonly onSelectLine: (id: string) => void;
  readonly onClear: () => void;
}) {
  const fitted = {
    x: 0,
    y: 0,
    w: props.layout.width,
    h: props.layout.height,
  };
  const [box, setBox] = useState<ViewBox>(fitted);
  const [dragging, setDragging] = useState(false);
  const boxRef = useRef(fitted);
  const frameRef = useRef(0);
  const dragRef = useRef<{
    x: number;
    y: number;
    box: ViewBox;
    moved: boolean;
    stationId: string | null;
    lineId: string | null;
  } | null>(null);
  const suppressClick = useRef(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const byId = new Map(props.map.stations.map((station) => [station.id, station]));
  const lines = new Map(props.map.lines.map((line) => [line.id, line]));
  const lit = litIds(props.map, props.selection);
  const ringId =
    props.selection?.kind === "stop"
      ? props.selection.id
      : props.selection?.kind === "route"
        ? props.selection.id
        : null;
  const routeD =
    props.selection?.kind === "route"
      ? routeGeometry(props.layout, props.selection.path ?? [])
      : "";
  const zoomedOut = box.w > props.layout.width * (1000 / 908);

  const commitBox = (next: ViewBox) => {
    boxRef.current = next;
    setBox(next);
  };
  const limits = () => {
    const width = props.layout.width || 1;
    return {
      minW: Math.min(width * (320 / 908), width),
      maxW: Math.max(width * (1600 / 908), width),
    };
  };
  const zoomBy = (factor: number) => {
    const current = boxRef.current;
    if (current.w <= 0 || current.h <= 0) return;
    const { minW, maxW } = limits();
    const cx = current.x + current.w / 2;
    const cy = current.y + current.h / 2;
    const w = Math.min(maxW, Math.max(minW, current.w * factor));
    const h = current.h * (w / current.w);
    tweenTo({
      x: cx - (cx - current.x) * (w / current.w),
      y: cy - (cy - current.y) * (h / current.h),
      w,
      h,
    });
  };
  const tweenTo = (to: ViewBox) => {
    if (frameRef.current !== 0) cancelAnimationFrame(frameRef.current);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      frameRef.current = 0;
      commitBox(to);
      return;
    }
    const from = boxRef.current;
    // oxlint-disable-next-line react/purity -- runs in an event handler (oxc#27309)
    const started = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - started) / 240);
      const eased = 1 - (1 - progress) ** 3;
      commitBox({
        x: from.x + (to.x - from.x) * eased,
        y: from.y + (to.y - from.y) * eased,
        w: from.w + (to.w - from.w) * eased,
        h: from.h + (to.h - from.h) * eased,
      });
      if (progress < 1) frameRef.current = requestAnimationFrame(step);
      else frameRef.current = 0;
    };
    frameRef.current = requestAnimationFrame(step);
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- cancels a viewBox tween that is still running when the map unmounts
  useEffect(() => {
    const frame = frameRef;
    return () => {
      if (frame.current !== 0) cancelAnimationFrame(frame.current);
    };
  }, [frameRef]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- wheel listener must be non-passive so the map can take the gesture
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const width = props.layout.width || 1;
    const minW = Math.min(width * (320 / 908), width);
    const maxW = Math.max(width * (1600 / 908), width);
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const current = boxRef.current;
      if (current.w <= 0 || current.h <= 0) return;
      const point = clientToSvg(svg, event.clientX, event.clientY);
      const factor = event.deltaY > 0 ? 1.12 : 0.89;
      const w = Math.min(maxW, Math.max(minW, current.w * factor));
      const h = current.h * (w / current.w);
      const next = {
        x: point.x - (point.x - current.x) * (w / current.w),
        y: point.y - (point.y - current.y) * (h / current.h),
        w,
        h,
      };
      boxRef.current = next;
      setBox(next);
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [boxRef, props.layout.width, setBox, svgRef]);

  const paintTip = (event: PointerEvent, station: LearnMapStation | null) => {
    const tip = tipRef.current;
    const stage = stageRef.current;
    if (!tip || !stage) return;
    if (!station) {
      tip.hidden = true;
      return;
    }
    const bounds = stage.getBoundingClientRect();
    tip.hidden = false;
    tip.style.left = `${event.clientX - bounds.left + 12}px`;
    tip.style.top = `${event.clientY - bounds.top - 30}px`;
    const title = tip.querySelector("b");
    const extra = tip.querySelector("span");
    if (title) title.textContent = station.title;
    if (extra) extra.textContent = tipExtra(station);
  };
  const stationFromEvent = (event: PointerEvent | MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) return null;
    const id = target.closest("[data-station]")?.getAttribute("data-station");
    return id ? (byId.get(id) ?? null) : null;
  };
  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    const target = event.target;
    const stationId =
      target instanceof Element
        ? (target.closest("[data-station]")?.getAttribute("data-station") ?? null)
        : null;
    const lineId =
      target instanceof Element
        ? (target.closest("[data-line]")?.getAttribute("data-line") ?? null)
        : null;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      box: boxRef.current,
      moved: false,
      stationId,
      lineId,
    };
  };
  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag) {
      paintTip(event, stationFromEvent(event));
      return;
    }
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    if (!drag.moved) {
      drag.moved = true;
      setDragging(true);
      paintTip(event, null);
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const scale = rect.width === 0 ? 1 : drag.box.w / rect.width;
    commitBox({ ...drag.box, x: drag.box.x - dx * scale, y: drag.box.y - dy * scale });
  };
  const endDrag = (event: PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (drag.moved) {
      suppressClick.current = true;
      setDragging(false);
      return;
    }
    if (event.type === "pointercancel") return;
    // Pointer capture retargets the click to the svg, so the pressed stop is read on the way down.
    if (drag.stationId) props.onSelectStop(drag.stationId);
    else if (drag.lineId) props.onSelectLine(drag.lineId);
    else props.onClear();
  };
  const onClick = () => {
    suppressClick.current = false;
  };
  const onKey = (event: KeyboardEvent<SVGGElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    const stationId = event.currentTarget.getAttribute("data-station");
    if (stationId) props.onSelectStop(stationId);
    const lineId = event.currentTarget.getAttribute("data-line");
    if (lineId) props.onSelectLine(lineId);
  };

  const here = props.map.here
    ? props.layout.stations.find((station) => station.id === props.map.here)
    : undefined;
  const hereAway = lit !== null && (props.map.here === null || !lit.has(props.map.here));

  return (
    <div
      ref={stageRef}
      data-part="map"
      data-drag={dragging ? "true" : "false"}
      data-zoomed={zoomedOut ? "true" : "false"}
    >
      <svg
        ref={svgRef}
        className="block h-full w-full select-none"
        data-part="svg"
        viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => {
          const tip = tipRef.current;
          if (tip) tip.hidden = true;
        }}
        onClick={onClick}
      >
        {routeD ? (
          <g key={props.selection?.tick}>
            <path data-part="route" pathLength={1} d={routeD} />
            <path data-part="route-dash" d={routeD} />
          </g>
        ) : null}
        <g>
          {props.layout.stubs.map((stub) => {
            const litStub = lit === null || originLit(props.map, stub.lineId, lit);
            const line = lines.get(stub.lineId);
            return (
              <path
                key={stub.lineId}
                data-part="seg"
                data-dim={litStub ? "false" : "true"}
                d={roundedPath(stub.points)}
                stroke={line ? linePaint(line.color) : "var(--foreground)"}
                strokeWidth={lit !== null && litStub ? 7 : 6}
              />
            );
          })}
          {props.layout.segments.map((segment) => {
            const on = lit === null || (lit.has(segment.from) && lit.has(segment.to));
            const line = segment.lineId ? lines.get(segment.lineId) : undefined;
            const track = segment.kind === "track";
            return (
              <path
                key={`${segment.from}:${segment.to}`}
                data-part="seg"
                data-dim={on ? "false" : "true"}
                d={roundedPath(segment.points)}
                stroke={track && line ? linePaint(line.color) : "var(--muted-foreground)"}
                strokeWidth={
                  segment.kind === "link"
                    ? 1.2
                    : segment.kind === "planned"
                      ? 3
                      : lit !== null && on
                        ? 7
                        : 6
                }
                strokeDasharray={
                  segment.kind === "planned" ? "1 7" : segment.kind === "link" ? "2 3" : undefined
                }
              />
            );
          })}
        </g>
        <g>
          {props.layout.stations.map((laid) => {
            const station = byId.get(laid.id);
            if (!station) return null;
            const dim = lit !== null && !lit.has(station.id);
            const color = glyphColor(props.map, station);
            const label = labelOrigin(laid.x, laid.y, laid.labelAt, laid.interchange);
            const subtitle = stationSubtitle(station, station.id === props.map.here);
            const muted = station.state === "locked" || station.state === "suggested";
            return (
              <g
                key={station.id}
                data-part="sta"
                data-station={station.id}
                data-dim={dim ? "true" : "false"}
                role="button"
                tabIndex={0}
                aria-label={station.title}
                aria-pressed={ringId === station.id}
                onKeyDown={onKey}
              >
                <StationMark
                  x={laid.x}
                  y={laid.y}
                  state={station.state}
                  recall={station.recall}
                  color={color}
                  interchange={laid.interchange}
                  badge={station.misconception !== null}
                />
                <text
                  data-part="lbl"
                  data-tone={muted ? "muted" : laid.interchange ? "bold" : "plain"}
                  x={label.x}
                  y={label.y}
                  textAnchor={label.anchor}
                >
                  {station.title}
                </text>
                {subtitle ? (
                  <text
                    data-part="lbl"
                    data-tone="sub"
                    x={label.x}
                    y={label.y + 13}
                    textAnchor={label.anchor}
                  >
                    {subtitle}
                  </text>
                ) : null}
                {ringId === station.id ? (
                  <circle
                    key={props.selection?.tick}
                    data-part="selring"
                    cx={laid.x}
                    cy={laid.y}
                    r={laid.interchange ? 15 : 13.5}
                  />
                ) : null}
                <circle data-part="hit" cx={laid.x} cy={laid.y} r={17} />
              </g>
            );
          })}
        </g>
        <g>
          {props.layout.bullets.map((bullet) => {
            const line = lines.get(bullet.lineId);
            if (!line) return null;
            const dim =
              lit !== null &&
              !props.map.stations.some(
                (station) => lit.has(station.id) && station.lineIds.includes(bullet.lineId),
              );
            return (
              <g
                key={bullet.lineId}
                data-part="bul"
                data-dim={dim ? "true" : "false"}
                data-line={bullet.lineId}
                role="button"
                tabIndex={0}
                aria-label={line.title}
                aria-pressed={
                  props.selection?.kind === "line" && props.selection.id === bullet.lineId
                }
                onKeyDown={onKey}
              >
                <rect
                  x={bullet.x}
                  y={bullet.y - 9}
                  width={bullet.width}
                  height={18}
                  rx={4}
                  fill={linePaint(line.color)}
                />
                <text x={bullet.x + bullet.width / 2} y={bullet.y + 3.8} textAnchor="middle">
                  {line.title}
                </text>
              </g>
            );
          })}
        </g>
        {here ? (
          <g data-part="yah" data-away={hereAway ? "true" : "false"}>
            <path d={herePin(here.x, here.y).d} fill="var(--foreground)" />
            <text x={here.x} y={herePin(here.x, here.y).textY} textAnchor="middle">
              You are here
            </text>
          </g>
        ) : null}
      </svg>
      <div ref={tipRef} data-part="tip" hidden>
        <b />
        <span />
      </div>
      <TooltipProvider>
        <div data-part="zoom">
          <div>
            <ZoomButton label="Zoom in" onClick={() => zoomBy(0.8)}>
              <PlusIcon />
            </ZoomButton>
          </div>
          <div>
            <ZoomButton label="Zoom out" onClick={() => zoomBy(1.25)}>
              <MinusIcon />
            </ZoomButton>
          </div>
          <div>
            <ZoomButton label="Fit map" onClick={() => tweenTo(fitted)}>
              <ScanIcon />
            </ZoomButton>
          </div>
        </div>
      </TooltipProvider>
    </div>
  );
}

function ZoomButton(props: {
  readonly label: string;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label={props.label} onClick={props.onClick}>
            {props.children}
          </Button>
        }
      />
      <TooltipPopup>{props.label}</TooltipPopup>
    </Tooltip>
  );
}

function MapCard(props: {
  readonly map: LearnMap;
  readonly selection: Selection;
  readonly onSelectStop: (id: string) => void;
  readonly onStart: (input: LearnStartInput) => void;
  readonly onAction: (input: LearnMapActionInput) => void;
  readonly onOpenThread: (threadId: ThreadId) => void;
  readonly onClear: () => void;
  readonly onRoute: (id: string) => void;
}) {
  const byId = new Map(props.map.stations.map((station) => [station.id, station]));
  if (props.selection.kind === "stop") {
    const station = byId.get(props.selection.id);
    if (!station) return null;
    return (
      <StopCard
        map={props.map}
        station={station}
        onSelectStop={props.onSelectStop}
        onStart={props.onStart}
        onAction={props.onAction}
        onOpenThread={props.onOpenThread}
        onClear={props.onClear}
        onRoute={props.onRoute}
      />
    );
  }
  if (props.selection.kind === "line") return <LineCard {...props} byId={byId} />;
  if (props.selection.kind === "filter") {
    return (
      <FilterCard
        map={props.map}
        selection={props.selection}
        onSelectStop={props.onSelectStop}
        onStart={props.onStart}
        onClear={props.onClear}
      />
    );
  }
  return <RouteCard {...props} byId={byId} />;
}

function StopCard(props: {
  readonly map: LearnMap;
  readonly station: LearnMapStation;
  readonly onSelectStop: (id: string) => void;
  readonly onStart: (input: LearnStartInput) => void;
  readonly onAction: (input: LearnMapActionInput) => void;
  readonly onOpenThread: (threadId: ThreadId) => void;
  readonly onClear: () => void;
  readonly onRoute: (id: string) => void;
}) {
  const { station } = props;
  const line = primaryLine(props.map, station);
  const stops = line ? props.map.stations.filter((item) => item.lineIds.includes(line.id)) : [];
  const index = stops.findIndex((item) => item.id === station.id) + 1;
  const { needs, unlocks } = neighbors(props.map, station.id);
  const copy = STATE_COPY[station.state];
  const stateLabel =
    station.state === "solid" && isInterchange(props.map, station)
      ? "Solid, interchange"
      : copy.label;
  const needNames = needs.flatMap((id) => {
    const title = props.map.stations.find((item) => item.id === id)?.title;
    return title ? [title] : [];
  });
  const color = glyphColor(props.map, station);
  return (
    <section data-part="det" aria-label={station.title}>
      <div data-part="ln">
        {line ? (
          <>
            <span data-part="swatch" style={{ background: linePaint(line.color) }} />
            <span>
              {line.title} line, stop {index} of {stops.length}
            </span>
          </>
        ) : (
          <span>Not on a line yet</span>
        )}
        <ClearButton onClear={props.onClear} />
      </div>
      <h2>{station.title}</h2>
      <div data-part="state" style={{ color: copy.tone }}>
        {stateLabel}
      </div>
      {station.recall !== null ? (
        <div data-part="meter">
          <span>Recall</span>
          <span data-part="bar">
            <i
              data-part="meter-fill"
              style={
                {
                  background: station.state === "due" ? "var(--due)" : color,
                  "--recall": `${Math.round(station.recall * 100)}%`,
                } as CSSProperties
              }
            />
          </span>
          <b>{Math.round(station.recall * 100)}%</b>
        </div>
      ) : null}
      {station.misconception ? (
        <div data-part="miscon">
          <strong>Misconception flagged</strong>
          {station.misconception}
        </div>
      ) : null}
      {station.state === "suggested" ? (
        <p data-part="note">
          {station.note ?? "Suggested from Chat. Adding it places the stop on your map."}
        </p>
      ) : null}
      {station.state === "locked" && needNames.length > 0 ? (
        <p data-part="note">
          Unlocks once {needNames.join(" and ")} {needNames.length > 1 ? "are" : "is"} solid.
        </p>
      ) : null}
      <dl data-part="rel">
        {needs.length > 0 ? (
          <>
            <dt>Needs</dt>
            <dd>
              {needs.map((id) => (
                <Chip key={id} map={props.map} id={id} onClick={() => props.onSelectStop(id)} />
              ))}
            </dd>
          </>
        ) : null}
        {unlocks.length > 0 ? (
          <>
            <dt>Unlocks</dt>
            <dd>
              {unlocks.map((id) => (
                <Chip key={id} map={props.map} id={id} onClick={() => props.onSelectStop(id)} />
              ))}
            </dd>
          </>
        ) : null}
        {station.taughtIn ? (
          <TaughtIn
            title={station.taughtIn.title}
            onOpen={() => {
              const taught = station.taughtIn;
              if (taught) props.onOpenThread(taught.threadId);
            }}
          />
        ) : null}
      </dl>
      <div data-part="acts">
        <StopActions
          station={station}
          onStart={props.onStart}
          onAction={props.onAction}
          onRoute={props.onRoute}
        />
      </div>
    </section>
  );
}

function StopActions(props: {
  readonly station: LearnMapStation;
  readonly onStart: (input: LearnStartInput) => void;
  readonly onAction: (input: LearnMapActionInput) => void;
  readonly onRoute: (id: string) => void;
}) {
  const { station } = props;
  const lesson = () => props.onStart({ kind: "lesson", conceptIds: [station.id] });
  const quiz = () => props.onStart({ kind: "quiz", conceptIds: [station.id] });
  if (station.state === "due") {
    return (
      <Button size="sm" onClick={() => props.onStart({ kind: "review", conceptIds: [station.id] })}>
        Review now
      </Button>
    );
  }
  if (station.state === "learning") {
    return (
      <>
        <Button size="sm" onClick={lesson}>
          Continue lesson
        </Button>
        <Button size="sm" variant="outline" onClick={quiz}>
          Quiz me
        </Button>
      </>
    );
  }
  if (station.state === "ready") {
    return (
      <>
        <Button size="sm" onClick={lesson}>
          Start lesson
        </Button>
        <Button size="sm" variant="outline" onClick={() => props.onRoute(station.id)}>
          Plan route here
        </Button>
      </>
    );
  }
  if (station.state === "locked") {
    return (
      <Button size="sm" onClick={() => props.onRoute(station.id)}>
        Plan route here
      </Button>
    );
  }
  if (station.state === "suggested") {
    return (
      <>
        <Button
          size="sm"
          onClick={() => props.onAction({ action: "accept_suggestion", id: station.id })}
        >
          Add to map
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => props.onAction({ action: "dismiss_suggestion", id: station.id })}
        >
          Dismiss
        </Button>
      </>
    );
  }
  return (
    <Button size="sm" onClick={quiz}>
      Quiz me
    </Button>
  );
}

function LineCard(props: {
  readonly map: LearnMap;
  readonly selection: Selection;
  readonly byId: Map<string, LearnMapStation>;
  readonly onSelectStop: (id: string) => void;
  readonly onStart: (input: LearnStartInput) => void;
  readonly onClear: () => void;
}) {
  const line = props.map.lines.find((item) => item.id === props.selection.id);
  if (!line) return null;
  const stops = props.map.stations.filter((station) => station.lineIds.includes(line.id));
  const solid = stops.filter((station) => station.state === "solid").length;
  const due = stops.filter((station) => station.state === "due");
  return (
    <section data-part="det" aria-label={line.title}>
      <div data-part="ln">
        <span data-part="swatch" style={{ background: linePaint(line.color) }} />
        <span>Line</span>
        <ClearButton onClear={props.onClear} />
      </div>
      <h2>{line.title}</h2>
      <div data-part="state" style={{ color: "var(--muted-foreground)" }}>
        {stops.length} stops, {solid} solid
        {due.length > 0 ? `, ${due.length} due` : ""}
      </div>
      <div data-part="list">
        {stops.map((station) => (
          <StopRow
            key={station.id}
            map={props.map}
            station={station}
            value={
              station.recall !== null
                ? `${Math.round(station.recall * 100)}%`
                : STATE_COPY[station.state].label
            }
            onClick={() => props.onSelectStop(station.id)}
          />
        ))}
      </div>
      <div data-part="acts">
        {due.length > 0 ? (
          <Button
            size="sm"
            onClick={() =>
              props.onStart({
                kind: "review",
                lineId: line.id,
                conceptIds: due.map((station) => station.id),
              })
            }
          >
            Review this line ({due.length})
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={() =>
              props.onStart({
                kind: "quiz",
                lineId: line.id,
                conceptIds: stops.map((station) => station.id),
              })
            }
          >
            Quiz this line
          </Button>
        )}
      </div>
    </section>
  );
}

function FilterCard(props: {
  readonly map: LearnMap;
  readonly selection: Selection;
  readonly onSelectStop: (id: string) => void;
  readonly onStart: (input: LearnStartInput) => void;
  readonly onClear: () => void;
}) {
  const id = props.selection.id as FilterId;
  const hits = props.map.stations.filter((station) => station.state === id);
  const learning =
    props.map.stations.find(
      (station) => station.state === "learning" && station.id === props.map.here,
    ) ?? props.map.stations.find((station) => station.state === "learning");
  return (
    <section data-part="det" aria-label={FILTER_TITLE[id]}>
      <div data-part="ln">
        <span>
          {hits.length} {hits.length === 1 ? "stop" : "stops"}
        </span>
        <ClearButton onClear={props.onClear} />
      </div>
      <h2>{FILTER_TITLE[id]}</h2>
      <div data-part="list">
        {hits.map((station) => (
          <StopRow
            key={station.id}
            map={props.map}
            station={station}
            value={primaryLine(props.map, station)?.title ?? ""}
            onClick={() => props.onSelectStop(station.id)}
          />
        ))}
      </div>
      <div data-part="acts">
        {id === "due" ? (
          <Button
            size="sm"
            onClick={() =>
              props.onStart({ kind: "review", conceptIds: hits.map((station) => station.id) })
            }
          >
            Start review ({hits.length})
          </Button>
        ) : null}
        {id === "ready" ? <PickNew hits={hits} onSelectStop={props.onSelectStop} /> : null}
        {id === "learning" && learning ? (
          <Button
            size="sm"
            onClick={() => props.onStart({ kind: "lesson", conceptIds: [learning.id] })}
          >
            Continue where you left off
          </Button>
        ) : null}
        {id === "solid" ? (
          <Button
            size="sm"
            onClick={() =>
              props.onStart({ kind: "quiz", conceptIds: hits.map((station) => station.id) })
            }
          >
            Mixed quiz
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function RouteCard(props: {
  readonly map: LearnMap;
  readonly selection: Selection;
  readonly byId: Map<string, LearnMapStation>;
  readonly onSelectStop: (id: string) => void;
  readonly onStart: (input: LearnStartInput) => void;
  readonly onClear: () => void;
}) {
  const path = props.selection.path ?? [];
  const target = props.byId.get(props.selection.id);
  if (!target) return null;
  const origin = props.byId.get(path[0] ?? "")?.title ?? "here";
  let minutes = 0;
  for (const id of path) {
    const station = props.byId.get(id);
    if (station && station.state !== "solid") minutes += station.minutes;
  }
  const hops = Math.max(0, path.length - 1);
  return (
    <section data-part="det" aria-label={`Route to ${target.title}`}>
      <div data-part="ln">
        <span>Route</span>
        <ClearButton onClear={props.onClear} />
      </div>
      <h2>To {target.title}</h2>
      <div data-part="state" style={{ color: "var(--muted-foreground)" }}>
        {hops} {hops === 1 ? "stop" : "stops"} from {origin}
        {minutes > 0 ? `, about ${minutes} minutes` : ""}
      </div>
      <div data-part="list">
        {path.map((id, index) => {
          const station = props.byId.get(id);
          if (!station) return null;
          const value =
            index === 0
              ? "Start"
              : station.minutes > 0
                ? `${station.minutes} min`
                : STATE_COPY[station.state].label;
          return (
            <StopRow
              key={id}
              map={props.map}
              station={station}
              value={value}
              onClick={() => props.onSelectStop(station.id)}
            />
          );
        })}
      </div>
      <div data-part="acts">
        <Button size="sm" onClick={() => props.onStart({ kind: "route", conceptIds: [...path] })}>
          Start this route
        </Button>
      </div>
    </section>
  );
}

function StopRow(props: {
  readonly map: LearnMap;
  readonly station: LearnMapStation;
  readonly value: string;
  readonly onClick: () => void;
}) {
  return (
    <button type="button" data-part="row" onClick={props.onClick}>
      <svg viewBox="-10 -10 20 20" width="14" height="14" aria-hidden>
        <StationMark
          x={0}
          y={0}
          state={props.station.state}
          recall={props.station.recall}
          color={glyphColor(props.map, props.station)}
          interchange={isInterchange(props.map, props.station)}
          badge={false}
        />
      </svg>
      <span data-part="name">{props.station.title}</span>
      <span data-part="value">{props.value}</span>
    </button>
  );
}

function TaughtIn(props: { readonly title: string; readonly onOpen: () => void }) {
  return (
    <>
      <dt>Taught in</dt>
      <dd>
        <button type="button" data-part="chip" onClick={props.onOpen}>
          {props.title}
        </button>
      </dd>
    </>
  );
}

function PickNew(props: {
  readonly hits: readonly LearnMapStation[];
  readonly onSelectStop: (id: string) => void;
}) {
  const first = props.hits[0];
  if (!first) return null;
  return (
    <Button size="sm" onClick={() => props.onSelectStop(first.id)}>
      Pick something new
    </Button>
  );
}

function Chip(props: {
  readonly map: LearnMap;
  readonly id: string;
  readonly onClick: () => void;
}) {
  const station = props.map.stations.find((item) => item.id === props.id);
  if (!station) return null;
  return (
    <button type="button" data-part="chip" onClick={props.onClick}>
      <span data-part="dot" style={{ background: chipColor(props.map, station) }} />
      {station.title}
    </button>
  );
}

function ClearButton(props: { readonly onClear: () => void }) {
  return (
    <div data-part="clear">
      <Button size="icon-xs" variant="ghost" aria-label="Clear" onClick={props.onClear}>
        <XIcon />
      </Button>
    </div>
  );
}

function FilterGlyph(props: { readonly id: FilterId }) {
  if (props.id === "solid") {
    return (
      <svg viewBox="0 0 14 14" aria-hidden>
        <circle cx="7" cy="7" r="5" fill="currentColor" />
      </svg>
    );
  }
  if (props.id === "learning") {
    return (
      <svg viewBox="0 0 14 14" aria-hidden>
        <circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M7,7 L7,3.6 A3.4,3.4 0 0 1 9.4,9.4Z" fill="currentColor" />
      </svg>
    );
  }
  if (props.id === "due") {
    return (
      <svg viewBox="0 0 14 14" aria-hidden>
        <path d="M7 1.2 12.8 7 7 12.8 1.2 7Z" fill="var(--due)" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 14 14" aria-hidden>
      <circle
        cx="7"
        cy="7"
        r="4.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeDasharray="2.2 1.8"
      />
    </svg>
  );
}

function StationMark(props: {
  readonly x: number;
  readonly y: number;
  readonly state: LearnMapStation["state"];
  readonly recall: number | null;
  readonly color: string;
  readonly interchange: boolean;
  readonly badge: boolean;
}) {
  const { x, y } = props;
  const radius = 6.5;
  let mark: ReactNode;
  if (props.interchange && props.state === "solid") {
    mark = (
      <rect
        x={x - 9}
        y={y - 9}
        width={18}
        height={18}
        rx={9}
        fill="var(--background)"
        stroke="var(--foreground)"
        strokeWidth={2.6}
      />
    );
  } else if (props.state === "solid") {
    mark = (
      <circle
        cx={x}
        cy={y}
        r={radius}
        fill={props.color}
        stroke="var(--background)"
        strokeWidth={2.5}
      />
    );
  } else if (props.state === "learning") {
    const pie = recallPie(x, y, radius - 2.2, props.recall ?? 0);
    mark = (
      <>
        <circle
          cx={x}
          cy={y}
          r={radius}
          fill="var(--background)"
          stroke={props.color}
          strokeWidth={2.5}
        />
        {pie ? <path d={pie} fill={props.color} /> : null}
      </>
    );
  } else if (props.state === "ready") {
    mark = (
      <circle
        cx={x}
        cy={y}
        r={radius}
        fill="var(--background)"
        stroke={props.color}
        strokeWidth={2.2}
        strokeDasharray="2.6 2"
      />
    );
  } else if (props.state === "due") {
    const reach = radius + 1.8;
    mark = (
      <path
        d={`M${x},${y - reach} L${x + reach},${y} L${x},${y + reach} L${x - reach},${y} Z`}
        fill="var(--due)"
        stroke="var(--background)"
        strokeWidth={2.5}
        strokeLinejoin="round"
      />
    );
  } else if (props.state === "locked") {
    mark = (
      <path
        d={`M${x - 7},${y} H${x + 7}`}
        stroke="var(--muted-foreground)"
        strokeWidth={3}
        strokeLinecap="round"
      />
    );
  } else {
    mark = (
      <circle
        cx={x}
        cy={y}
        r={radius}
        fill="none"
        stroke="var(--muted-foreground)"
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
          <circle
            cx={badgeX}
            cy={badgeY}
            r={5.5}
            fill="var(--mis)"
            stroke="var(--background)"
            strokeWidth={2}
          />
          <path
            d={`M${badgeX},${badgeY - 2.5} v3`}
            stroke="var(--primary-foreground)"
            strokeWidth={1.6}
            strokeLinecap="round"
          />
          <circle cx={badgeX} cy={badgeY + 2.7} r={0.9} fill="var(--primary-foreground)" />
        </>
      ) : null}
    </>
  );
}

function litIds(map: LearnMap, selection: Selection | null): ReadonlySet<string> | null {
  if (selection === null) return null;
  if (selection.kind === "stop") return focusSet(map.edges, selection.id);
  if (selection.kind === "line") {
    const ids = new Set<string>();
    for (const station of map.stations) {
      if (station.lineIds.includes(selection.id)) ids.add(station.id);
    }
    return ids;
  }
  if (selection.kind === "filter") {
    const ids = new Set<string>();
    for (const station of map.stations) {
      if (station.state === selection.id) ids.add(station.id);
    }
    return ids;
  }
  const ids = new Set<string>(selection.path ?? []);
  const start = selection.path?.[0];
  if (start !== undefined) {
    for (const id of prerequisiteClosure(map.edges, start)) ids.add(id);
  }
  return ids;
}

function originLit(map: LearnMap, lineId: string, lit: ReadonlySet<string>): boolean {
  for (const station of map.stations) {
    if (!lit.has(station.id) || !station.lineIds.includes(lineId)) continue;
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

function tipExtra(station: LearnMapStation): string {
  const parts: string[] = [];
  if (station.recall !== null) parts.push(`${Math.round(station.recall * 100)}% recall`);
  if (station.state === "due") parts.push("due");
  else if (station.state === "ready") parts.push("Ready to learn");
  else if (station.state === "locked") parts.push("Locked");
  else if (station.state === "suggested") parts.push("Suggested from Chat");
  return parts.length === 0 ? "" : ` ${parts.join(", ")}`;
}

function primaryLine(map: LearnMap, station: LearnMapStation): LearnMapLine | null {
  for (const id of station.lineIds) {
    const line = map.lines.find((item) => item.id === id);
    if (line) return line;
  }
  return null;
}

function glyphColor(map: LearnMap, station: LearnMapStation): string {
  const line = primaryLine(map, station);
  return line ? linePaint(line.color) : "var(--foreground)";
}

function chipColor(map: LearnMap, station: LearnMapStation): string {
  if (station.state === "due") return "var(--due)";
  const line = primaryLine(map, station);
  return line ? linePaint(line.color) : "var(--muted-foreground)";
}

function isInterchange(map: LearnMap, station: LearnMapStation): boolean {
  let count = 0;
  for (const id of station.lineIds) {
    if (map.lines.some((line) => line.id === id)) count += 1;
  }
  return count >= 2;
}

function neighbors(
  map: LearnMap,
  id: string,
): { readonly needs: string[]; readonly unlocks: string[] } {
  const needs: string[] = [];
  const unlocks: string[] = [];
  for (const edge of map.edges) {
    if (edge.to === id) needs.push(edge.from);
    if (edge.from === id) unlocks.push(edge.to);
  }
  return { needs, unlocks };
}

function clientToSvg(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const matrix = svg.getScreenCTM();
  if (!matrix) return { x: 0, y: 0 };
  const mapped = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
  return { x: mapped.x, y: mapped.y };
}
