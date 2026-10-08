import { getStorageLock } from "@collectcollect/core/storage";
import { createGate, type Gate } from "@collectcollect/core/gate";
export const storageLock = getStorageLock("skins");
const state = globalThis as unknown as { __skinsArchiveGate?: Gate };
export const archiveGate = (state.__skinsArchiveGate ??= createGate("A backup or restore is already running; try again in a moment"));
