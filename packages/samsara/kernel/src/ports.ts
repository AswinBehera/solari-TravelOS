/**
 * The provider, as the kernel needs it — and no more than that.
 *
 * These interfaces exist so every test above this line runs without the network,
 * without an API key, and without spending a minute. They are also the seam where
 * a provider outage is simulated: a fake that throws `ECONNREFUSED` proves the
 * `upstream` path works, which is the only way to know that a real maintenance
 * window will be reported as the provider's problem rather than ours.
 *
 * The shapes mirror `@solarisdk/browser` and `@solarisdk/sdk` (plan section 2.3)
 * but deliberately narrowly: `newPage` and `close`, nothing else. A page is
 * `unknown` to this file — Playwright's own type belongs to the caller, and
 * importing it here would drag a browser automation library into a package the
 * Workers runtime may one day have to load.
 */

/**
 * What the browser claims to be, as opposed to where its packets come from.
 *
 * These are the levers that matter and the ones nobody thinks about, because the
 * proxy country is the visible knob. A platform deciding what to show a visitor
 * reads, roughly in descending order of weight: the account's region, the query's
 * language, any explicit region preference it has stored, the browser's locale
 * and timezone, and only then the egress IP. A `us` session asking in Vietnamese
 * with a `vi-VN` browser on `Asia/Ho_Chi_Minh` is closer to a local viewpoint than
 * a `vn` IP asking in English would be — if a `vn` IP were available at all, which
 * on this provider it is not (see `countries.ts`).
 *
 * The provider does **not** set these. Its `newPage()` gives you the pool's
 * default context, which is `en-US` and UTC — i.e. nobody. Every session this
 * kernel opens without a viewpoint is a session pretending to be an American.
 */
export interface Viewpoint {
  /** BCP 47. Sets `navigator.language` and the `Accept-Language` header together. */
  locale: string
  /** IANA zone. `Date` and `Intl` follow it, and so do the scripts reading them. */
  timezoneId: string
  /**
   * The Geolocation API's answer, for surfaces that ask the browser instead of
   * reading the IP. Granted automatically when present, because a permission
   * prompt nobody clicks is the same as a denial.
   */
  geolocation?: { latitude: number; longitude: number; accuracy?: number }
}

export interface LaunchConfig {
  stealth: boolean
  proxy?: { country: string; tier?: "residential" | "mobile"; session?: string }
  captcha?: boolean
  profileId?: string
  recording?: boolean
  viewpoint?: Viewpoint
}

export interface BrowserHandle {
  /** The provider's session id. Recorded on the session row for support requests. */
  id: string
  newPage(): Promise<unknown>
  close(): Promise<void>
}

export interface BrowserLauncher {
  launch(config: LaunchConfig): Promise<BrowserHandle>
  /** Process shutdown. Releases the client's pool; separate from closing a browser. */
  dispose(): Promise<void>
}

export interface SandboxConfig {
  template: string
  /** Rolling idle window, not a deadline — the kernel enforces the deadline. */
  timeoutMs: number
}

export interface SandboxHandle {
  id: string
  connect(): Promise<void>
  /** Argv, never a shell string. `run("ls -la")` looks for a binary named "ls -la". */
  run(
    cmd: string,
    args: readonly string[],
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>
  /** Destroys the VM. `close()` would only drop the local control channel. */
  kill(): Promise<void>
}

export interface SandboxLauncher {
  create(config: SandboxConfig): Promise<SandboxHandle>
  dispose(): Promise<void>
}
