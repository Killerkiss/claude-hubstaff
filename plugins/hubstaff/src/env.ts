/** Reads an env var, treating empty values and unexpanded `${...}` placeholders as unset. */
export function envValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  if (!value || /^\$\{[^}]*\}$/.test(value)) return undefined;
  return value;
}
