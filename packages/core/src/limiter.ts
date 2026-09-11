/**
 * A rate limit that holds across a whole process.
 *
 * Steam's market endpoint answers roughly twenty times a minute and then starts
 * refusing, and a refusal costs more than a wait: it comes back as an error for
 * that item, and pricing a four-hundred-item inventory would turn into four
 * hundred errors. So requests queue rather than race, and the queue is one
 * shared thing — two refreshes running at once must not each think they have
 * the whole budget.
 */
export interface RateLimit {
  /** Wait until it is this caller's turn, then let it through. */
  take(signal?: { aborted: boolean }): Promise<void>;
  /** How many are waiting, for anything that wants to report progress. */
  readonly waiting: number;
}

class Window implements RateLimit {
  /** When each of the last `max` requests went out. */
  private readonly recent: number[] = [];
  private queue: Promise<void> = Promise.resolve();
  private queued = 0;

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  get waiting(): number {
    return this.queued;
  }

  take(signal?: { aborted: boolean }): Promise<void> {
    this.queued++;
    // Chaining rather than running in parallel is the point: each caller waits
    // for the one in front, so the window is never oversubscribed by callers
    // that all checked it at the same moment.
    const turn = this.queue.then(async () => {
      try {
        if (signal?.aborted) return;
        for (;;) {
          const now = this.now();
          let oldest = this.recent[0];
          while (oldest !== undefined && now - oldest >= this.windowMs) {
            this.recent.shift();
            oldest = this.recent[0];
          }
          if (this.recent.length < this.max) {
            this.recent.push(now);
            return;
          }
          // Only reached with the window full, so `oldest` is set unless `max`
          // is zero, in which case nothing ever gets through and the caller
          // simply waits a whole window before asking again.
          const wait = this.windowMs - (now - (oldest ?? now));
          await this.sleep(Math.max(1, wait));
          if (signal?.aborted) return;
        }
      } finally {
        this.queued--;
      }
    });
    // The chain must not break on a rejection, or every later caller inherits it.
    this.queue = turn.then(
      () => undefined,
      () => undefined,
    );
    return turn;
  }
}

export function rateLimit(
  max: number,
  windowMs: number,
  clock?: { now: () => number; sleep: (ms: number) => Promise<void> },
): RateLimit {
  return new Window(max, windowMs, clock?.now, clock?.sleep);
}

/** A limit that never waits, for a provider that does not need one. */
export const NO_LIMIT: RateLimit = {
  take: async () => undefined,
  get waiting() {
    return 0;
  },
};
