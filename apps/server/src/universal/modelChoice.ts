import { isProviderAvailable, type ModelSelection, type ServerProvider } from "@t3tools/contracts";

const canRun = (provider: ServerProvider) =>
  provider.enabled &&
  provider.installed &&
  provider.status !== "error" &&
  provider.status !== "disabled" &&
  isProviderAvailable(provider);

/**
 * First fallback whose provider can run on this environment, else the default model of the
 * first provider that can. An empty registry has not probed yet, so the first fallback stands.
 */
export function pickRunnableModel(
  candidates: ReadonlyArray<ModelSelection | null | undefined>,
  providers: ReadonlyArray<ServerProvider>,
): ModelSelection | null {
  const present = candidates.filter((candidate): candidate is ModelSelection => candidate != null);
  if (providers.length === 0) return present[0] ?? null;
  const runnable = providers.filter(canRun);
  const known = present.find((candidate) =>
    runnable.some((provider) => provider.instanceId === candidate.instanceId),
  );
  if (known !== undefined) return known;
  for (const provider of runnable) {
    const model = provider.models.find((entry) => entry.isDefault === true) ?? provider.models[0];
    if (model !== undefined) return { instanceId: provider.instanceId, model: model.slug };
  }
  return null;
}
