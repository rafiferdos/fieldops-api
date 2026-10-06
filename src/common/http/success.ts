export function success<T>(data: T, message: string) {
  return { success: true as const, message, data };
}
