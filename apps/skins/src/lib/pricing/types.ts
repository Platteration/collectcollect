import type { PriceQuote, PriceSource } from "../types";

/** The subset of item fields a provider needs to find a listing. */
export interface ItemQuery {
  /** Steam's own name, which every market agrees on. This is the whole key. */
  marketHashName: string;
  externalIds?: Record<string, string>;
}

export interface PriceProvider {
  id: PriceSource;
  label: string;
  optional: boolean;
  note: string;
  isConfigured(): boolean;

  /**
   * Load a whole catalogue before a run of lookups.
   *
   * The card app never needed this: every source there answers one card at a
   * time. Skinport publishes every price in a single response, and for a
   * four-hundred-item inventory that is one request instead of four hundred —
   * so a provider may say it prefers to be primed, and `lookup` then answers
   * from what priming loaded.
   *
   * Optional, and always safe to skip: a provider whose priming failed falls
   * back to whatever `lookup` can do alone, or reports the failure per item.
   */
  prime?(fetchImpl?: typeof fetch): Promise<void>;

  lookup(query: ItemQuery, fetchImpl?: typeof fetch): Promise<PriceQuote[]>;
}

export class ProviderError extends Error {
  constructor(
    public readonly source: string,
    message: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
