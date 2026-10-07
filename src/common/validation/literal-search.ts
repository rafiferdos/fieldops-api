// Prisma contains uses SQL LIKE. Preserve %, _ and backslash as literal input.
export function literalSearch(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}
