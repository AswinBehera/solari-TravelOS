import { randomUUID } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import type { StorageRef } from "@samsara/core"
import type { Capture } from "@samsara/sources"
import type { CaptureArchive } from "./store.js"

/**
 * A capture archive backed by the local filesystem.
 *
 * **This is a stand-in, and the header says so on purpose.** Section 8 puts
 * captures in Supabase Storage; there are no Supabase credentials in this project
 * yet, and `runHarvest` treats a failed archive as fatal to the run — deliberately,
 * because an item with no `rawRef` looks like evidence and can never be re-read.
 * Those two facts together mean that without *some* working archive there is no
 * harvest at all, so this exists to keep the system runnable locally rather than to
 * be the answer.
 *
 * What it is not: durable. The runner is a scheduled GitHub Actions job (ADR-0014)
 * whose disk disappears when the run ends, so a ref written by this class points at
 * nothing the moment the process that wrote it is gone. It is correct for `pnpm
 * dev` on a laptop and wrong for anything that outlives one process, which is the
 * whole reason the swap to object storage is a `CaptureArchive` implementation and
 * not a rewrite.
 *
 * The ref it returns is a **relative** key with the same shape a bucket key has —
 * `captures/<sourceId>/<runId>/<uuid>.json` — and not an absolute path or a
 * `file://` URL. A row written here is therefore not distinguishable by shape from
 * one written against a bucket, which is what makes the migration a copy rather
 * than a rewrite of every stored ref.
 */
export class FilesystemCaptureArchive implements CaptureArchive {
  readonly #root: string
  readonly #newId: () => string

  constructor(root: string, options: { newId?: () => string } = {}) {
    this.#root = resolve(root)
    this.#newId = options.newId ?? randomUUID
  }

  async put(runId: string, capture: Capture<unknown>): Promise<StorageRef> {
    const ref = join("captures", capture.sourceId, runId, `${this.#newId()}.json`)
    const path = join(this.#root, ref)
    mkdirSync(dirname(path), { recursive: true })
    // Not pretty-printed, unlike a fixture. Nobody diffs an archived capture; they
    // re-parse it, and the indentation on a response this size is measured in
    // megabytes of disk that carry no information.
    writeFileSync(
      path,
      JSON.stringify({ ...capture, capturedAt: capture.capturedAt.toISOString() }),
      "utf8",
    )
    return ref
  }
}
