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
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
