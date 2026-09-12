/**
 * `pnpm check:seam` — the two mechanical checks from PLAN §1.6 and ADR-0009.
 *
 * The rule being enforced: nothing under `packages/samsara/**` may know it is about
 * travel. The seam exists so that vertical two is a domain pack rather than a fork,
 * and a seam without a check is a convention — which, per ADR-0009, does not survive
 * a deadline.
 *
 * Two checks, plus one decision about *how* to check that is the whole reason this
 * file is more than a `grep`.
 *
 * **The lexicon is split by how ambiguous the word is in English, not by whether it
 * sits in a comment.** The first instinct was to blank comments and scan only code:
 * the engine is full of sentences like "one round trip", "cancelled mid-flight" and
 * "in one place", and a word-boundary grep flags forty of those, every one a false
 * positive. But that rule is too blunt in the other direction — a comment reading
 * "the plan names Bangkok as the first city" is the engine knowing exactly what it
 * is forbidden to know, and blanking comments makes the check blind to it.
 *
 * So the list is cut in two:
 *
 * - **Unambiguous terms** — `bangkok`, `tokyo`, `postcard`, `itinerary`, `tourist`,
 *   `hotel`, `restaurant`. Nobody writes these by accident. Scanned everywhere,
 *   comments included, because a comment is where domain knowledge leaks first.
 * - **Ordinary English** — `travel`, `trip`, `place`, `flight`, `booking`. Scanned in
 *   code and string literals only, where they are vocabulary rather than prose. A
 *   *prompt* saying "hotel" is a breach; a comment saying "round trip" is a sentence.
 *
 * Within code, matching is by identifier segment rather than word boundary, because
 * `\btravel\b` does not match `travelPack`, `place_id`, or `Asia/Bangkok`. Every
 * identifier is split on case changes and separators and each segment compared, so
 * the check sees what a reader sees. Simple plurals are folded (`places` -> `place`).
 *
 * The escape hatch is `// seam:allow <reason>` on the offending line. It is counted
 * and printed, a reason is mandatory, and an allow that suppresses nothing is an
 * error — otherwise allows accumulate silently and the count stops meaning anything.
 * ADR-0009 sets the ceiling at five: above that the seam is in the wrong place and
 * gets redesigned rather than papered over.
 */

import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"

/**
 * Never ordinary English. Scanned in comments too — this is where the engine leaks
 * first, because a comment is the one place a person explains *why* in product terms.
 */
export const FORBIDDEN_ANYWHERE = [
  "bangkok",
  "tokyo",
  "postcard",
  "itinerary",
  "tourist",
  "hotel",
  "restaurant",
] as const

/**
 * Ordinary English words that are also travel vocabulary. Scanned in code and string
 * literals only: as identifiers they name domain concepts, as prose they are just
 * words ("a round trip", "mid-flight", "in one place").
 */
export const FORBIDDEN_IN_CODE = ["travel", "trip", "place", "flight", "booking"]

/**
 * The same unambiguous terms, in the scripts the people in this market actually
 * type — and which `segments` cannot see.
 *
 * `segments` splits on `[^A-Za-z0-9]+`, so every Thai character is a separator and
 * a Thai string is erased entirely before any comparison happens. Vietnamese fares
 * no better: `khách sạn` breaks into `kh`, `ch`, `s`, `n`. That is not a rounding
 * error. The string `ที่เที่ยวกรุงเทพ` — which ends in the name of a city —
 * sat in an engine test through a green `check:seam`, in the tier that is supposed
 * to be scanned everywhere, invisible to the checker whose whole job is that word.
 * It was caught by a person reading the line, which is the failure mode this file
 * exists to prevent.
 *
 * Matched as plain substrings against the raw line rather than as segments, because
 * Thai is written without spaces and there are no boundaries to match on. A
 * substring rule would be far too blunt for English; for a term that cannot appear
 * in these files by accident, it is exactly right.
 */
export const FORBIDDEN_SUBSTRINGS = [
  "กรุงเทพ", // bangkok
  "โตเกียว", // tokyo
  "โรงแรม", // hotel
  "ร้านอาหาร", // restaurant
  "hà nội", // hanoi
  "khách sạn", // hotel
  "nhà hàng", // restaurant
]

export const FORBIDDEN = [
  ...FORBIDDEN_ANYWHERE,
  ...FORBIDDEN_IN_CODE,
  ...FORBIDDEN_SUBSTRINGS,
] as const

/** ADR-0009: above this, the seam is wrong and gets redesigned, not extended. */
export const MAX_ALLOWS = 5

const SCANNED_EXTENSIONS = [".ts", ".tsx", ".json", ".md", ".sql"]
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", ".turbo", "coverage"])

export interface Hit {
  file: string
  line: number
  term: string
  text: string
}

export interface Allow {
  file: string
  line: number
  reason: string
  used: boolean
}

export interface SeamReport {
  filesScanned: number
  hits: Hit[]
  allows: Allow[]
  badDependencies: { file: string; dependency: string }[]
  badImports: Hit[]
  errors: string[]
}

/**
 * Blanks comments, preserves everything else, and keeps the text the same length so
 * line and column numbers still line up.
 *
 * It tracks string and template state on the way through, which is the point: a
 * naive strip cuts `"https://example.com"` in half at the `//` and silently stops
 * looking at the rest of the line. A seam check that can be blinded by a URL is not
 * a check.
 */
export function blankComments(src: string): string {
  const out: string[] = []
  // Template literals nest: `${ ... `inner` ... }`. A stack is the honest model.
  const stack: ("template" | "interp")[] = []
  let i = 0
  let state: "code" | "line" | "block" | "single" | "double" | "template" = "code"

  while (i < src.length) {
    const c = src[i] as string
    const next = src[i + 1]

    if (state === "code") {
      if (c === "/" && next === "/") {
        state = "line"
        out.push("  ")
        i += 2
        continue
      }
      if (c === "/" && next === "*") {
        state = "block"
        out.push("  ")
        i += 2
        continue
      }
      if (c === "'") state = "single"
      else if (c === '"') state = "double"
      else if (c === "`") {
        state = "template"
        stack.push("template")
      } else if (c === "}" && stack.at(-1) === "interp") {
        stack.pop()
        state = "template"
      }
      out.push(c)
      i += 1
      continue
    }

    if (state === "line") {
      if (c === "\n") {
        state = "code"
        out.push("\n")
      } else {
        out.push(" ")
      }
      i += 1
      continue
    }

    if (state === "block") {
      if (c === "*" && next === "/") {
        state = "code"
        out.push("  ")
        i += 2
        continue
      }
      out.push(c === "\n" ? "\n" : " ")
      i += 1
      continue
    }

    // Inside some kind of string.
    if (c === "\\") {
      out.push(c, src[i + 1] ?? "")
      i += 2
      continue
    }
    if (state === "single" && c === "'") state = "code"
    else if (state === "double" && c === '"') state = "code"
    else if (state === "template") {
      if (c === "`") {
        stack.pop()
        state = "code"
      } else if (c === "$" && next === "{") {
        stack.push("interp")
        state = "code"
        out.push("${")
        i += 2
        continue
      }
    }
    out.push(c)
    i += 1
  }

  return out.join("")
}

/**
 * Splits text into identifier segments the way a reader sees them: `placeId` is
 * "place" and "id"; `Asia/Bangkok` is "asia" and "bangkok"; `refine.places` is
 * "refine" and "place".
 */
export function segments(text: string): string[] {
  const out: string[] = []
  for (const word of text.split(/[^A-Za-z0-9]+/)) {
    if (!word) continue
    for (const part of word.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/)) {
      const lower = part.toLowerCase()
      if (!lower) continue
      out.push(lower)
      // Fold the one plural that matters. Deliberately not a stemmer: a stemmer
      // would start matching words nobody banned.
      if (lower.length > 3 && lower.endsWith("s")) out.push(lower.slice(0, -1))
    }
  }
  return out
}

const ALLOW_PATTERN = /seam:allow\s*(.*)$/

export function scanSource(
  file: string,
  source: string,
  opts: { stripComments: boolean },
): { hits: Hit[]; allows: Allow[]; errors: string[] } {
  const scannable = opts.stripComments ? blankComments(source) : source
  const rawLines = source.split("\n")
  const lines = scannable.split("\n")
  const hits: Hit[] = []
  const allows: Allow[] = []
  const errors: string[] = []

  for (const [index, line] of lines.entries()) {
    const raw = rawLines[index] ?? ""
    const lineNumber = index + 1

    const allowMatch = ALLOW_PATTERN.exec(raw)
    const reason = allowMatch?.[1]
      ?.trim()
      .replace(/\*\/\s*$/, "")
      .trim()
    const allow: Allow | undefined = allowMatch
      ? { file, line: lineNumber, reason: reason ?? "", used: false }
      : undefined
    if (allow) {
      allows.push(allow)
      if (allow.reason.length === 0) {
        errors.push(`${file}:${lineNumber} seam:allow needs a reason`)
      }
    }

    // `line` is the comment-blanked text, `raw` is everything. The two tiers read
    // different haystacks, which is the whole point of splitting the list.
    const inCode = new Set(segments(line))
    const anywhere = new Set(segments(raw))

    const found: string[] = []
    for (const term of FORBIDDEN_ANYWHERE) if (anywhere.has(term)) found.push(term)
    for (const term of FORBIDDEN_IN_CODE) if (inCode.has(term)) found.push(term)
    // Lowercased, not segmented: `Hà Nội` and `hà nội` are the same leak, and
    // `toLowerCase` is the only normalisation that is safe across both scripts.
    const rawLower = raw.toLowerCase()
    for (const term of FORBIDDEN_SUBSTRINGS) if (rawLower.includes(term)) found.push(term)

    for (const term of found) {
      if (allow) {
        allow.used = true
        continue
      }
      hits.push({ file, line: lineNumber, term, text: raw.trim() })
    }
  }

  for (const allow of allows) {
    if (!allow.used) {
      errors.push(
        `${file}:${allow.line} seam:allow suppresses nothing — delete it (an unused allow makes the count meaningless)`,
      )
    }
  }

  return { hits, allows, errors }
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIPPED_DIRECTORIES.has(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (SCANNED_EXTENSIONS.some((e) => full.endsWith(e))) out.push(full)
  }
  return out
}

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const

export function checkSeam(root: string): SeamReport {
  const engineRoot = resolve(root, "packages/samsara")
  const files = walk(engineRoot)
  const report: SeamReport = {
    filesScanned: files.length,
    hits: [],
    allows: [],
    badDependencies: [],
    badImports: [],
    errors: [],
  }

  for (const full of files) {
    const file = relative(root, full)
    const source = readFileSync(full, "utf8")
    // JSON has no comments to blank, and Markdown is prose end to end — a README
    // under the engine describing "travel" would be a real breach, so it is scanned
    // whole rather than exempted.
    const stripComments = full.endsWith(".ts") || full.endsWith(".tsx")
    const result = scanSource(file, source, { stripComments })
    report.hits.push(...result.hits)
    report.allows.push(...result.allows)
    report.errors.push(...result.errors)

    // The dependency-direction check has a twin that package.json cannot see: an
    // import of a travel package from engine source. Neither `@dt/db` nor `@dt/core`
    // contains a forbidden word, so the lexicon check would never notice.
    if (stripComments) {
      for (const [index, line] of blankComments(source).split("\n").entries()) {
        if (/from\s+["']@dt\//.test(line) || /import\(["']@dt\//.test(line)) {
          report.badImports.push({
            file,
            line: index + 1,
            term: "@dt/*",
            text: line.trim(),
          })
        }
      }
    }
  }

  for (const entry of readdirSync(engineRoot)) {
    const manifest = join(engineRoot, entry, "package.json")
    let parsed: Record<string, Record<string, string> | undefined>
    try {
      parsed = JSON.parse(readFileSync(manifest, "utf8"))
    } catch {
      continue
    }
    for (const field of DEPENDENCY_FIELDS) {
      for (const name of Object.keys(parsed[field] ?? {})) {
        if (name.startsWith("@dt/")) {
          report.badDependencies.push({ file: relative(root, manifest), dependency: name })
        }
      }
    }
  }

  return report
}

export function formatReport(report: SeamReport): { text: string; ok: boolean } {
  const lines: string[] = []
  const used = report.allows.filter((a) => a.used)

  for (const hit of report.hits) {
    lines.push(`  ${hit.file}:${hit.line}  "${hit.term}"  ${hit.text}`)
  }
  if (report.hits.length > 0) {
    lines.unshift(
      `Lexicon check failed — ${report.hits.length} travel word(s) under packages/samsara:`,
    )
    lines.push(
      "",
      "  The engine may not know it is about travel (ADR-0009). Rename it, move it into",
      "  packages/travel/, or — if it genuinely belongs — add `// seam:allow <reason>`.",
      "",
    )
  }

  if (report.badImports.length > 0) {
    lines.push("Dependency direction failed — engine source imports a travel package:")
    for (const bad of report.badImports) lines.push(`  ${bad.file}:${bad.line}  ${bad.text}`)
    lines.push("")
  }

  if (report.badDependencies.length > 0) {
    lines.push("Dependency direction failed — engine package.json lists a travel dependency:")
    for (const bad of report.badDependencies) lines.push(`  ${bad.file}  ${bad.dependency}`)
    lines.push("")
  }

  for (const error of report.errors) lines.push(`  ${error}`)

  const overBudget = used.length > MAX_ALLOWS
  if (overBudget) {
    lines.push(
      `Allow budget exceeded — ${used.length} of a maximum ${MAX_ALLOWS} (ADR-0009).`,
      "  Above five, the seam is in the wrong place. Redesign it rather than adding a sixth.",
      "",
    )
  }

  const ok =
    report.hits.length === 0 &&
    report.badImports.length === 0 &&
    report.badDependencies.length === 0 &&
    report.errors.length === 0 &&
    !overBudget

  if (ok) {
    lines.push(
      `seam ok — ${report.filesScanned} files under packages/samsara, no travel vocabulary, no travel dependencies.`,
    )
  }

  if (used.length > 0) {
    lines.push(`allows in use: ${used.length}/${MAX_ALLOWS}`)
    for (const allow of used) lines.push(`  ${allow.file}:${allow.line}  ${allow.reason}`)
  }

  return { text: lines.join("\n"), ok }
}

// Only when run directly, so the tests can import the functions above without the
// process exiting underneath them.
if (import.meta.url === `file://${process.argv[1]}`) {
  const root = resolve(import.meta.dirname, "..")
  const { text, ok } = formatReport(checkSeam(root))
  process.stdout.write(`${text}\n`)
  process.exit(ok ? 0 : 1)
}
