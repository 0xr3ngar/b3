import {
  type EnvironmentId,
  UNIVERSAL_SPACES,
  universalSpaceOfProject,
  type UniversalSpace,
} from "@t3tools/contracts";
import { create } from "zustand";

const SPACE_KEY = "b3:last-space";
const ENVIRONMENT_KEY = "b3:space-environment";

const readStored = <A>(key: string, parse: (raw: string) => A | null): A | null => {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw == null ? null : parse(raw);
  } catch {
    return null;
  }
};
const writeStored = (key: string, value: string | null) => {
  try {
    if (value === null) globalThis.localStorage?.removeItem(key);
    else globalThis.localStorage?.setItem(key, value);
  } catch {
    // Private windows refuse storage; the choice lasts for this session only.
  }
};

const parseSpace = (raw: string): UniversalSpace | null =>
  (UNIVERSAL_SPACES as ReadonlyArray<string>).includes(raw) ? (raw as UniversalSpace) : null;

type SpaceEnvironments = Partial<Record<"chat" | "learn", EnvironmentId>>;

interface SpaceState {
  /** The space chosen last; the open thread's project wins over it while one is open. */
  readonly space: UniversalSpace;
  /** Which machine hosts Chat and Learn; unset means the primary environment. */
  readonly environments: SpaceEnvironments;
  readonly setSpace: (space: UniversalSpace) => void;
  readonly setEnvironment: (space: "chat" | "learn", environmentId: EnvironmentId | null) => void;
}

export const useSpaceStore = create<SpaceState>((set, get) => ({
  space: readStored(SPACE_KEY, parseSpace) ?? "code",
  environments:
    readStored(ENVIRONMENT_KEY, (raw) => JSON.parse(raw) as SpaceEnvironments) ?? {},
  setSpace: (space) => {
    writeStored(SPACE_KEY, space);
    set({ space });
  },
  setEnvironment: (space, environmentId) => {
    const environments = { ...get().environments };
    if (environmentId === null) delete environments[space];
    else environments[space] = environmentId;
    writeStored(ENVIRONMENT_KEY, JSON.stringify(environments));
    set({ environments });
  },
}));

/** Space of an open thread or draft's project, or the remembered space with nothing open. */
export function resolveActiveSpace(input: {
  readonly routeProjectId: string | null;
  readonly storedSpace: UniversalSpace;
}): UniversalSpace {
  if (input.routeProjectId === null) return input.storedSpace;
  const space = universalSpaceOfProject(input.routeProjectId);
  return space === "system" ? "code" : space;
}

export function threadBelongsToSpace(projectId: string, space: UniversalSpace): boolean {
  const owner = universalSpaceOfProject(projectId);
  return owner !== "system" && owner === space;
}
