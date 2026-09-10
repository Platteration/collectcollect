import { createEngine } from "@collectcollect/core/domain/engine";
import { spec } from "./spec";

/** Everything the pages and routes need, built from the spec. */
export const engine = createEngine(spec);
