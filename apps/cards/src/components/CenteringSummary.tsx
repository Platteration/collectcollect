import { capsFor, ratioText } from "@/lib/grading/centering";
import type { Centering, Game } from "@/lib/types";

/**
 * A card's measured centering and how far each company's published limits
 * would let it grade. The limits are approximate and the line says so.
 */
export function CenteringSummary({ centering, game, empty }: { centering: Centering | null; game: Game; empty?: string }) {
  if (!centering) {
    return <p className="text-sm text-neutral-500">{empty ?? "No centering measured. Enter the ratios with Edit, or identify the card from a photo."}</p>;
  }
  const caps = capsFor(centering, game);
  const side = (name: "Front" | "Back", s: Centering["front"]) =>
    s.lr || s.tb ? (
      <div key={name}>
        <dt className="text-xs uppercase tracking-wide text-neutral-500">{name} centering</dt>
        <dd>{[s.lr ? `${ratioText(s.lr)} left-right` : null, s.tb ? `${ratioText(s.tb)} top-bottom` : null].filter(Boolean).join(" · ")}</dd>
      </div>
    ) : null;
  return (
    <div className="space-y-2 text-sm">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
        {side("Front", centering.front)}
        {side("Back", centering.back)}
      </dl>
      {caps.length > 0 && (
        <p data-testid="centering-caps">
          Centering allows up to {caps.map((cap) => cap.label).join(" · ")}.{" "}
          <span className="text-neutral-500">By each company&apos;s published limits, which are approximate; check the company&apos;s page before sending.</span>
        </p>
      )}
    </div>
  );
}
