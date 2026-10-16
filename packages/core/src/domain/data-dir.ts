import path from "node:path";

/**
 * Where a domain app keeps its data: `<PREFIX>_DATA_DIR`, else `data` beside
 * the working directory. Only resolved, never created, so the proxy can ask
 * where the session key goes without opening anything.
 *
 * The database (db.ts) and the session key (auth.ts) both ask here, so a key
 * can never land in one directory and the collection in another.
 */
export function domainDataDir(envPrefix: string): string {
  const configured = process.env[`${envPrefix}_DATA_DIR`];
  return configured ? path.resolve(configured) : path.resolve(process.cwd(), "data");
}
