import { getStorageLock } from "@collectcollect/core/storage";
import { createGate, type Gate } from "@collectcollect/core/gate";
export const storageLock = getStorageLock("cards");
const state = globalThis as unknown as { __collectcollectArchiveGate?: Gate };
export const archiveGate = (state.__collectcollectArchiveGate ??= createGate("A backup or restore is already running; try again in a moment"));
