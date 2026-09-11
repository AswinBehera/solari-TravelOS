import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * The narrow version of the seam check, scoped to this package. P0.7 generalises it
 * across every package under packages/samsara/ and wires it to `pnpm check:seam`.
 * This stays regardless: it fails in the package that broke the rule, where the
 * person who broke it is already looking.
 */

const here = fileURLToPath(new URL(".", import.meta.url))
const pkgRoot = join(here, "..")

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name)
    if (e.isDirectory()) return e.name === "node_modules" ? [] : sourceFiles(full)
    return e.name.endsWith(".ts") ? [full] : []
  })
}

describe("the seam", () => {
  it("has no @dt/* import anywhere in the source", () => {
    // Matches import and export statements specifically rather than any occurrence of
    // the string, so that this file — which must name the forbidden scope in order to
    // check for it — does not report itself.
    const importsTravelScope = /(?:\bfrom|\bimport|\brequire\()\s*["']@dt\//
    const offenders = sourceFiles(here).filter((f) =>
      importsTravelScope.test(readFileSync(f, "utf8")),
    )
    expect(offenders).toEqual([])
  })

  it("has no @dt/* dependency declared in package.json", () => {
    const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
    expect(deps.filter((d) => d.startsWith("@dt/"))).toEqual([])
  })

  it("depends on nothing but zod, per ADR and plan section 2.1", () => {
    const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>
    }
    expect(Object.keys(pkg.dependencies ?? {})).toEqual(["zod"])
  })
})
