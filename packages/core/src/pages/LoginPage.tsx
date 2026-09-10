import { redirect } from "next/navigation";
import type { Engine } from "../domain/engine";
import { LoginForm } from "../components/LoginForm";

export async function LoginPage<F extends object, S extends object, X extends object, Q>({ engine, searchParams }: { engine: Engine<F, S, X, Q>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!engine.auth.authEnabled()) redirect("/");
  const next = (await searchParams).next;
  return <LoginForm next={typeof next === "string" ? next : "/"} note="This collection is password protected." />;
}
