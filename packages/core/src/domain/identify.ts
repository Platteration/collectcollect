import { z, type ZodType } from "zod";
import type { Identification } from "./spec";

/**
 * Photo identification with Claude's vision model, for any collectible.
 *
 * Each app supplies a zod schema describing what it wants read off the photo
 * — the `.describe()` strings are the prompt for each field — and a system
 * prompt with the domain's own guidance. This module does the rest: image
 * preparation, the structured-output call, error mapping, refusal handling,
 * and a normalisation pass that trims every string and clamps the confidence.
 */

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

/** The fields every identification carries, to spread into a domain's schema. */
export const identificationBase = {
  confidence: z.number().min(0).max(1).describe("How confident you are in the primary identification, 0 to 1."),
  alternatives: z
    .array(
      z.object({
        label: z.string().describe("The alternative, named the way its own record would be titled."),
        reason: z.string().describe("Why it could be this instead."),
      }),
    )
    .describe("Other plausible identifications when uncertain. Empty when confident."),
  search_query: z.string().describe("A concise query a price-guide search box would accept for this exact thing."),
};

export interface IdentifyConfig {
  schema: ZodType;
  systemPrompt: string;
  prompt: string;
}

export interface ImageInput {
  buffer: Buffer;
}

function trimDeep(value: unknown): unknown {
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) return value.map(trimDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = trimDeep(v);
    return out;
  }
  return value;
}

export function createIdentifier(config: IdentifyConfig, prepare: (buffer: Buffer) => Promise<{ data: string; mediaType: "image/jpeg" }>) {
  async function identify(images: ImageInput[], hint?: string): Promise<Identification> {
    if (images.length === 0) throw new IdentifyError("At least one image is required", 400);
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const { zodOutputFormat } = await import("@anthropic-ai/sdk/helpers/zod");
    const client = new Anthropic();
    const content: Array<{ type: "image"; source: { type: "base64"; media_type: "image/jpeg"; data: string } } | { type: "text"; text: string }> = [];
    for (const image of images) {
      const prepared = await prepare(image.buffer);
      content.push({ type: "image", source: { type: "base64", media_type: prepared.mediaType, data: prepared.data } });
    }
    content.push({
      type: "text",
      text: config.prompt + (hint?.trim() ? `\n\nOwner's hint (may be incomplete or wrong): ${hint.trim()}` : ""),
    });

    let response;
    try {
      response = await client.beta.messages.parse({
        model: claudeModel(),
        max_tokens: 16000,
        system: config.systemPrompt,
        thinking: { type: "adaptive" },
        // Server-side refusal fallback: if a safety classifier declines, the API
        // re-runs the request on a fallback model inside the same call.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        messages: [{ role: "user", content }],
        output_config: { format: zodOutputFormat(config.schema as never) },
      });
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError) {
        throw new IdentifyError("Anthropic API credentials are missing or invalid. Set ANTHROPIC_API_KEY (see .env.example).", 401);
      }
      if (error instanceof Anthropic.RateLimitError) throw new IdentifyError("Rate limited by the Anthropic API. Try again in a moment.", 429);
      if (error instanceof Anthropic.BadRequestError) throw new IdentifyError(`The identification request was rejected: ${error.message}`, 400);
      if (error instanceof Anthropic.APIConnectionError) throw new IdentifyError("Could not reach the Anthropic API. Check your network connection.", 502);
      if (error instanceof Anthropic.APIError) throw new IdentifyError(`Anthropic API error (${error.status}): ${error.message}`, 502);
      if (error instanceof Anthropic.AnthropicError || (error instanceof Error && /resolve authentication method/i.test(error.message))) {
        throw new IdentifyError("No Anthropic credentials found. Set ANTHROPIC_API_KEY (see .env.example) or run `ant auth login`.", 401);
      }
      throw error;
    }

    if (response.stop_reason === "refusal") {
      const why = response.stop_details?.type === "refusal" ? response.stop_details.explanation : null;
      throw new IdentifyError(`The model declined to analyze this image${why ? `: ${why}` : "."}`, 422);
    }
    if (response.stop_reason === "max_tokens") throw new IdentifyError("The identification response was cut off. Try a clearer photo.", 502);
    const parsed = response.parsed_output as Record<string, unknown> | null;
    if (!parsed) throw new IdentifyError("The model returned an unparseable identification. Try again.", 502);
    const cleaned = trimDeep(parsed) as Record<string, unknown>;
    const confidence = Number(cleaned.confidence);
    return {
      ...cleaned,
      confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0,
      alternatives: Array.isArray(cleaned.alternatives) ? (cleaned.alternatives as Identification["alternatives"]) : [],
    } as Identification;
  }

  return { identify };
}
