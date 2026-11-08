import {
  type EnvironmentId,
  UNIVERSAL_SPACES,
  universalSpaceOfProject,
  type UniversalSpace,
} from "@t3tools/contracts";

export function parseStoredSpace(raw: string | null): UniversalSpace | null {
  return raw !== null && (UNIVERSAL_SPACES as ReadonlyArray<string>).includes(raw)
    ? (raw as UniversalSpace)
    : null;
}

/** Code keeps every ordinary project. Chat and Learn keep only their project. Memory stays hidden. */
export function threadBelongsToSpace(projectId: string, space: UniversalSpace): boolean {
  const owner = universalSpaceOfProject(projectId);
  return owner !== "system" && owner === space;
}

export function resolveSpaceEnvironmentId(
  space: "chat" | "learn",
  chosen: Partial<Record<"chat" | "learn", EnvironmentId>>,
  environments: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly isEnabled: boolean;
    readonly isRelayManaged: boolean;
  }>,
): EnvironmentId | null {
  const enabled = environments.filter((environment) => environment.isEnabled);
  const preferred = chosen[space];
  if (
    preferred !== undefined &&
    enabled.some((environment) => environment.environmentId === preferred)
  ) {
    return preferred;
  }
  return (
    enabled.find((environment) => !environment.isRelayManaged)?.environmentId ??
    enabled[0]?.environmentId ??
    null
  );
}
