import AsyncStorage from "@react-native-async-storage/async-storage";
import { type EnvironmentId, type UniversalSpace } from "@t3tools/contracts";
import { useSyncExternalStore } from "react";

import { parseStoredSpace } from "./spaceMembership";

const SPACE_KEY = "b3:last-space";
const ENVIRONMENT_KEY = "b3:space-environment";

type SpaceEnvironments = Partial<Record<"chat" | "learn", EnvironmentId>>;

export interface SpaceSnapshot {
  readonly ready: boolean;
  readonly space: UniversalSpace;
  readonly environments: SpaceEnvironments;
}

let snapshot: SpaceSnapshot = { ready: false, space: "code", environments: {} };
let touched = false;
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

const parseEnvironments = (raw: string | null): SpaceEnvironments => {
  if (raw === null || raw.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const record = parsed as Record<string, unknown>;
    const environments: { chat?: EnvironmentId; learn?: EnvironmentId } = {};
    if (typeof record.chat === "string" && record.chat.length > 0) {
      environments.chat = record.chat as EnvironmentId;
    }
    if (typeof record.learn === "string" && record.learn.length > 0) {
      environments.learn = record.learn as EnvironmentId;
    }
    return environments;
  } catch {
    return {};
  }
};

const persist = (next: SpaceSnapshot) => {
  void AsyncStorage.setItem(SPACE_KEY, next.space).catch(() => undefined);
  void AsyncStorage.setItem(ENVIRONMENT_KEY, JSON.stringify(next.environments)).catch(
    () => undefined,
  );
};

void AsyncStorage.getMany([SPACE_KEY, ENVIRONMENT_KEY])
  .then((entries) => {
    if (touched) {
      snapshot = { ...snapshot, ready: true };
      emit();
      return;
    }
    snapshot = {
      ready: true,
      space: parseStoredSpace(entries[SPACE_KEY] ?? null) ?? "code",
      environments: parseEnvironments(entries[ENVIRONMENT_KEY] ?? null),
    };
    emit();
  })
  .catch(() => {
    snapshot = { ...snapshot, ready: true };
    emit();
  });

export function readSpaceSnapshot(): SpaceSnapshot {
  return snapshot;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSpaceStore<A>(select: (snapshot: SpaceSnapshot) => A): A {
  return select(useSyncExternalStore(subscribe, readSpaceSnapshot, readSpaceSnapshot));
}

export function setSpace(space: UniversalSpace) {
  touched = true;
  if (snapshot.ready && snapshot.space === space) return;
  snapshot = { ...snapshot, ready: true, space };
  emit();
  persist(snapshot);
}

export function setSpaceEnvironment(space: "chat" | "learn", environmentId: EnvironmentId | null) {
  touched = true;
  const environments = { ...snapshot.environments };
  if (environmentId === null) delete environments[space];
  else environments[space] = environmentId;
  snapshot = { ...snapshot, ready: true, environments };
  emit();
  persist(snapshot);
}
