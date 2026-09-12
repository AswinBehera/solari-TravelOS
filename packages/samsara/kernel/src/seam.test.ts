import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * The package-local seam check. P0.7 generalises this across the whole tree; this
 * one stays, so a package that breaks the rule fails in the package that broke it.
 */

const here = dirname(fileURLToPath(import.meta.url))
const pkgRoot = join(here, "..")

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : []
  })

// Matched as a statement rather than a substring, so this file does not report
// itself for containing the pattern it is looking for.
const importsProductScope = /(?:\bfrom|\bimport|\brequire\()\s*["']@dt\//

describe("@samsara/kernel stays on the engine side of the seam", () => {
  it("imports nothing from the product scope", () => {
    const offenders = sourceFiles(join(pkgRoot, "src")).filter((file) =>
      importsProductScope.test(readFileSync(file, "utf8")),
    )
    expect(offenders).toEqual([])
  })

  it("declares no product-scope dependency", () => {
    const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const all = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
    expect(all.filter((d) => d.startsWith("@dt/"))).toEqual([])
  })

  it("depends only on the engine, the provider, and the database driver", () => {
    const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>
    }
    expect(Object.keys(pkg.dependencies ?? {}).sort()).toEqual([
      "@samsara/core",
      "@samsara/db",
      "@solarisdk/browser",
      "@solarisdk/sdk",
      "drizzle-orm",
      "zod",
    ])
  })

  it("pins the provider SDK exactly, because 0.1.3 changed process-exit behaviour", () => {
    const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>
    }
    expect(pkg.dependencies?.["@solarisdk/browser"]).toMatch(/^\d+\.\d+\.\d+$/)
    expect(pkg.dependencies?.["@solarisdk/sdk"]).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it("reaches the provider SDK from exactly one file", () => {
    // The point of ports.ts: a change of provider is a rewrite of solari.ts and
    // nothing else, and every other test in this package runs without a key.
    const offenders = sourceFiles(join(pkgRoot, "src"))
      .filter((f) => !f.endsWith("solari.ts") && !f.endsWith("seam.test.ts"))
      .filter((f) => /["']@solarisdk\//.test(readFileSync(f, "utf8")))
    expect(offenders).toEqual([])
  })
})
