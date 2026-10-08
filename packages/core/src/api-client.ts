"use client";

/** A refusal from the app's own API, with what the caller can do about it. */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    /** Seconds the server asked for before trying again, when it said. */
    public readonly retryAfter: number | null = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Tiny fetch wrapper for the app's own JSON API. */
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body instanceof FormData ? init.headers : { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    const header = res.headers.get("Retry-After");
    const retryAfter = header && /^\d+$/.test(header) ? Number(header) : null;
    throw new ApiError(body.error ?? `Request failed (${res.status})`, res.status, retryAfter);
  }
  return body;
}

/**
 * Run something the server may ask to wait for. A 429 carries how long; the
 * wait is taken, said out loud through `onWait`, and the call is made again —
 * a few times, since a queue of photos hitting one identifier is exactly when
 * the server says so. Anything else, or the last refusal, is thrown as it was.
 */
export async function withRetryAfter<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; onWait?: (seconds: number) => void; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 429 || attempt >= attempts) throw e;
      const seconds = Math.min(60, Math.max(1, e.retryAfter ?? 5));
      opts.onWait?.(seconds);
      await sleep(seconds * 1000);
    }
  }
}

/**
 * Run tasks a few at a time rather than all at once. Fanning every upload out
 * together is how a page hits its own server's limits; two in flight keeps
 * the queue moving and the server answering.
 */
export async function runQueue<T>(tasks: Array<() => Promise<T>>, concurrency = 2): Promise<void> {
  const queue = [...tasks];
  await Promise.all(
    Array.from({ length: Math.max(1, concurrency) }, async () => {
      for (let next = queue.shift(); next; next = queue.shift()) await next();
    }),
  );
}
