import { ok } from "../../../lib/api/respond"

const REPO = "phyra-research/roamux"

/**
 * GET /api/github-stars — proxies GitHub's public repo API for the header
 * star button. No auth (the header renders for signed-out visitors too).
 *
 * Cached via Next's fetch revalidate, not client-side localStorage: routing
 * every visitor's browser straight to api.github.com would each count
 * against GitHub's 60/hr-per-IP unauthenticated limit independently, but a
 * launch-day traffic spike hitting *our* server still only means one
 * GitHub request per hour, total, no matter how many visitors we get.
 *
 * Never returns an error status — a failed GitHub fetch is an expected,
 * non-exceptional outcome here (the button degrades to icon + "Star" with
 * no count), not a server error.
 */
export async function GET() {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}`, {
      headers: { Accept: "application/vnd.github+json" },
      next: { revalidate: 3600 },
    })
    if (!res.ok) return ok({ count: null })
    const body = await res.json()
    const count = typeof body.stargazers_count === "number" ? body.stargazers_count : null
    return ok({ count })
  } catch {
    return ok({ count: null })
  }
}
