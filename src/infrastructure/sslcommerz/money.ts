// Gateway decimals are parsed with integer arithmetic, never floating-point multiplication.
export function parseGatewayAmount(value: unknown): number | null {
  if (
    typeof value !== 'string' ||
    !/^(0|[1-9]\d{0,7})(\.\d{1,2})?$/.test(value)
  )
    return null;
  const [whole, fraction = ''] = value.split('.');
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return minor <= 1_000_000_000 ? minor : null;
}
export function formatGatewayAmount(minor: number): string {
  if (!Number.isSafeInteger(minor) || minor < 1000 || minor > 50_000_000)
    throw new RangeError('SSLCommerz supports BDT 10–500,000');
  return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, '0')}`;
}
