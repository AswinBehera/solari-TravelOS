import { useQuery } from "@tanstack/react-query"
import type { ReactNode } from "react"

/**
 * P0.6's visible surface, and deliberately almost nothing.
 *
 * The travel UI is Phase 2; the Persona Lab is P1.7. What this page exists to do is
 * prove the development loop actually connects: Vite's HMR, the `/api` proxy, the
 * Worker, Hyperdrive's local connection, and Postgres. A "hello world" that renders
 * without touching any of that would let the whole chain be broken and still look
 * green, which is the failure P0.6 is meant to remove.
 *
 * It calls `/health`, which by design does *not* touch the database — so a red dot
 * here means the API is down, and never means Postgres is down. Two different
 * problems, two different fixes, and one endpoint should not blur them.
 */

interface Health {
  ok: boolean
  service: string
}

export function App() {
  const health = useQuery<Health>({
    queryKey: ["health"],
    queryFn: async () => {
      const res = await fetch("/api/health")
      if (!res.ok) throw new Error(`api returned ${res.status}`)
      return res.json() as Promise<Health>
    },
  })

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 p-6">
      <header>
        <h1 className="font-semibold text-2xl tracking-tight">Doen Thang</h1>
        <p className="text-neutral-500 text-sm">
          Phase 0 · dev shell. The travel UI lands in Phase 2.
        </p>
      </header>

      <section className="rounded-lg border border-neutral-200 p-4">
        <h2 className="mb-2 font-medium text-sm">API</h2>
        {health.isPending && <Status tone="waiting">checking…</Status>}
        {health.isError && (
          <Status tone="down">
            unreachable — is <code>pnpm dev</code> running the API on :8788?
          </Status>
        )}
        {health.data && <Status tone="up">{health.data.service} is up</Status>}
      </section>
    </main>
  )
}

function Status({ tone, children }: { tone: "up" | "down" | "waiting"; children: ReactNode }) {
  const dot = tone === "up" ? "bg-emerald-500" : tone === "down" ? "bg-red-500" : "bg-neutral-300"
  return (
    <p className="flex items-center gap-2 text-sm">
      <span className={`inline-block size-2 rounded-full ${dot}`} aria-hidden />
      {children}
    </p>
  )
}
