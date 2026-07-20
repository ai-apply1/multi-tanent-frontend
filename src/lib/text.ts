export function titleCase(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .toLowerCase()
    .split(/(\s+)/)
    .map((part) => (/\s+/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join("");
}
