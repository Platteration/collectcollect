import type { Game, PriceQuote, PriceSource } from "../types";

/** The subset of card fields providers need to find a product. */
export interface CardQuery {
  game: Game;
  name: string;
  sport?: string | null;
  setName?: string | null;
  setCode?: string | null;
  cardNumber?: string | null;
  year?: number | null;
  variant?: string | null;
  /** A sports card's parallel as a price guide names it: "Gold Refractor", with "Auto" and "Relic" when it has them. */
  parallel?: string | null;
  manufacturer?: string | null;
  externalIds?: Record<string, string>;
}

export interface PriceProvider {
  id: PriceSource;
  label: string;
  games: Game[];
  optional: boolean;
  note: string;
  isConfigured(): boolean;
  /** The signal is the caller's deadline: a request still out when it fires is abandoned. */
  lookup(query: CardQuery, fetchImpl?: typeof fetch, signal?: AbortSignal): Promise<PriceQuote[]>;
}

export class ProviderError extends Error {
  constructor(
    public readonly source: string,
    message: string,
    /**
     * The HTTP status of a refusal the provider understood. A ProviderError
     * that has one carries a message this app wrote (never the provider's own
     * words), so a connection test shows it as it stands.
     */
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
