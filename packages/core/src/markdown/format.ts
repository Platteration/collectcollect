/**
 * The encoding used by the plain-text copy of a collection.
 *
 * Front matter is YAML-shaped but every value is written as JSON, which YAML
 * accepts verbatim. That means the files open correctly in Obsidian, Jekyll,
 * Logseq or anything else that reads front matter, while the parser here stays
 * small enough to be obvious. Reading is deliberately forgiving: a value that
 * is not valid JSON is taken as a plain string, so a file edited by hand in a
 * text editor still loads.
 */

export interface Document {
  data: Record<string, unknown>;
  body: string;
}

const FENCE = "---";

/** Write front matter, skipping empty values so the files stay readable. */
export function writeFrontMatter(fields: Record<string, unknown>): string {
  const lines: string[] = [FENCE];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (isPlainObject(value) && Object.keys(value).length === 0) continue;
    lines.push(`${key}: ${JSON.stringify(value)}`);
  }
  lines.push(FENCE, "");
  return lines.join("\n");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Split a document into its front matter and the prose beneath it. A file with
 * no front matter is all body, which is how a stray Markdown file dropped into
 * the folder is recognised as "not one of ours" rather than misread.
 */
export function parseDocument(text: string): Document {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (!normalized.startsWith(`${FENCE}\n`)) return { data: {}, body: normalized };
  const end = normalized.indexOf(`\n${FENCE}`, FENCE.length);
  if (end === -1) return { data: {}, body: normalized };
  const head = normalized.slice(FENCE.length + 1, end);
  const rest = normalized.slice(end + FENCE.length + 1);
  const data: Record<string, unknown> = {};
  for (const line of head.split("\n")) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    // Assigning "__proto__" would set this object's prototype rather than a
    // field on it, so a hand-written file could reshape what it parses into.
    if (!key || key === "__proto__") continue;
    data[key] = readValue(line.slice(colon + 1).trim());
  }
  return { data, body: rest.replace(/^\n+/, "") };
}

function readValue(raw: string): unknown {
  if (raw === "") return null;
  try {
    return JSON.parse(raw);
  } catch {
    // Hand-edited: `name: Charizard` rather than `name: "Charizard"`.
    const unquoted = raw.replace(/^['"]|['"]$/g, "");
    if (unquoted === "true") return true;
    if (unquoted === "false") return false;
    if (unquoted === "null" || unquoted === "~") return null;
    return unquoted;
  }
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

/** Escape a value for a table cell: pipes and newlines would break the row. */
export function cell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ").trim() || "—";
}

export function table(headers: string[], rows: Array<Array<unknown>>): string {
  const lines = [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
  ];
  return lines.join("\n");
}

/**
 * Read back a table written by `table()`, minus its header. Rows are returned
 * however wide they are: judging whether one makes sense belongs to the caller,
 * which can say so, rather than here, which would drop it silently.
 */
export function readTable(body: string, heading: string): string[][] {
  const section = readSection(body, heading);
  if (!section) return [];
  const rows: string[][] = [];
  let seenHeader = false;
  for (const line of section.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    const cells = splitRow(trimmed);
    if (cells.length && cells.every((c) => /^:?-{2,}:?$/.test(c))) continue; // separator
    if (!seenHeader) {
      seenHeader = true;
      continue; // header
    }
    rows.push(cells.map((c) => (c === "—" ? "" : c)));
  }
  return rows;
}

function splitRow(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  for (let i = 1; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\" && line[i + 1] === "|") {
      current += "|";
      i++;
    } else if (ch === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) cells.push(current.trim());
  return cells;
}

/**
 * The text under a `## Heading`, up to the next heading of the same level or
 * higher. The document's own title is an H1, so sections start at H2: a card
 * called "Notes" is a title, not the notes section.
 */
export function readSection(body: string, heading: string, minLevel = 2): string | null {
  const lines = body.split("\n");
  const wanted = heading.trim().toLowerCase();
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const match = /^(#{1,6})\s+(.*)$/.exec(lines[i]);
    if (!match) continue;
    if (start === -1) {
      if (match[1].length >= minLevel && match[2].trim().toLowerCase() === wanted) {
        start = i + 1;
        level = match[1].length;
      }
    } else if (match[1].length <= level) {
      return lines.slice(start, i).join("\n").trim();
    }
  }
  return start === -1 ? null : lines.slice(start).join("\n").trim();
}

/** A fenced code block of the given language inside a section. */
export function readFenced(body: string, heading: string, language = "json"): string | null {
  const section = readSection(body, heading);
  if (!section) return null;
  const match = new RegExp("```" + language + "\\n([\\s\\S]*?)```").exec(section);
  return match ? match[1].trim() : null;
}

/** File-system-safe, readable stem for a card: `0007-charizard-base-set`. */
export function slug(text: string, max = 60): string {
  const cleaned = text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned.slice(0, max).replace(/-+$/g, "");
}

/** Money for a human, without a currency symbol the file cannot promise. */
export function money(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** Read a number back out of a cell like "$1,234.50" or "1234.5". */
export function readMoney(text: string): number | null {
  if (!text || !/\d/.test(text)) return null;
  const n = Number(text.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}
