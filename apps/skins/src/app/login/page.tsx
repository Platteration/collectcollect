import { redirect } from "next/navigation";
import { auth, authEnabled } from "@/lib/auth";
import { LoginForm } from "@collectcollect/core/components/LoginForm";
import { googleOffer } from "@collectcollect/core/google-config";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (!authEnabled()) redirect("/");
  const { next, signin } = await searchParams;
  const passwordSet = auth.passwordEnabled();
  const back = typeof next === "string" ? next : "/";
  return (
    <LoginForm
      next={back}
      note={passwordSet ? "This inventory is password protected." : "This inventory is private."}
      passwordSet={passwordSet}
      google={googleOffer(auth.google(), back)}
      signinFailed={signin === "failed"}
    />
  );
}
