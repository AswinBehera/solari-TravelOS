import { createDb } from "@dt/db"
import { BudgetGuard, Kernel, type Logger, loadCeilings, SessionRegistry } from "@samsara/kernel"
import { jsonLogger } from "@samsara/kernel/node"
import {
  PostgresCounterStore,
  PostgresJobStore,
  PostgresSessionStore,
} from "@samsara/kernel/postgres"
import { createSolariBrowserLauncher, solariCredentials } from "@samsara/kernel/solari"
import { HandlerRegistry, noopHandler } from "./handlers.js"
import { createPackRegistry } from "./packs.js"

/**
 * Everything the runner needs, assembled once at boot.
 *
 * Separated from `index.ts` so a test can build the same object graph against a
 * real database without also acquiring a process, signal handlers and an exit
 * code. The only thing `index.ts` adds is the lifecycle.
 */
export interface Boot {
  db: ReturnType<typeof createDb>
  jobs: PostgresJobStore
  kernel: Kernel
  registry: SessionRegistry
  handlers: HandlerRegistry
  packs: ReturnType<typeof createPackRegistry>
  logger: Logger
  close(): Promise<void>
}

export function boot(env: NodeJS.ProcessEnv = process.env): Boot {
  const url = env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL is not set")

  const logger: Logger = jsonLogger
  const database = createDb(url)
  const registry = new SessionRegistry(new PostgresSessionStore(database.db), logger)
  const guard = new BudgetGuard({
    store: new PostgresCounterStore(database.db),
    ceilings: loadCeilings(env),
  })

  // Optional on purpose. The whole of Phase 0's work — claim, drain, lease,
  // shutdown — is exercisable without a provider key, and a runner that refuses to
  // boot without one would make the no-op job, whose entire value is being
  // testable anywhere, untestable in CI.
  // Spread rather than `browser: undefined`: `exactOptionalPropertyTypes` is on
  // (an executor decision from P0.1), so "absent" and "present and undefined" are
  // different types, and the kernel means the first one.
  const browser = env.SOLARI_API_KEY
    ? { browser: createSolariBrowserLauncher(solariCredentials(env)) }
    : {}

  const kernel = new Kernel({ registry, guard, logger, ...browser })

  const handlers = new HandlerRegistry()
  handlers.register("noop", noopHandler)

  return {
    db: database,
    jobs: new PostgresJobStore(database.db),
    kernel,
    registry,
    handlers,
    packs: createPackRegistry(),
    logger,
    async close() {
      await database.sql.end({ timeout: 5 })
    },
  }
}
