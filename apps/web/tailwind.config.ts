import type { Config } from "tailwindcss"

// ---------------------------------------------------------------------------
// Design tokens (issue #82) — the one place accent color and type scale are
// defined. Don't hardcode hex codes or one-off font sizes in components;
// reference these via Tailwind classes (`bg-accent`, `text-title`, etc).
//
// Accent color — indigo. Two shades, NOT interchangeable:
//   accent (#6366F1, indigo-500) — non-text UI only: borders, focus rings,
//     indicator dots, low-opacity tints (bg-accent/10). Contrast vs `ink`
//     background is 4.43:1 — clears the 3:1 bar for UI components/large
//     graphics but FAILS the 4.5:1 bar for normal text, with either dark or
//     white text on top. Never use for text or as a text-bearing button fill.
//   accent-bright (#818CF8, indigo-400) — the AA-safe shade. Contrast vs
//     `ink` is 6.63:1 with dark (`text-ink`) text or as accent-colored text
//     directly on the dark background. Use for: primary button fills (paired
//     with `text-ink`, never white — white-on-bright is only 2.98:1), any
//     accent-colored text/links/live-labels, and hover/active dimming should
//     use opacity, not a swap to `accent` (which is less contrasty).
// Ratios computed via the standard WCAG relative-luminance formula against
// this file's `ink` (#0a0a0b) background.
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
        // A calm, neutral control-surface palette.
        ink: {
          DEFAULT: "#0a0a0b",
          soft: "#131316",
          line: "#26262b",
        },
        accent: {
          DEFAULT: "#6366F1",
          bright: "#818CF8",
        },
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
