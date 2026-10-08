import type { Verdict } from "@/lib/analytics";

/** Badge classes per grading-timing verdict, shared by the portfolio and card pages. */
export const VERDICT_STYLE: Record<Verdict["kind"], string> = {
  prime: "bg-green-100 text-green-900 dark:bg-green-900 dark:text-green-100",
  wait: "bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100",
  skip: "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-100",
  insufficient: "bg-blue-100 text-blue-900 dark:bg-blue-900 dark:text-blue-100",
};
