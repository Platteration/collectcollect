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
  for (const [i, line] of lines.entries()) {
    const match = /^(#{1,6})\s+(.*)$/.exec(line);
    if (!match) continue;
    const [, hashes = "", title = ""] = match;
    if (start === -1) {
      if (hashes.length >= minLevel && title.trim().toLowerCase() === wanted) {
        start = i + 1;
        level = hashes.length;
      }
    } else if (hashes.length <= level) {
      return lines.slice(start, i).join("\n").trim();
    }
  }
  return start === -1 ? null : lines.slice(start).join("\n").trim();
}

/** A fenced code block of the given language inside a section. */
export function readFenced(body: string, heading: string, language = "json"): string | null {
  const section = readSection(body, heading);
  if (!section) return null;
  const inner = new RegExp("```" + language + "\\n([\\s\\S]*?)```").exec(section)?.[1];
  return inner === undefined ? null : inner.trim();
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

/**
 * Money as written into a file that is also the record.
 *
 * Two decimals as a minimum, so a whole dollar still reads "$1.00" — but never
 * a maximum of two. A case bought at $0.035 or a fee of $1.005 would round on
 * the way out and come back changed on the way in, and the file is meant to be
 * read back as what was recorded, not as an approximation of it.
 */
export function money(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

/** Read a number back out of a cell like "$1,234.50" or "1234.5". */
export function readMoney(text: string): number | null {
  if (!text || !/\d/.test(text)) return null;
  const n = Number(text.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Cells
//
// A folder read back in is a file someone else may have written, up to the
// import's 64 MB, and every cell below used to be read with a pattern whose
// space slots or lazy part sat beside one another, so a long cell was tried
// every possible way before it was given up on: a lot cell of two thousand
// spaces held the server for four seconds, and the time grew with the cube of
// the cell's length. Each is a scan now, reading exactly what its pattern
// read, line breaks included: the `.` in those patterns never matched one, so
// a part holding one still reads as nothing.
// ---------------------------------------------------------------------------

const LINE_BREAK = /[\n\r\u2028\u2029]/;

/**
 * One part of a purchase-lot cell, `2 @ $1.50 (2026-03-01)`: the count, the
 * cost as written and the day, or null when the part is not one. What
 * `/^\s*(\d+)\s*@\s*(.*?)\s*(?:\((\d{4}-\d{2}-\d{2})\))?\s*$/` read.
 */
export function readLotPart(part: string): { quantity: string; cost: string; day: string | null } | null {
  const text = part.trim();
  const head = /^(\d+)\s*@/.exec(text);
  if (!head) return null;
  let cost = text.slice(head[0].length).trim();
  const dated = /\((\d{4}-\d{2}-\d{2})\)$/.exec(cost);
  if (dated) cost = cost.slice(0, dated.index).trimEnd();
  if (LINE_BREAK.test(cost)) return null;
  return { quantity: head[1] ?? "", cost, day: dated?.[1] ?? null };
}

/**
 * A value and the source it names in brackets at the end,
 * `$8.00 (Scryfall (TCGplayer-derived USD))`. Source labels carry brackets of
 * their own, so the source runs from the first bracket to the last. What
 * `/^(.*?)\s*\((.*)\)\s*$/` read.
 */
export function splitSource(text: string): { rest: string; source: string | null } {
  const whole = text.trim();
  if (whole.endsWith(")")) {
    // The source may not hold a line break, so it opens after the last one.
    const lastBreak = Math.max(...["\n", "\r", "\u2028", "\u2029"].map((mark) => whole.lastIndexOf(mark)));
    const open = whole.indexOf("(", lastBreak + 1);
    const rest = open === -1 ? "" : whole.slice(0, open).trim();
    if (open !== -1 && !LINE_BREAK.test(rest)) return { rest, source: whole.slice(open + 1, -1).trim() || null };
  }
  return { rest: whole, source: null };
}
