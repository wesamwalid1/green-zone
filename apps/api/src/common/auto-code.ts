/** Generate a short unique-ish code when the user leaves the field empty. */
export function autoCode(prefix: string, value?: string | null) {
  const trimmed = (value || '').trim();
  if (trimmed) return trimmed;
  return `${prefix}${Date.now().toString(36).toUpperCase()}`;
}
