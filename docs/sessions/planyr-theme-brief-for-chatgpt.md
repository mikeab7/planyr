# Planyr — Light / Dark / System theming
## Brief for ChatGPT: show the look, then hand back a build spec

You are helping design a new color-theming system for a web app called **Planyr**.
A separate coding agent (**Claude**, working in the real codebase) will write the
production code. **You are not writing the app.** Your job has two parts:

- **Part A — Show the owner (Michael) the look.** Produce clear, side-by-side
  **Light vs. Dark** mockups of Planyr's main screens, plus color-swatch sheets, so
  he can *see* what we're proposing and react before any code is written.
- **Part B — Hand back a build brief for Claude.** Finish by writing a short,
  decision-ready spec (concrete hex values) that Claude can implement directly —
  especially the brand-new **dark** palette, which doesn't exist yet and needs you
  to design it.

Read everything below, then deliver Part A and Part B.

---

## 1. What Planyr is (context)

Planyr is a professional web app for **industrial real-estate site work** (think
warehouses, distribution centers). It's used by a developer for long working
sessions, so the look should be **calm, low-glare, and professional** — closer to
engineering/drafting software than a consumer app.

It's **one app with three "modules"** you switch between using tabs at the top:

| Module | Tab label | What it does | Accent color |
|---|---|---|---|
| Site Planner | **Site** | A map + a drafting canvas for laying out a site (parcels, buildings, parking, ponds) | green `#1D9E75` |
| Scheduler | **Schedule** | A project schedule/timeline | purple `#7F77DD` |
| Document Review | **Markup** | A PDF/drawing viewer for marking up and measuring construction drawings | amber `#EF9F27` |

---

## 2. What Planyr looks like TODAY (the starting point we're changing)

Today the app is **hard-locked to one look**: a **dark, near-black "chrome"** (the
top bars and side tool rail) wrapped around a **warm cream / paper "drafting"** work
area. We are **keeping the dark chrome idea** but **replacing the warm cream** with
two brand-new, cleaner palettes (see §3).

**Dark chrome — top bars, tool rail, status bar (we keep this concept):**

| Role | Hex |
|---|---|
| Chrome background (bars + rail) | `#14110e` (Site) / `#191613` (Markup) — a warm near-black |
| Chrome divider lines | `#2e2a23` |
| Chrome text (light on dark) | `#ece7db` |
| Chrome muted text | `#9b9482` |
| Inactive module tab | `#c9c3b4` |
| Accent on chrome | `#e8590c` (amber/ember) |

**Warm cream content — the work area (this is what we're RETIRING):**

| Role | Site Planner | Markup |
|---|---|---|
| Page / paper background | `#f4f1ea` | `#efeadf` |
| Raised panels / cards | `#ffffff` | — |
| Panel / divider lines | `#e7e2d6` | `#e7e2d6` |
| Primary text (ink) | `#2c2a26` | `#2c2a26` |
| Muted text | `#8a8473` | `#8a8473` |
| Drafting accent (canvas) | `#c2410c` (red-orange) | `#c2410c` |
| Grid lines (planner canvas) | `#e3ddd0` minor / `#cfc6af` major | — |

So: warm cream surfaces with dark-brown ink, under a warm near-black chrome. It
reads "blueprint/drafting." The owner wants something **cleaner and cooler**, plus a
**genuine dark mode**, while keeping the professional drafting feel.

---

## 3. The decision we've made (the target)

Add a **theme switch** with three settings:

1. **Light** — cool, gray-white surfaces (defined in §4). **Replaces the warm cream.**
2. **Dark** — a **true dark mode**: the *work area itself* goes dark (dark panels and
   canvas, not just dark bars). **You design this palette — see §5.** Retires the cream.
3. **System** — automatically follows the user's operating-system setting
   (light/dark), and flips live if they change it.

**Important:** both Light and Dark are **net-new** full surface palettes. The *only*
thing that survives from today is the **dark chrome** (the bars/rail). The dark
**work-area** colors do not exist yet — designing them is the main thing we need from
you (§5).

---

## 4. The Light palette (already decided — treat as FIXED)

These cool gray-white values are owner-approved. Use them as-is in the Light mockups.
Do **not** restyle them; if you spot a genuine contrast failure, note it in Part B
rather than silently changing it.

| Token (role) | Light value |
|---|---|
| `surface-page` (app background) | `#F3F5F8` |
| `surface-raised` (cards/panels) | `#FFFFFF` |
| `border-default` | `#E1E5EB` |
| `border-strong` (hover/active) | `#CDD3DC` |
| `text-primary` | `#1B1E26` |
| `text-secondary` (muted) | `#565E6E` |
| `text-tertiary` (hints) | `#8B92A1` |

---

## 5. The Dark palette — **THIS IS THE MAIN THING WE NEED YOU TO DESIGN**

Design the **net-new dark work-area palette** — the dark equivalent of every Light
token in §4 — to pair cleanly with the Light side and with the existing dark chrome.

Please provide a concrete hex for each of these:

| Token (role) | Dark value |
|---|---|
| `surface-page` (app background) | **you design** |
| `surface-raised` (cards/panels) | **you design** |
| `border-default` | **you design** |
| `border-strong` (hover/active) | **you design** |
| `text-primary` | **you design** |
| `text-secondary` (muted) | **you design** |
| `text-tertiary` (hints) | **you design** |

Design guidance:
- **Not pure black.** Use a dark page (~`#12`–`#1A` range) with **raised cards a step
  lighter** than the page so panels read as layered, not flat.
- **Cool-neutral**, to rhyme with the cool-gray Light side — unless you make a
  deliberate case otherwise (see the open question below).
- **Light-on-dark text** that clears **WCAG AA (contrast ≥ 4.5:1)** for body text on
  its surface; dimmer for secondary/tertiary but still legible.
- Comfortable for **long sessions** — easy on the eyes, low glare, professional.

**Open design question — please resolve it visually and recommend an answer:**
today's dark chrome (`#14110e`) is a **warm** near-black, but the new Light side is
**cool** gray. If the dark work-area is cool-gray, it may clash slightly with the warm
chrome. Show us your recommendation: either (a) keep the warm near-black chrome and
make the dark surfaces a matching neutral/warm dark, or (b) shift the chrome a touch
cooler so chrome + dark surfaces are one cool family. Pick one, show it, and say why.

---

## 6. Module accents & rules (keep these — they don't change between themes)

Each module keeps its accent color. The accent shows up **only in the top module-tab
row** (the active tab's text + a 2px underline) — accents do **not** color the work
surfaces. Each accent is really **two values**: a **fill** (the solid brand color,
fixed) and a **text** version (tuned so colored text is legible as foreground).

| Module | Fill (both themes) | Accent text — Light | Accent text — Dark |
|---|---|---|---|
| Site | `#1D9E75` | `#0F6E56` | `#5DCAA5` |
| Schedule | `#7F77DD` | `#534AB7` | `#AFA9EC` |
| Markup | `#EF9F27` | `#8A5410` | `#EF9F27` |

Rules to respect in the mockups:
- **Text sitting ON an accent fill:** Site & Schedule fills carry **white** text;
  the **amber Markup fill carries DARK text** (`#412402`) — white-on-amber is
  unreadable, so never use it.
- There's also a **project-status** color set (Pursuit / Active / On Hold / Complete /
  Dead) shown as small badges in the project list. If you show those, keep each
  status legible on the new surfaces; flag any that look weak in Part B.

---

## 7. The screens to mock (keep layouts identical; only colors change)

Render these three screens, each in **Light and Dark, side by side**. Don't redesign
the layout — same structure in both themes; the point is to show the *color* change.

1. **The top header / chrome** (spans the whole app):
   - **Row 1:** the **Planyr** logo + wordmark on the left, a project-name breadcrumb,
     the current project name centered, and a save badge + a user avatar / "Sign in"
     button on the right.
   - **Row 2:** the three module tabs — **Site · Schedule · Markup** — each with a
     small icon; the active tab shows its accent color + a 2px underline; a small
     toolbar of buttons sits on the right.

2. **The Site Planner work area** ("Site" tab active):
   - A large **drafting canvas** in the middle: an aerial map behind a faint
     **feet-based grid**, with **parcel boundaries** (green polygons), a **building**
     footprint, **parking**, and maybe a **pond**, plus a selected element in the
     drafting red-orange.
   - A thin **left tool rail** (stack of small icons).
   - **Right-side panels** (cards): a "Site analysis / yield" summary and a "Layers"
     list with little colored status dots.

3. **The Markup / Document Review work area** ("Markup" tab active):
   - A **construction-drawing PDF sheet** centered in the work area, with a couple of
     measurement annotations and a redline markup on it.
   - A **left sidebar** listing the sheets in the set (e.g. "A7.10 — Floor Plan").
   - A **right panel** with measurement / takeoff numbers.

Also include a **palette swatch sheet**: the Light tokens (§4), your new Dark tokens
(§5), and the module accents (§6) as labeled color chips, so the owner can see the
raw colors next to the mockups.

---

## 8. What to deliver

**Part A — the visuals (for Michael):**
- The three screens above, each shown **Light vs. Dark, side by side**.
- The palette swatch sheet.
- A few words under each image in plain English (what he's looking at).
- **Format:** rendered mockup **images** are ideal. *If your image tool can't render
  crisp, correct UI text,* instead produce a **single self-contained HTML file**
  (one file, inline CSS, no external libraries) that recreates these screens with a
  working **Light / Dark / System** toggle, so he can open it in a browser and flip
  it himself. Either is great; pick whichever you can make look most accurate.

**Part B — the build brief for Claude (end your response with this):**
A short, decision-ready spec Claude can implement without follow-up questions:
1. The **final Dark palette** — a hex for every token in the §5 table.
2. Your **recommendation on the warm-vs-cool chrome question** (§5), with the exact
   chrome hex(es) to use in Dark.
3. **Confirm or adjust** the module-accent text-on-dark values in §6.
4. Any **status-color** dark/light variants you'd recommend, or a note that they're fine.
5. Any **contrast warnings** (anything that fails AA and how you'd fix it).
Keep it concrete (hex values + short decisions), not open-ended. This is the handoff
that lets Claude build it.

---

## 9. Constraints to respect (don't break these)

- **Keep both themes structurally identical** — same layout, same spacing; only the
  colors swap. This is a re-skin, not a redesign.
- **Body text must clear WCAG AA (≥ 4.5:1)** against whatever surface it sits on, in
  both themes.
- **Module accents live only in the top tab row** — never as a work-surface color.
- **Amber fill always pairs with dark text** (never white).
- **Professional, calm, low-glare** — this is long-session engineering software, not a
  flashy marketing site.
- You are **not** writing React/production code. Claude implements against the real
  codebase; you provide the look (Part A) and the finalized palette spec (Part B).
