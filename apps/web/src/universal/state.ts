import { createUniversalAtoms } from "@t3tools/client-runtime/state/universal";

import { connectionAtomRuntime } from "../connection/runtime";

export const universal = createUniversalAtoms(connectionAtomRuntime);
