/** Join class names, dropping falsy values so conditionals stay readable. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}
