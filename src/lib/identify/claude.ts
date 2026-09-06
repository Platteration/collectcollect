import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { IdentificationSchema } from "./schema";
import type { Identification } from "../types";
import { prepareForVision } from "../images";

export const DEFAULT_MODEL = "claude-opus-5";

export function claudeModel(): string {
  return process.env.CLAUDE_MODEL?.trim() || DEFAULT_MODEL;
}

/** True when an explicit credential is present. The SDK can also pick up an `ant auth login` profile. */
export function isClaudeConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export class IdentifyError extends Error {
  constructor(
    message: string,
    public readonly status: number = 500,
  ) {
    super(message);
    this.name = "IdentifyError";
  }
}

const SYSTEM_PROMPT = `You identify collectible trading cards from photographs for a personal collection catalog.

You will receive one or more photos of a single card (front, and sometimes the back or a grading slab label). Determine exactly which card it is: the game or category, the printed name, the set it belongs to, the collector number, the year, rarity and any printing variant that affects value (holo, reverse holo, 1st edition, shadowless, foil, refractor, parallel, autograph, short print, and so on).

Guidance:
- Read the small print. Set symbols, set codes, copyright lines, collector numbers and rarity symbols are the most reliable clues. Quote numbers exactly as printed.
- Pokémon: distinguish Base Set / Base Set 2 / Shadowless / 1st Edition and Japanese vs. English printings when possible; report the number with its denominator (e.g. 4/102).
- Yu-Gi-Oh!: report the set code printed under the artwork (e.g. LOB-001, SDK-001) and the rarity finish.
- Magic: report the set code and collector number from the bottom-left, and whether the card is foil.
- Sports cards: give the player name, the year and manufacturer/product (e.g. 2011 Topps Update), the card number, and any parallel, refractor, rookie (RC) or autograph designation.
- If the card is in a grading company's slab, read the label for the company, grade and certification number.
- Note visible condition problems only when clearly visible.
- If you cannot be sure, give your best single answer with an honest confidence and list the plausible alternatives.`;


function requestIdentification(client: Anthropic, content: Anthropic.Beta.BetaContentBlockParam[]) {
  return client.beta.messages.parse({
    model: claudeModel(),
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    thinking: { type: "adaptive" },
    // Server-side refusal fallback: if a safety classifier declines, the API
    // re-runs the request on a fallback model inside the same call.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    messages: [{ role: "user", content }],
    output_config: { format: zodOutputFormat(IdentificationSchema) },
  });
}

interface ImageInput {
  buffer: Buffer;
}

export async function identifyCard(images: ImageInput[], hint?: string): Promise<Identification> {
  if (images.length === 0) throw new IdentifyError("At least one image is required", 400);

  const client = new Anthropic();
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const image of images) {
    const prepared = await prepareForVision(image.buffer);
    content.push({
      type: "image",
      source: { type: "base64", media_type: prepared.mediaType, data: prepared.data },
    });
  }
  content.push({
    type: "text",
    text:
      `Identify this trading card.` +
      (hint?.trim() ? `\n\nOwner's hint (may be incomplete or wrong): ${hint.trim()}` : ""),
  });

  let response: Awaited<ReturnType<typeof requestIdentification>>;
  try {
    response = await requestIdentification(client, content);
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      throw new IdentifyError(
        "Anthropic API credentials are missing or invalid. Set ANTHROPIC_API_KEY (see .env.example).",
        401,
      );
    }
    if (error instanceof Anthropic.RateLimitError) {
      throw new IdentifyError("Rate limited by the Anthropic API. Try again in a moment.", 429);
    }
    if (error instanceof Anthropic.BadRequestError) {
      throw new IdentifyError(`The identification request was rejected: ${error.message}`, 400);
    }
    if (error instanceof Anthropic.APIConnectionError) {
      throw new IdentifyError("Could not reach the Anthropic API. Check your network connection.", 502);
    }
    if (error instanceof Anthropic.APIError) {
      throw new IdentifyError(`Anthropic API error (${error.status}): ${error.message}`, 502);
    }
    if (
      error instanceof Anthropic.AnthropicError ||
      (error instanceof Error && /resolve authentication method/i.test(error.message))
    ) {
      // Raised client-side before any request (the SDK throws a plain Error when no
      // credential can be resolved, so the message check is the only handle we have).
      throw new IdentifyError(
        "No Anthropic credentials found. Set ANTHROPIC_API_KEY (see .env.example) or run `ant auth login`.",
        401,
      );
    }
    throw error;
  }

  if (response.stop_reason === "refusal") {
    const why = response.stop_details?.type === "refusal" ? response.stop_details.explanation : null;
    throw new IdentifyError(`The model declined to analyze this image${why ? `: ${why}` : "."}`, 422);
  }
  if (response.stop_reason === "max_tokens") {
    throw new IdentifyError("The identification response was cut off. Try a clearer photo.", 502);
  }
  const parsed = response.parsed_output;
  if (!parsed) {
    throw new IdentifyError("The model returned an unparseable identification. Try again.", 502);
  }
  return normalize(parsed);
}

function normalize(id: Identification): Identification {
  const trim = (s: string | null) => (s && s.trim() ? s.trim() : null);
  return {
    ...id,
    name: id.name.trim(),
    sport: trim(id.sport),
    set_name: trim(id.set_name),
    set_code: trim(id.set_code),
    card_number: trim(id.card_number),
    rarity: trim(id.rarity),
    variant: trim(id.variant),
    language: trim(id.language),
    manufacturer: trim(id.manufacturer),
    subject: trim(id.subject),
    condition_notes: trim(id.condition_notes),
    grading: {
      company: trim(id.grading.company),
      grade: trim(id.grading.grade),
      cert_number: trim(id.grading.cert_number),
    },
    confidence: Math.min(1, Math.max(0, id.confidence)),
    search_query: id.search_query.trim(),
  };
}
