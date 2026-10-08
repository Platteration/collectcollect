/**
 * A value from a string-keyed table, or undefined.
 *
 * `table[key]` alone finds "constructor", "toString" and the rest of
 * `Object.prototype` for any key a person or a file can supply, and hands back
 * a function where a label was expected. Every lookup keyed by outside text
 * goes through here instead.
 */
export function lookup<T>(table: Record<string, T>, key: string | null | undefined): T | undefined {
  if (key === null || key === undefined) return undefined;
  return Object.hasOwn(table, key) ? table[key] : undefined;
}
