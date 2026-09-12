// The runner in development. Not a different runner — the same one, on a timer.
//
// Production has no long-lived worker process: GitHub Actions wakes a runner, it
// drains, it exits (ADR-0014). So this file loops `main()` rather than turning the
// drain into a daemon. That is a deliberate refusal, and it is the whole point of
// the file: a persistent dev worker would hide every bug that only appears because
// the process *ends* between jobs — state kept in a module-level variable, a
// counter that lives in memory, a connection assumed to still be open. Those bugs
// would then arrive for the first time in an environment with no debugger attached.
//
// `tsx watch` restarts this on save, so the hot-reload loop is: edit a handler,
// watch the next tick pick it up.

import { main } from "./index.js"

const INTERVAL_MS = Number(process.env.WORKER_DEV_INTERVAL_MS ?? 3_000)

let stopping = false
process.on("SIGINT", () => {
  if (stopping) process.exit(130)
  stopping = true
  process.stdout.write("\nstopping after the current drain\n")
})

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

while (!stopping) {
  const code = await main()
  // Non-zero means a job failed, which in development is information, not a reason
  // to stop watching. The exit code matters in Actions; here it is a log line.
  if (code !== 0) process.stdout.write(`drain finished with exit code ${code}\n`)
  if (stopping) break
  await sleep(INTERVAL_MS)
}

process.exit(0)
