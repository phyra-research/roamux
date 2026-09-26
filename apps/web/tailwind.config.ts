import type { Config } from "tailwindcss"

// ---------------------------------------------------------------------------
// Design tokens (issue #103 — phyra.ai light theme; supersedes the dark
// `ink`/indigo palette from #82). Don't hardcode hex codes in components;
// reference these via Tailwind classes (`bg-accent`, `text-title`, etc).
//
// `ink` is fully retired, not reused for the new text color — reusing the
// same key name for a different role (bg family → text family) would mean
// every not-yet-migrated `bg-ink` usage silently renders as deep-blue
// instead of missing, which is worse than an honest gap while #104-107
// migrate each screen. `paper` (bg family) and `text` (foreground family)
// are new names; unmigrated components will render with missing styling
// until those follow-ups land — a known, accepted consequence of this
// sequencing, not a bug in this commit.
//
// Ratios computed via the standard WCAG relative-luminance formula against
// `paper` (#FFFFFF), this theme's page background. (Full cream #FAF1CA was too
// bright/saturated as a whole-page canvas; the page is now clean white and the
// cream is dropped entirely — a whisper of warmth survives only in the surface
// tint. Lightening the background only RAISES every text ratio below — no AA risk.)
//
//   paper.DEFAULT  #FFFFFF — page background (clean white; cream was too
//     bright/saturated to read against as a whole-page canvas).
//   paper.surface  #F8F7F2 — card/surface background, a whisper of warm grey,
//     distinct from the white page for separation without glare.
//   paper.line     #E8E6DF — border, a soft neutral line against the white
//     page (a fixed value, not a runtime opacity).
//   text.DEFAULT   #053C65 — body text. ~13:1 on paper (was 10.05:1 on cream).
//   text.muted     #4F7283 — de-emphasized text. `text` blended at 70% over
//     paper = 4.54:1, clearing the 4.5:1 normal-text bar for ALL text sizes.
//     The issue's own suggested ~65% only reaches 3.98:1 (short of 4.5,
//     though it clears the 3:1 large-text/UI bar) — verified, not assumed,
//     and bumped to 70% so `text-muted` needs no size restriction, the same
//     move #82 made when `accent` DEFAULT fell short in the dark theme.
//   accent.DEFAULT #053C65 — nav/primary-action fill. Cream text on it is
//     10.05:1 (same value as `text`, shared brand color, distinct semantic
//     role — not a duplication bug).
//   accent.hover   #042E4E — darker, for hover/press. 12.28:1 with cream
//     text (vs 10.05 resting) — unlike the dark theme, `accent` DEFAULT
//     already clears AA everywhere here, so this shade exists purely for
//     interaction feedback, not compliance.
//   success        #047857 (emerald-700) — 4.83:1 on paper. emerald-600
//     only reaches 3.32:1, too low for text.
//   error          #B91C1C (red-700) — 5.70:1 on paper.
//   warning        #92400E (amber-800) — 6.25:1 on paper. amber-700 falls
//     just short at 4.42:1.
//   "running"/live-indicator states reuse `accent`, not a new color — same
//     precedent as the dark theme (#82 explicitly allowed accent for
//     "live/running indicators"), and the design principle here still says
//     deep blue owns nav/live state.
//
// success.tint / error.tint (#105) — soft backgrounds for diff added/
//   removed LINES specifically (not badges/pills — those use the solid
//   `success`/`error` fills above; a tint's contrast depends on what's
//   behind it, and these are verified only against `paper`, the code-block
//   background, not `paper-surface`). Pre-computed low-alpha blends, not a
//   runtime `/N` opacity modifier: `success`/`error` text stays readable
//   against them specifically because the alpha was chosen for that —
//   raising it further would REDUCE contrast (the tint converges toward
//   the text color, not away from it).
//   success.tint  #F0ECC5 — success blended 4% over paper. success text
//     on it: 4.57:1. (10% only reaches 4.22:1 — short of 4.5.)
//   error.tint    #F5E0BC — error blended 8% over paper. error text
//     on it: 5.01:1.
//
// Type scale — 4 semantic sizes, additive to Tailwind's default scale
// (text-xs/text-sm/etc still work; these are named aliases for consistency):
//   caption (12px/16px) — meta, timestamps, secondary labels
//   body    (14px/20px) — default UI text (today's baseline)
//   title   (16px/22px) — section/card headings — pair with font-semibold
//   display (20px/26px) — page-level headings — pair with font-semibold
// ---------------------------------------------------------------------------
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: {
          // Near-white, barely-warm off-white — full cream (#FAF1CA) as a
          // whole-page canvas is too bright/saturated to read against. The
          // cream now lives only as a faint tint; the page reads as clean
          // white with a warm undertone.
          DEFAULT: "#FFFFFF",
          surface: "#F8F7F2",
          line: "#E8E6DF",
        },
        text: {
          DEFAULT: "#053C65",
          muted: "#4F7283",
        },
        accent: {
          DEFAULT: "#053C65",
          hover: "#042E4E",
        },
        success: {
          DEFAULT: "#047857",
          tint: "#F0ECC5",
        },
        error: {
          DEFAULT: "#B91C1C",
          tint: "#F5E0BC",
        },
        warning: "#92400E",
      },
      fontSize: {
        caption: ["0.75rem", { lineHeight: "1rem" }],
        body: ["0.875rem", { lineHeight: "1.25rem" }],
        title: ["1rem", { lineHeight: "1.375rem" }],
        display: ["1.25rem", { lineHeight: "1.625rem" }],
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config
