# ADR-0015: A viewpoint is a stack of signals, and the IP is the weakest one

- **Status:** Accepted
- **Date:** 2026-09-11
- **Decided by:** Aswin (architect), on a finding from P0.4
- **Amends:** section 1.4, section 2.4; resolves section 10 question 9 in approach

## Context

P0.4's live test found that Solari's residential pool has no Thai egress. Section 1.4 names Bangkok
as the first city, and the premise underneath the whole product is that a persona can see what a
local sees.

The reflex response — "use Singapore instead" — answers a different question than the one asked.
It is worth being precise about what the original question assumed.

**Platforms do not serve content from servers in your country.** TikTok, YouTube, Instagram and
Google all run from a handful of regions and serve everybody from them. What varies is the *ranking*,
and ranking is computed from a profile the platform assembles out of signals. Roughly, in descending
order of how much they move the result for a logged-out or lightly-warmed session:

1. **Account region**, where there is an account. Set at signup and sticky — it does not follow the
   IP afterwards, which is why a Thai person's feed stays Thai when they travel.
2. **The language and script of the query.** Searching `ร้านอาหารกรุงเทพ` returns a Thai corpus from
   any IP on earth. This is the single highest-leverage signal available to us and it requires no
   spoofing of anything.
3. **Stored region and language preferences** — YouTube's content-location setting, TikTok's content
   languages, Google's `gl`/`hl`. User-settable, cookie-backed, and therefore persistable in a
   Solari profile.
4. **Browser locale and timezone** — `navigator.language`, `Accept-Language`, `Intl`'s resolved zone.
   Read directly by client-side ranking and personalisation code.
5. **Engagement history** on a warmed profile: what was watched, followed, dwelt on.
6. **The egress IP.** Dominant for legal and licensing gates, coarse for ranking, and the only one
   of the six we cannot supply for Thailand.

A Thai IP alone produces very little: a fresh session from a Bangkok address with an `en-US` browser
asking an English question gets the global viral feed. The IP was never doing the work we assumed it
was doing.

There is a second, independent finding. **Solari does not set locale or timezone.** Its
`browser.newPage()` returns the pool's default context, which is `en-US` on UTC. Every session the
kernel opened before this ADR was claiming to be an American, regardless of the proxy country — a
US-locale browser on a Singapore residential IP, which is both wrong for the product and a
conspicuous mismatch on exactly the surfaces we most want to blend into.

## Decision

**Separate the viewpoint from the egress, and make both first-class.**

- `Viewpoint` (`packages/samsara/kernel/src/ports.ts`) carries `locale`, `timezoneId`, and an
  optional `geolocation`. `withBrowser` takes them alongside `country`.
- The kernel builds the browser context itself rather than calling `newPage()`, because the
  provider's page helper accepts no options. It carries the attached profile's `storageState` into
  that context by hand — `newContext()` is documented to open an *empty* one, and losing a warmed
  profile that way would be silent.
- **The `sessions` row records both** (`country`, `locale`, `timezone_id`; migration 0002). An
  Observation is not interpretable without the viewpoint that produced it, and "which signals were
  present" is the independent variable of every experiment in Phase 1.
- `session.open` logs both, so a public Actions log carries the provenance too. A BCP 47 tag and an
  IANA zone are drawn from fixed public vocabularies and can hold no secret.
- **No country is ever substituted automatically.** The kernel refuses an unavailable country by
  name and states the nearest available; choosing to use it is the caller's explicit act.
- Validation is strict where it is a tell: the timezone must be an IANA zone, never a `GMT+7`
  offset, because an offset is not what a real browser reports.

**Bangkok stays the first city.** It is reachable as: Thai-language queries, a `th-TH` browser on
`Asia/Bangkok`, Thai regional parameters and stored preferences, warmed profiles, and — as the last
and weakest ingredient — Singapore egress, one hour and 1,400km away, honestly labelled.

## Consequences

- Verified live on 11 September 2026: egress `121.7.135.149` (Singapore residential), page reports
  `navigator.language = th-TH`, `Intl` zone `Asia/Bangkok`, offset −420. Cost 0.057 minutes.
- The Persona Lab gains a real independent variable. P1.8 was "us persona vs th persona"; it can now
  be "which signals actually move the result," which is a better experiment and a much better demo —
  the answer is a measured number rather than an assertion.
- Sources that are **local by construction** move up the priority list: Pantip (P1.6) is a
  Thai-language forum, so its corpus is Thai regardless of where the reader stands. No geo signal is
  needed there at all. The same is true of Thai-language YouTube and Google Maps reviews in Thai.
- A timezone/IP mismatch is itself a fingerprinting signal. Singapore→Bangkok is one hour, which is
  the mildest available mismatch and is what a real traveller looks like. A larger one (`th-TH` on a
  US IP) would be conspicuous, so the nearest-available table stays regional.
- Cost: more knobs, and knobs that can be set inconsistently. The validation rules and the recorded
  session row are the mitigation — an inconsistent viewpoint is visible in the data rather than
  hidden in a launch call.

## What this does not claim

Singapore egress is not a Thai IP, and no arrangement of the other five signals makes it one. Any
surface that gates on IP geolocation for legal or licensing reasons — and some will — is simply not
reachable for `th` on this provider. Where that bites, it must be reported as a gap, not papered
over. P1.4's acceptance criterion is the place it will show up first.

## Swap point

A provider with Thai residential egress, or Solari adding `th`.

**Asked and answered, 11 September 2026 (Aswin): `th` is not on Solari's near-term roadmap.** So this
is not a scheduling question and there is no version of the plan that waits for it. The signal stack
above is the design, not an interim measure — which is the right outcome anyway, because it is the
one that keeps working when the next city turns out to be somewhere else the pool does not carry.
If `th` ever appears, it switches on as one more signal rather than a rewrite.
