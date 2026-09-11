/**
 * One at a time.
 *
 * A whole-collection price refresh takes minutes against rate-limited sources,
 * and two of them running at once — the hourly scheduler and a button press,
 * or two button presses — do not finish sooner. They share the same rate
 * limit, write the same snapshots twice, and make the progress the page shows
 * meaningless. So a refresh takes the gate first, and a second caller is told
 * no rather than queued: the answer it would get is the answer the first one
 * is already producing.
 */

export class BusyError extends Error {
  constructor(message = "Already running") {
    super(message);
    this.name = "BusyError";
  }
}

export interface Gate {
  /** Whether something holds the gate right now. */
  readonly busy: boolean;
  /** Run `work` if the gate is free; throw `BusyError` if it is not. */
  run<T>(work: () => Promise<T>): Promise<T>;
}

export function createGate(message?: string): Gate {
  let held = false;
  return {
    get busy() {
      return held;
    },
    async run(work) {
      if (held) throw new BusyError(message);
      held = true;
      try {
        return await work();
      } finally {
        held = false;
      }
    },
  };
}
