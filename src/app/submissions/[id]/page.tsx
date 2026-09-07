import { notFound } from "next/navigation";
import { latestSnapshotsByCard, listCards } from "@/lib/cards";
import { getSubmission } from "@/lib/submissions";
import { SubmissionDetail } from "@/components/SubmissionDetail";

export const dynamic = "force-dynamic";

export default async function SubmissionPage({ params }: PageProps<"/submissions/[id]">) {
  const { id } = await params;
  const n = Number(id);
  const submission = Number.isInteger(n) ? getSubmission(n) : null;
  if (!submission) notFound();

  const inBatch = new Set(submission.cards.map((c) => c.cardId));
  const prices = latestSnapshotsByCard();
  // Raw cards that could still be added, best candidates first.
  const candidates = listCards()
    .filter((c) => !c.grade && c.quantity > 0 && !inBatch.has(c.id))
    .map((c) => {
      const s = prices.get(c.id)?.summary;
      return {
        id: c.id,
        name: c.name,
        detail: [c.setName, c.cardNumber ? `#${c.cardNumber}` : null, c.year].filter(Boolean).join(" · ") || "—",
        raw: s?.yourCopyValue ?? s?.ungraded ?? null,
        best: s?.graded["PSA 10"] ?? s?.estimatedGraded["PSA 10"] ?? null,
        status: c.gradingStatus,
      };
    })
    .sort((a, b) => (b.best ?? 0) - (a.best ?? 0));

  return <SubmissionDetail submission={submission} candidates={candidates} />;
}
