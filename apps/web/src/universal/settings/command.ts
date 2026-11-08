import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { useRef, useState } from "react";

import { toastManager } from "../../components/ui/toast";

function commandErrorText(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.trim().length > 0
  ) {
    return error.message;
  }
  return "The request failed.";
}

async function finishCommand<A>(
  pending: Promise<AtomCommandResult<A, unknown>>,
  title: string,
): Promise<A | null> {
  const result = await pending;
  if (result._tag === "Success") return result.value;
  if (!isAtomCommandInterrupted(result)) {
    toastManager.add({
      type: "error",
      title,
      description: commandErrorText(squashAtomCommandFailure(result)),
    });
  }
  return null;
}

/** One settings action at a time. `run` resolves true when the command succeeded. */
export function useUniversalAction() {
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);

  const run = async <A>(
    title: string,
    start: () => Promise<AtomCommandResult<A, unknown>>,
    after?: (value: A) => void,
  ): Promise<boolean> => {
    if (pendingRef.current) return false;
    pendingRef.current = true;
    setPending(true);
    const value = await finishCommand(start(), title);
    pendingRef.current = false;
    setPending(false);
    if (value === null) return false;
    after?.(value);
    return true;
  };

  return { pending, run };
}
