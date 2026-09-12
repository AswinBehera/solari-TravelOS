import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { Capture } from "./adapter.js"

/**
 * Reading and writing captures as files, so parser tests run against real bytes.
 *
 * Reachable as `@samsara/sources/fixture` rather than from the package root,
 * because it is the only file here that touches `node:fs` and packages are
 * source-only (no build step, P0.1) — importing it from the barrel would make
 * every module that mentions an adapter uncompilable against the Workers runtime.
 * Same split as the kernel's `./node`.
 *
 * The workflow this exists for:
 *
 * 1. Run the adapter for real, once, against the live source. It costs one session.
 * 2. `writeFixture` the capture into the adapter's `__fixtures__` folder.
 * 3. Iterate on `parse` against that file, for as long as it takes, for free.
 * 4. When the source changes its markup, repeat step 1 — and keep the old fixture,
 *    because a parser that still handles last quarter's page is a parser that can
 *    re-read the rows harvested with it.
 *
 * The fixtures are checked in. They are pages a logged-out visitor was served, so
 * there is nothing in them that was not already public — but see `writeFixture`
 * for the one thing that is not true of, and the reason the repository being
 * public makes this a decision rather than a detail.
 */

/** A capture on disk. `capturedAt` survives the round trip as an ISO string. */
interface StoredCapture<P> extends Omit<Capture<P>, "capturedAt"> {
  capturedAt: string
}

export function fixturePath(dir: string, name: string): string {
  return join(dir, `${name}.capture.json`)
}

/**
 * Write a capture to disk, pretty-printed so a diff is readable.
 *
 * **What lands in the file is whatever the adapter put in `payload`.** For a
 * rendered scrape that is a whole HTML document, and a whole HTML document served
 * to a session this project opened can contain a session id, a consent cookie
 * echoed into a script tag, or an experiment bucket that identifies the request.
 * The repository is public. Adapters are expected to narrow `payload` to the
 * fragment their parser actually reads before it ever reaches this function —
 * which is good practice anyway, since a 2MB fixture nobody can read in a diff is
 * a fixture nobody reviews.
 */
export function writeFixture<P>(dir: string, name: string, capture: Capture<P>): string {
  const path = fixturePath(dir, name)
  mkdirSync(dirname(path), { recursive: true })
  const stored: StoredCapture<P> = { ...capture, capturedAt: capture.capturedAt.toISOString() }
  writeFileSync(path, `${JSON.stringify(stored, null, 2)}\n`, "utf8")
  return path
}

/**
 * Read a capture back.
 *
 * Throws rather than returning null on a missing file: a parser test whose fixture
 * has been renamed should fail, not quietly assert that a parser produces no items
 * — which it does, correctly, when handed nothing.
 */
export function readFixture<P>(dir: string, name: string): Capture<P> {
  const path = fixturePath(dir, name)
  let raw: string
  try {
    raw = readFileSync(path, "utf8")
  } catch (cause) {
    throw new Error(`no fixture at ${path}; record one with writeFixture`, { cause })
  }
  const stored = JSON.parse(raw) as StoredCapture<P>
  return { ...stored, capturedAt: new Date(stored.capturedAt) }
}
