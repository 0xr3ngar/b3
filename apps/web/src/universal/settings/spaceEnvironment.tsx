import type { EnvironmentId } from "@t3tools/contracts";
import { type ReactNode } from "react";

import { SettingsPageContainer } from "../../components/settings/settingsLayout";
import {
  useEnvironments,
  usePrimaryEnvironmentId,
  type EnvironmentPresentation,
} from "../../state/environments";
import { useSpaceStore } from "../spaceStore";

export interface SpaceEnvironmentTarget {
  readonly environmentId: EnvironmentId;
  readonly connected: readonly EnvironmentPresentation[];
  readonly setEnvironment: (environmentId: EnvironmentId) => void;
}

function useSpaceEnvironment(space: "chat" | "learn") {
  const { environments } = useEnvironments();
  const primaryId = usePrimaryEnvironmentId();
  const storedId = useSpaceStore((state) => state.environments[space] ?? null);
  const setStoredEnvironment = useSpaceStore((state) => state.setEnvironment);
  const connected = environments.filter(
    (environment) =>
      environment.connection.phase === "connected" && environment.serverConfig !== null,
  );
  const selected =
    connected.find((environment) => environment.environmentId === storedId) ??
    connected.find((environment) => environment.environmentId === primaryId) ??
    connected[0] ??
    null;
  return {
    environmentId: selected?.environmentId ?? null,
    connected,
    setEnvironment: (environmentId: EnvironmentId) => setStoredEnvironment(space, environmentId),
  };
}

export function SpaceSettingsPage(props: {
  readonly space: "chat" | "learn";
  readonly unavailable: string;
  readonly children: (target: SpaceEnvironmentTarget) => ReactNode;
}) {
  const space = useSpaceEnvironment(props.space);
  const target: SpaceEnvironmentTarget | null =
    space.environmentId === null
      ? null
      : {
          environmentId: space.environmentId,
          connected: space.connected,
          setEnvironment: space.setEnvironment,
        };
  return (
    <SettingsPageContainer>
      {target === null ? (
        <p className="px-3 text-sm text-muted-foreground sm:px-4">{props.unavailable}</p>
      ) : (
        props.children(target)
      )}
    </SettingsPageContainer>
  );
}

export function SettingsQueryMessage(props: { readonly error: string | null }) {
  if (props.error !== null) {
    return <p className="px-3 text-sm text-destructive sm:px-4">{props.error}</p>;
  }
  return <p className="px-3 text-sm text-muted-foreground sm:px-4">Loading…</p>;
}
