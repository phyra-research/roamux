import { NextResponse } from "next/server"
import type { ZodError, ZodSchema } from "zod"

/**
 * Small, consistent API response helpers for the route handlers. Every endpoint
 * returns `{ ok: true, data }` or `{ ok: false, error }` so the client has one
 * shape to parse. Keeps handlers short and uniform.
 */

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, init)
}

export function fail(status: number, error: string, init?: ResponseInit) {
  return NextResponse.json({ ok: false, error }, { status, ...init })
}

export const badRequest = (error: string) => fail(400, error)
export const unauthorized = (error = "unauthorized") => fail(401, error)
export const forbidden = (error = "forbidden") => fail(403, error)
export const notFound = (error = "not found") => fail(404, error)
export const serverError = (error = "internal error") => fail(500, error)

/** Parse + validate a JSON request body against a Zod schema. */
export async function parseBody<T>(
  req: Request,
  schema: ZodSchema<T>,
): Promise<{ ok: true; value: T } | { ok: false; response: NextResponse }> {
  let json: unknown
  try {
    json = await req.json()
  } catch {
    return { ok: false, response: badRequest("invalid JSON body") }
  }
  const result = schema.safeParse(json)
  if (!result.success) {
    return { ok: false, response: badRequest(formatZodError(result.error)) }
  }
  return { ok: true, value: result.data }
}

function formatZodError(err: ZodError): string {
  return err.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ")
}
