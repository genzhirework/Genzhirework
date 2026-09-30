# I. UI/UX Design System — "Precision Blue"

**Principle:** the brand is dark, electric blue marks the actions, surfaces stay neutral, typography does most of the work, cards are minimal, and dashboards carry a lot of data (spec §71). Blue is used precisely, only where there is something to act on or notice. It never floods a whole area.

The design system lives in `libs/ui` (see [12-component-architecture.md](12-component-architecture.md)). It is built from CSS custom properties and Angular standalone components. **No third-party component kit.** Angular CDK is used only for headless behaviour (overlay, a11y focus trap, drag-drop, virtual scroll), never for how things look.

## 1. Themes

There are three themes, and each application sets one of them with `data-theme` on `<html>`:

| Theme | Used by | Character |
|---|---|---|
| `brand` | Public homepage hero, auth pages, marketing sections | Dark `#080B12`, larger type, the most blue accent |
| `light` | Candidate app, public job search and job details | `#F7F9FC` background, white cards, dark text |
| `dark` | Employer, recruiter, admin | Dark sidebar and workspace, raised cards, dense layout |

Employer, recruiter and admin can switch to `light` later. The tokens already support it, but only `dark` ships in the MVP.

## 2. Colour tokens

### 2.1 Dark / brand (from spec §41, with the accessibility corrections below)

```css
[data-theme='dark'], [data-theme='brand'] {
  --bg:               #080B12;
  --bg-subtle:        #0D111A;   /* sidebar, table header */
  --surface:          #111722;   /* card */
  --surface-raised:   #151C29;   /* popover, modal, hovered row */
  --border:           #202938;   /* dividers, card edges (decorative) */
  --border-strong:    #5D6B82;   /* input/checkbox edges — ≥3:1 (WCAG 1.4.11) */

  --text:             #F5F7FA;
  --text-secondary:   #98A2B3;
  --text-muted:       #7D8799;   /* corrected from #667085 — see §2.3 */
  --text-disabled:    #667085;

  --primary:          #1683FF;   /* accent: focus ring, active nav, links, icons, charts */
  --primary-fill:     #0A6BDB;   /* button background with white label */
  --primary-fill-hover:#0B63CE;
  --electric:         #00A8FF;   /* data highlights, progress, selected chip border */
  --highlight:        #38B6FF;   /* link hover, KPI delta up */
  --primary-tint:     rgb(22 131 255 / 0.12);  /* selected row, active chip bg */

  --success: #12B76A;  --success-tint: rgb(18 183 106 / 0.12);
  --warning: #F79009;  --warning-tint: rgb(247 144 9 / 0.12);
  --danger:  #F04438;  --danger-tint:  rgb(240 68 56 / 0.12);
  --danger-fill: #D92D20;

  --focus-ring: 0 0 0 2px var(--bg), 0 0 0 4px var(--primary);
  --shadow-1: 0 1px 2px rgb(0 0 0 / 0.4);
  --shadow-2: 0 8px 24px rgb(0 0 0 / 0.45);
}
```

### 2.2 Light (candidate)

```css
[data-theme='light'] {
  --bg: #F7F9FC;  --bg-subtle: #EEF2F7;  --surface: #FFFFFF;  --surface-raised: #FFFFFF;
  --border: #E4E7EC;  --border-strong: #868FA0;
  --text: #101828;  --text-secondary: #475467;  --text-muted: #667085;  --text-disabled: #98A2B3;
  --primary: #0A6BDB;  --primary-fill: #0A6BDB;  --primary-fill-hover: #0B63CE;
  --electric: #1683FF;  --highlight: #0B63CE;  --primary-tint: #EAF3FF;
  --success: #067647; --success-tint: #ECFDF3;
  --warning: #B54708; --warning-tint: #FFFAEB;
  --danger:  #D92D20; --danger-tint:  #FEF3F2; --danger-fill: #D92D20;
  --shadow-1: 0 1px 2px rgb(16 24 40 / 0.06);
  --shadow-2: 0 12px 24px rgb(16 24 40 / 0.10);
}
```

### 2.3 Accessibility corrections

These ratios were computed with the WCAG 2.x relative-luminance formula.

| Pair | Ratio | Verdict | Action |
|---|---|---|---|
| White on `#1683FF` (spec primary as button) | **3.67:1** | ✗ below 4.5:1 for normal text | Buttons use `--primary-fill` `#0A6BDB` (5.07:1). `#1683FF` stays the accent. |
| `#1683FF` text on `#080B12` / `#111722` | 5.37 / 4.89 | ✓ | Allowed for links on dark |
| `#1683FF` text on white | 3.67 | ✗ | Light theme uses `#0A6BDB` for links (5.07) |
| `#667085` muted on `#111722` | **3.61** | ✗ | Dark muted text → `#7D8799` (4.96 on card, 4.71 on raised). `#667085` is kept for disabled text only, which WCAG exempts. |
| `#98A2B3` secondary on `#111722` | 6.97 | ✓ | |
| `#202938` border on `#111722` | 1.23 | ✗ for input edges (need 3:1) | `--border-strong` `#5D6B82` (3.33) for inputs, checkboxes, radios. `#202938` stays for decorative dividers. |
| `#F04438` / `#12B76A` / `#F79009` on `#111722` | 4.78 / 6.85 / 7.65 | ✓ | Status colours are always shown with a text label or icon as well, never by colour alone. |

## 3. Typography

**Inter** (variable, self-hosted as `woff2`, subset to Latin + Latin-Ext + ₹). Fallback: `system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`. Numbers in tables and KPIs use `font-variant-numeric: tabular-nums`.

| Token | Size / line height | Weight | Use |
|---|---|---|---|
| `display` | 48/56 (mobile 36/44) | 700, tracking −0.02em | Homepage hero only |
| `h1` | 30/38 | 650 | Page titles |
| `h2` | 22/30 | 600 | Section titles |
| `h3` | 18/26 | 600 | Card titles |
| `body-lg` | 16/24 | 400 | Candidate app body text, job descriptions |
| `body` | 14/20 | 400 | Dashboard body text |
| `body-strong` | 14/20 | 500 | Table primary column, labels |
| `caption` | 12/16 | 500 | Metadata, badges, table headers (uppercase + 0.04em tracking only in table headers) |
| `kpi` | 28/32 | 600 tabular | KPI tiles |

The candidate app uses `body-lg` as its default text size, and dashboards use `body`.

## 4. Spacing, radius, elevation, motion

- **Spacing** is built on an 8px scale: `--space-1: 4px` (hairline only), `2: 8`, `3: 12`, `4: 16`, `5: 24`, `6: 32`, `7: 48`, `8: 64`, `9: 96`.
- **Density.** Dashboard table rows are 44px (compact 36px). The candidate app's minimum touch target is 44 × 44.
- **Radius.** `--radius-sm: 8px` (inputs, chips, buttons), `--radius-md: 12px` (cards), `--radius-lg: 14px` (modals, drawers). Nothing is more rounded than 14px except avatars and pills.
- **Elevation.** Dark themes show depth with **surface colour steps**, not shadows. `--shadow-2` is used only on floating layers (menus, modals).
- **Motion.** `--dur-fast: 150ms` (hover, press), `--dur-base: 200ms` (drawer, modal, tab), `--dur-slow: 250ms` (page transition). Easing is `cubic-bezier(0.2, 0, 0, 1)`. `prefers-reduced-motion` turns every transition into an instant change. There are no glows, no infinite animations, and no parallax. The only loop allowed is the skeleton shimmer, a 1.2s linear gradient at 4% opacity.

## 5. Layout grids

| Surface | Grid |
|---|---|
| Public / candidate | Content max width 1200px, 12 columns, 24px gutter. At ≤ 767px: 4 columns, 16px side padding, bottom tab bar. |
| Dashboards | Sidebar 240px (collapses to a 64px icon rail at ≤ 1279px, and becomes an overlay drawer at ≤ 1023px). Content area is fluid, with forms capped at 1440px. Top bar is 56px. |
| Breakpoints | `xs` 320 · `sm` 375 · `md` 768 · `lg` 1024 · `xl` 1280 · `2xl` 1440 |

## 6. Component inventory (spec §51)

Every component has a spec (anatomy, variants, states), keyboard behaviour, ARIA pattern, and a Storybook story with an axe test.

| Component | Variants / notes | A11y pattern |
|---|---|---|
| **Button** | `primary` (fill `--primary-fill`) · `secondary` (surface + `--border-strong`) · `ghost` · `danger` · `link`. Sizes: sm 32, md 36, lg 44 (candidate primary buttons use lg). States: hover, active, focus-visible, loading (spinner replaces icon, width locked), disabled. | native `<button>`; `aria-busy` while loading |
| **Input / Textarea** | label above, hint, error below, prefix/suffix (₹, icon), character counter | `aria-describedby` for hint/error; `aria-invalid` |
| **Select** / **Combobox** | single, multi (chips), async typeahead (skills, cities) | ARIA combobox 1.2 |
| **Checkbox / Radio / Switch** | | native inputs, styled |
| **Modal** | sm 400, md 560, lg 720. Confirmations use the `ConfirmDialog` preset (title, consequence text, primary action named after what it does, such as "Reject 12 applicants", never "OK"). | dialog, focus trap, Esc closes (not on destructive confirms mid-request) |
| **Drawer** | right, 480/640px; used for the applicant preview, filters (mobile), and details on dashboards | dialog |
| **Toast** | success/info/warning/error. Auto-dismiss after 5s except errors. Max 3 stacked. Bottom-right on desktop, top on mobile. | `role=status` / `alert` |
| **Badge / StatusBadge** | tint background + text + optional dot. `StatusBadge` maps a domain status to a label and colour in one table per domain (application, job, verification, pipeline, invoice). | text is always present |
| **Avatar** | image or initials (colour hashed from the ID across 6 muted hues), sizes 24/32/40/64 | alt = name, or decorative |
| **Card** | `surface`, 12px radius, 1px `--border`, padding 16/24. Variants: `interactive` (hover lifts to `--surface-raised`) and `selected` (1px `--primary` border + tint). | |
| **Table** | sticky header, sortable columns, row selection, row actions menu, column visibility, density toggle, virtual scroll above 200 rows, and a card layout on mobile | `table` semantics; `aria-sort` |
| **Pagination** | cursor-based "Previous / Next" + page size, or "Load more" on mobile | nav landmark |
| **Tabs** | underline style; the active tab has a 2px `--primary` underline | ARIA tabs |
| **Dropdown / Menu** | | ARIA menu |
| **Tooltip** | only for icon-only buttons and truncated text. Never holds information that can't be reached another way. | `aria-describedby` |
| **EmptyState** | icon (line, 48px), title, one sentence, optional primary action | |
| **LoadingState / Skeleton** | skeleton shaped like the content (a table skeleton has as many rows as the page size) | `aria-busy` on container |
| **ErrorState** | the 5 variants: error, permission denied, not found, offline, rate limited. Each has a retry action and shows the `requestId` for support. | |
| **SearchBar** | large (hero), standard (toolbar); `/` shortcut focuses it on dashboards | `role=search` |
| **FilterChip** | removable chip showing a filter's value; "Clear all"; overflows into "+3" | button with `aria-pressed` |
| **CreditMeter** | "37 of 50 profile views left · expires 29 Sep 2027". A thin bar that turns warning at ≤ 10 and danger at 0. | `role=meter` |
| **ProfileCard** | candidate self-summary (dashboard) | |
| **JobCard** | title, company + verified mark, location · work mode, salary, experience, top 3 skills, posted date; Save icon button; "Apply" (candidate) | article |
| **CandidateCard** | the fields from spec §22 with the name masked (D5); `viewerState` badges (Unlocked, Applied, Saved); "View profile" | article |
| **Timeline** | vertical: application status history, candidate access history, audit trail | list |
| **KanbanColumn / KanbanCard** | column header with count; drag with keyboard support (space to lift, arrows to move, space to drop); moves that need confirmation ask first | CDK drag-drop + live region announcements |
| **DataChart** | line, bar, stacked bar, donut (≤ 5 slices). Wraps Apache ECharts with a GenZHire theme. Every chart has a table fallback ("View as table"). Series colours start at `--electric`, then 4 muted hues. | `role=img` + summary |
| **StatTile** (KPI) | value, label, delta vs. previous period, optional sparkline | |
| **PageHeader** | title, breadcrumb, primary + secondary actions, tabs slot | h1 |
| **AppShell** | sidebar, top bar (search, notifications bell, account menu), content; candidate variant has the bottom tab bar | landmarks |

## 7. Content & terminology

- One word per concept, used everywhere: **Profile view credit** (not "view", "unlock credit" or "token"). **Unlock** is the verb. **Hiring requirement** (not "requirement request"). **HR consultant** in customer-facing copy and **Recruiter** inside SISTECHWORK.
- Numbers use Indian grouping: `₹6,00,000`, `3–5 LPA`. Dates are written `29 Sep 2026` and times `11:32 AM IST`.
- Candidate-facing tone: warm, direct, encouraging, and never pushy. Employer tone: efficient and exact.
- Empty and limit states name the next action, for example: *"You've used all 50 free profile views. Unlocked profiles stay available until their unlock expires. [View usage] [Contact sales]"*.

## 8. Visual direction per surface

- **Homepage hero** (`brand`). A dark field with one precise blue element: a 1px electric-blue grid line motif at 6% opacity that fades out, behind a large, centred search bar. Headline "Find Your Next Opportunity." in `display`. Primary CTA "Find Jobs" (primary-fill), secondary "I'm Hiring" (outline). No stock photos of people shaking hands, and no gradients bigger than the hero. The sections below the hero switch to `light`.
- **Candidate app** (`light`). Airy. Job cards are white with a 1px border, and the blue only appears on primary actions and the progress ring.
- **Employer** (`dark`). Workspace-first. The talent search toolbar stays visible as you scroll: search, filter chips, result count, and the `CreditMeter` pinned to the right.
- **Recruiter** (`dark`). Kanban-first. Each column header shows the count plus a small SLA indicator. Tracker rows are coloured by days remaining.
- **Admin** (`dark`, dense). The KPI row, then 2×2 charts, then activity feed and queues. Tables default to compact density.
