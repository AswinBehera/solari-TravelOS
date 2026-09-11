> **Superseded, kept for origin.** This is the original vision document, written before the
> architecture was settled. Two of its claims are no longer how we describe the system:
>
> 1. It argues that Doen Thang **is** an operating system. It is not. It is a *service layer*
>    over Solari's infrastructure. "OS" survives as product-facing language only. See
>    `docs/PLAN.md` section 1.5 and ADR-0011.
> 2. It treats travel as the substrate. It isn't. The substrate is **Samsara**, a
>    domain-agnostic situated-observation layer; travel is vertical one. See `docs/PLAN.md`
>    section 1.6 and ADR-0009.
>
> Read it for the product feeling and the flywheel argument, which still hold. Do not read it
> for architecture. `docs/PLAN.md` is the only normative document.

---

# Doen Thang: The TravelOS Master Blueprint

**Doen Thang** (Thai for 'to travel') is not just an application; it is a **TravelOS**. It abstracts away the friction, borders, and algorithms of global travel by combining a highly fluid, document-based frontend with a powerful, agentic backend powered by Solari's cloud infrastructure.

---

## 1. Product Vision & Branding
*   **Aesthetic:** Bangkok-inspired. A collision of sleek, modern digital product design (glassmorphism, clean typography) with vibrant street culture (neon pinks, deep blues, temple gold).
*   **Vibe:** Authentic, "locals only", dynamic, and nostalgic. It feels like uncovering a secret underground gem in a massive metropolis.

---

## 2. The Application Layer (Frontend / User Interface)

The frontend abandons chaotic, infinite spatial canvases (like Miro) in favor of a **Dynamic Document**, inspired by Notion and early HyperCard concepts.

### A. The Dynamic Journal
Users begin by simply typing into a beautifully designed text document. As they type (e.g., *"Going to Bangkok for 4 days..."*), the OS parses the intent in the background, treating the text as an executable data structure.

### B. "Postcards" (The HyperCard Metaphor)
Data isn't displayed as boring lists; it is embedded into the document as **Postcards**. Postcards are rich, interactive, mini-applications.
*   **Flight Postcards:** Display live, geo-arbitraged pricing with a "Book Now" button.
*   **Gem Postcards:** Show a scraped local TikTok video, translated address, and live opening hours.
*   **Agent Postcards:** Contain executable buttons (e.g., "Buy Train Ticket") that trigger background agents to navigate foreign websites on the user's behalf.

### C. Visual Interaction (The Pinterest Mechanic)
Treating images as interactive surfaces rather than flat pixels.
*   **Extract to Postcard (Discovery):** A user pastes a photo of a Thai street market, crops a specific noodle bowl or neon sign, and the OS uses visual search to dynamically generate a functional, bookable Postcard for that exact stall.
*   **Living Photos (Scrapbooking):** Uploaded personal photos are automatically segmented. Clicking the temple in the background of a group photo slides out a Postcard with the historical wiki data and the Uber receipt from that day.

### D. Fluid Views
The document is just the underlying database. Users can instantly switch the view from "Journal" to "Map View," plotting every Postcard onto a vibrant, interactive geographic layout.

---

## 3. The Infrastructure Layer (Backend via Solari)

The true power of the TravelOS lies in its background processes—acting as an operating system that manipulates the web across time and geography.

### A. Algorithmic Spying (The Discovery Engine)
*   **The Tech:** Solari's `profiles` feature.
*   **The Function:** The OS farms digital personas (e.g., "The Kyoto Local"). By routing a browser through a Japanese proxy and maintaining localized cookies/history, it hijacks regional social media algorithms (TikTok/Instagram). It continuously scrapes the feeds, returning high-signal, authentic "hidden gems" that tourists normally cannot see.

### B. Hundred Eyes (The Arbitrage Daemon)
*   **The Tech:** Solari Cloud Browsers with concurrent `proxy` routing and `stealth: true`.
*   **The Function:** A background daemon that monitors user-defined flights and hotels. It continuously spins up headless browsers across 20+ global IPs (US, Thailand, Brazil, etc.) to detect geographic price discrimination. It alerts the user when buying from a specific country's IP saves them significant money.

### C. Autonomous Execution Sandboxes
*   **The Tech:** Solari fast-booting Code Sandboxes and VMs.
*   **The Function:** When a user clicks a button on an "Agent Postcard," Doen Thang spawns a secure, ephemeral microVM. It hands the task to an AI agent that physically navigates a foreign website, solves captchas, and executes the booking on the user's behalf.

---

## 4. The Flywheel (User Journey)

1.  **The Hook (Arbitrage):** Users are acquired because the "Hundred Eyes" daemon saves them $300 on a flight to Tokyo.
2.  **The Discovery (Algorithmic Spying):** They are engaged when the OS provides them with authentic, hyper-local recommendations scraped directly from the Tokyo TikTok algorithm, bypassing tourist traps.
3.  **The Planner (Dynamic Document):** They use the Postcards and Visual Selection tools to effortlessly map out their itinerary in a beautiful, low-friction document.
4.  **The Retention (Scrapbook):** During and after the trip, they upload their photos, turning the document into a "Living Scrapbook." They share this aesthetic document to social media, creating a viral loop for new user acquisition.
