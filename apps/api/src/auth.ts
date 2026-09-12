import { createMiddleware } from "hono/factory"
import { HTTPException } from "hono/http-exception"
import { createRemoteJWKSet, jwtVerify } from "jose"

/**
 * Supabase JWT verification (ADR-0013). Signature check against the project's
 * JWKS, then `sub` becomes `ownerId`. No call to an auth service per request.
 *
 * The remote key set is created **once per isolate, not once per request**. That is
 * not a micro-optimisation: `createRemoteJWKSet` caches the fetched keys, and a
 * per-request instance would turn every authenticated call into an outbound fetch
 * — which on the free plan is one of 50 external subrequests, and on the 10 ms CPU
 * budget is the difference between fitting and not.
 */

export interface Verifier {
  /** Returns the `sub` claim. Throws for anything that is not a valid, live token. */
  verify(token: string): Promise<string>
}

export function supabaseVerifier(supabaseUrl: string): Verifier {
  const jwks = createRemoteJWKSet(
    new URL(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/.well-known/jwks.json`),
  )
  return {
    async verify(token) {
      const { payload } = await jwtVerify(token, jwks)
      if (typeof payload.sub !== "string" || payload.sub.length === 0) {
        throw new Error("token has no sub claim")
      }
      return payload.sub
    },
  }
}

declare module "hono" {
  interface ContextVariableMap {
    /**
     * Opaque below this line. The engine never learns that Supabase exists — this
     * is the same string `Session.ownerId` and `Job.ownerId` hold, and they are
     * typed as plain text precisely so that swapping the auth vendor is a change
     * in this file.
     */
    ownerId: string
  }
}

export const requireAuth = (verifier: Verifier) =>
  createMiddleware(async (c, next) => {
    const header = c.req.header("authorization") ?? ""
    const [scheme, token] = header.split(" ")
    if (scheme?.toLowerCase() !== "bearer" || !token) {
      throw new HTTPException(401, { message: "bearer token required" })
    }
    let ownerId: string
    try {
      ownerId = await verifier.verify(token)
    } catch {
      // Deliberately does not say why. "Expired" versus "bad signature" versus
      // "unknown key" is useful to an attacker probing the endpoint and useless to
      // a client, which can only do one thing about any of them.
      throw new HTTPException(401, { message: "invalid token" })
    }
    c.set("ownerId", ownerId)
    await next()
  })
