import { readdirSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { factorEffects, groupByCell, noiseFloor, pairwise, type RankedCell } from "@samsara/harvest"
import type { RunFile } from "./results.js"

/**
 * Reads a results file and prints the table P1.0 exists to produce.
 *
 * Separate from the runner, and network-free, so that re-reading a run — at a
 * different depth, with a different metric, six weeks later — costs nothing. The
 * expensive part of an experiment is the sessions; none of the arithmetic that
 * interprets them should need one.
 */

const here = dirname(fileURLToPath(import.meta.url))
const resultsDir = resolve(here, "../../results")

function latestRun(): string {
  // Flags filtered out, or `--k=10` is read as a filename and the reporter
  // silently reads the latest run at the default depth instead of the one asked for.
  const arg = process.argv.slice(2).find((a) => !a.startsWith("--"))
  if (arg) return resolve(process.cwd(), arg)
  const files = readdirSync(resultsDir)
    .filter((name) => name.endsWith(".json"))
    .sort()
  const last = files[files.length - 1]
  if (!last) throw new Error(`no results in ${resultsDir} — run signal-matrix:run first`)
  return join(resultsDir, last)
}

const pct = (n: number | null): string => (n === null ? "   —  " : `${(n * 100).toFixed(0)}%`)

/**
 * An effect read against what changing nothing produces.
 *
 * The thresholds are a judgement and they live here rather than in
 * `@samsara/harvest`, which computes numbers and does not get to decide what
 * counts as large. Stated so a reader can disagree with them: at or below the
 * floor is nothing, within twice the floor is the same order of magnitude as
 * noise and should not be built on, beyond that is a real lever.
 *
 * The column exists because without it "egress 31%" reads as a finding, and
 * beside a 21% floor it is very nearly a rounding error.
 */
function verdict(effect: number | null, floor: number | null): string {
  if (effect === null) return "not measured"
  if (floor === null) return "no floor — unreadable"
  const noise = 1 - floor
  if (effect <= noise) return "**noise**"
  if (effect <= noise * 2) return "weak"
  return "**dominant**"
}

function main(): void {
  const path = latestRun()
  const run = JSON.parse(readFileSync(path, "utf8")) as RunFile
  const kArg = process.argv.find((a) => a.startsWith("--k="))
  const k = kArg ? Number(kArg.slice("--k=".length)) : run.topK

  const usable = run.cells.filter((cell) => !cell.error && !cell.refusedBy)
  const cells: RankedCell[] = usable.map((cell) => ({
    assignment: cell.assignment,
    items: cell.items,
  }))

  console.log(`# signal-matrix — ${run.surface}, top ${k}`)
  console.log(`${run.startedAt} to ${run.finishedAt}, seed ${run.seed}`)
  console.log(`${run.minutesSpent.toFixed(2)} browser-minutes over ${run.cells.length} sessions`)

  // Refusals first, and never folded into the averages. A cell that was walled is
  // a fact about that viewpoint, and averaging it in as "zero overlap" would read
  // a block as an enormous signal effect.
  const refused = run.cells.filter((cell) => cell.error || cell.refusedBy)
  if (refused.length > 0) {
    console.log(`\n## ${refused.length} cell(s) excluded — refused, not measured`)
    for (const cell of refused) {
      console.log(
        `- ${JSON.stringify(cell.assignment)} — ${cell.error ? `${cell.error.kind}: ${cell.error.message}` : cell.refusedBy}`,
      )
    }
  }

  const thin = usable.filter((cell) => cell.items.length < k)
  if (thin.length > 0) {
    console.log(`\n${thin.length} cell(s) returned fewer than ${k} results; overlap is`)
    console.log("divided by what could have been shared, not by k.")
  }

  const floor = noiseFloor(cells, k)
  console.log("\n## The noise floor")
  if (floor === null) {
    console.log("No cell was run twice, so there is no floor and no number below is readable.")
  } else {
    const replicates = groupByCell(cells).size
    console.log(
      `Repeating a cell reproduces ${pct(floor)} of its own list (${cells.length - replicates} replicate pair(s)).`,
    )
    console.log(
      `Read every effect below against ${pct(1 - floor)} of movement from nothing at all.`,
    )
  }

  console.log("\n## Which signal moved the result")
  console.log("")
  console.log("| factor | pairs | mean overlap | effect | vs noise | mean rank shift |")
  console.log("|---|---:|---:|---:|---|---:|")
  for (const row of factorEffects(cells, k)) {
    console.log(
      `| ${row.factor} | ${row.pairs} | ${pct(row.meanOverlap)} | ${pct(row.effect)} | ` +
        `${verdict(row.effect, floor)} | ` +
        `${row.meanRankShift === null ? "—" : row.meanRankShift.toFixed(1)} |`,
    )
  }
  if (floor !== null) {
    console.log(
      "\nA factor whose effect does not clear the noise floor has not been shown to do anything.",
    )
  }

  // The two cells the product is actually about, end to end.
  const pairs = pairwise(cells, k)
  const corner = pairs.find((pair) => pair.differing.length === Object.keys(run.factors).length)
  if (corner) {
    console.log(
      `\nEverything-local against everything-foreign: ${pct(corner.overlap.overlap)} overlap ` +
        `(${corner.overlap.shared} of ${corner.overlap.comparable}).`,
    )
  }
}

main()
