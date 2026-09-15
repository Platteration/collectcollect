"use client";

import { ErrorPage } from "@collectcollect/core/components/ErrorPage";

export default function AppError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorPage thing="inventory" {...props} />;
}
