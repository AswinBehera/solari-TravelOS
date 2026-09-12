import type { Logger } from "./log.js"

/**
 * The Node-only logger. Separate entry point, for the same reason `./solari` is
 * one: packages here are source-only, so anything a runtime cannot load must not
 * sit on a path that runtime has to compile through. `apps/api` runs on Workers,
 * where `process.stdout` does not exist, and it imports `Logger` constantly.
 */

/** One JSON object per line on stdout — what GitHub Actions and `jq` both want. */
export const jsonLogger: Logger = {
  emit(event) {
    process.stdout.write(`${JSON.stringify(event)}\n`)
  },
}
