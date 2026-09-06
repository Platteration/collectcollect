import { AddCardFlow } from "@/components/AddCardFlow";
import { isClaudeConfigured } from "@/lib/identify/claude";

export const dynamic = "force-dynamic";

export default function AddPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Add cards</h1>
      <AddCardFlow claudeConfigured={isClaudeConfigured()} />
    </div>
  );
}
