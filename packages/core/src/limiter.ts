/**
 * A rate limit that holds across a whole process.
 *
 * Steam's market endpoint answers roughly twenty times a minute and then starts
 * refusing, and a refusal costs more than a wait: it comes back as an error for
 * that item, and pricing a four-hundred-item inventory would turn into four
 * hundred errors. So requests queue rather than race, and the queue is one
 * shared thing — two refreshes running at once must not each think they have
 * the whole budget. When a market does refuse and says how long to wait, the
 * whole queue waits that long, rather than asking again at the same pace and
 * collecting a refusal per item.
 */
export interface RateLimit {
  /** Wait until it is this caller's turn, then let it through; an aborted signal lets it stop waiting. */
  take(signal?: AbortLike): Promise<void>;
  /** Hold every caller back for this long, measured from now, because a market asked. */
  cooldown(ms: number): void;
  /** How many are waiting, for anything that wants to report progress. */
  readonly waiting: number;
}

/** What `take` needs of an AbortSignal: the flag, and a way to hear it flip. */
export interface AbortLike {
  readonly aborted: boolean;
  addEventListener?(type: "abort", listener: () => void, options?: { once?: boolean }): void;
  removeEventListener?(type: "abort", listener: () => void): void;
}

/** A sleep that ends early when the signal aborts, and clears its timer either way. */
function defaultSleep(ms: number, signal?: AbortLike): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener?.("abort", done, { once: true });
  });
}

class Window implements RateLimit {
  /** When each of the last `max` requests went out. */
  private readonly recent: number[] = [];
  private queue: Promise<void> = Promise.resolve();
  private queued = 0;
  /** Nothing goes out before this moment: a market said to wait. */
  private pausedUntil = 0;

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number, signal?: AbortLike) => Promise<void> = defaultSleep,
  ) {}

  get waiting(): number {
    return this.queued;
  }

  cooldown(ms: number): void {
    this.pausedUntil = Math.max(this.pausedUntil, this.now() + Math.max(0, ms));
  }

  take(signal?: AbortLike): Promise<void> {
    this.queued++;
    // Chaining rather than running in parallel is the point: each caller waits
    // for the one in front, so the window is never oversubscribed by callers
    // that all checked it at the same moment.
    const turn = this.queue.then(async () => {
      try {
        if (signal?.aborted) return;
        for (;;) {
          const now = this.now();
          if (now < this.pausedUntil) {
            await this.sleep(this.pausedUntil - now, signal);
            if (signal?.aborted) return;
            continue;
          }
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
          await this.sleep(Math.max(1, wait), signal);
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
  clock?: { now: () => number; sleep: (ms: number, signal?: AbortLike) => Promise<void> },
): RateLimit {
  return new Window(max, windowMs, clock?.now, clock?.sleep);
}

/** A limit that never waits, for a provider that does not need one. */
export const NO_LIMIT: RateLimit = {
  take: async () => undefined,
  cooldown: () => undefined,
  get waiting() {
    return 0;
  },
};

/**
 * How long a Retry-After header asks for, in milliseconds: a number of
 * seconds or an HTTP date, and `fallback` when the header is missing or says
 * something else, since a refusal with no advice still wants a pause.
 */
export function retryAfterMs(header: string | null | undefined, now = Date.now(), fallback = 60_000): number {
  if (!header) return fallback;
  const seconds = Number(header.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, at - now) : fallback;
}
