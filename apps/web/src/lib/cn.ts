/** Joins conditional class names, dropping falsy values. No conflict resolution — later Tailwind utilities in the string don't override earlier ones of the same property, so callers should avoid passing conflicting utilities. */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ")
}
