# ADR-0002: React + Vite for the web app

- **Status:** Accepted
- **Date:** 2026-09-11
- **Decided by:** Aswin (architect)

## Context

`apps/web` is a document editor behind auth. It has no SEO surface: nothing a logged-out crawler
should see, nothing that benefits from server rendering. The landing page is a separate concern
(section 10 question 4).

Aswin already works in this stack daily (the Solitary Reaper projects), and Phase 0 is measured in
days, not weeks.

## Decision

React 19 with Vite, TanStack Router and TanStack Query, Tailwind. Client-rendered, no SSR.

## Consequences

- Fastest path to a working editor for this particular executor and this particular architect.
- Deploys as static assets, which is what makes ADR-0014's free Cloudflare hosting work — there is
  no render server to pay for.
- TanStack Query becomes the cache layer for the API, so the app has no second state library.
- Cost: no SSR means no server-rendered share pages. If public Postcard links ever need to render
  for a crawler, that is a small separate surface, not a reason to move the app.

## Swap point

Next.js, if SEO pages must live inside the same app. They don't: the landing page goes on Astro.
