import { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GatewayHttpService } from './gateway-http.service.js';
import { SslCommerzService } from './sslcommerz.service.js';
import { formatGatewayAmount, parseGatewayAmount } from './money.js';

const identity = { gatewayMode: 'SANDBOX' as const, gatewayStoreId: 'fixture' };
const config = () =>
  new ConfigService({
    SSLCOMMERZ_MODE: 'sandbox',
    SSLCOMMERZ_STORE_ID: 'fixture',
    SSLCOMMERZ_STORE_PASSWORD: 'private-password',
    PUBLIC_API_URL: 'https://api.example.com',
  });
const input = {
  ...identity,
  merchantTranId: 'a'.repeat(24),
  amountMinor: 150000,
  customer: {
    name: 'Customer',
    email: 'customer@example.com',
    phone: '+8801712345678',
    address: 'House 12',
    city: 'Dhaka',
    postcode: '1000',
  },
};
const charge = {
  APIConnect: 'DONE',
  status: 'VALID',
  tran_id: input.merchantTranId,
  bank_tran_id: 'bank-1',
  val_id: 'validation-1',
  amount: '1500.00',
  currency: 'BDT',
  currency_type: 'BDT',
  currency_amount: '1500.00',
  risk_level: '0',
};
function fixture() {
  const http = new GatewayHttpService();
  const json = vi.spyOn(http, 'json');
  return { service: new SslCommerzService(config(), http), json };
}
afterEach(() => vi.unstubAllGlobals());

describe('Gateway money boundary', () => {
  it.each([
    ['0.01', 1],
    ['1500', 150000],
    ['1500.5', 150050],
    ['500000.00', 50000000],
  ])('parses %s exactly', (value, minor) =>
    expect(parseGatewayAmount(value)).toBe(minor),
  );
  it.each([
    '1e3',
    '-1',
    '01',
    '0.001',
    'NaN',
    '10000000.01',
    1,
    undefined,
    ' 10.00',
  ])('rejects ambiguous amounts %s', (value) =>
    expect(parseGatewayAmount(value)).toBeNull(),
  );
  it('formats and bounds gateway amounts', () => {
    expect(formatGatewayAmount(1001)).toBe('10.01');
    expect(() => formatGatewayAmount(999)).toThrow();
    expect(() => formatGatewayAmount(50000001)).toThrow();
  });
});
describe('SSLCommerz adapter', () => {
  it('posts server-owned values to the fixed endpoint', async () => {
    const { service, json } = fixture();
    json.mockResolvedValue({
      status: 'SUCCESS',
      sessionkey: 'session-1',
      GatewayPageURL:
        'https://sandbox.sslcommerz.com/gwprocess/v4/gw.php?SESSIONKEY=session-1',
    });
    expect(await service.initiate(input)).toMatchObject({
      kind: 'ready',
      sessionKey: 'session-1',
    });
    const [url, form] = json.mock.calls[0]!;
    expect(url.origin).toBe('https://sandbox.sslcommerz.com');
    expect(form?.get('total_amount')).toBe('1500.00');
    expect(form?.get('ipn_url')).toBe(
      'https://api.example.com/api/v1/payments/sslcommerz/ipn',
    );
    expect(form?.get('product_profile')).toBe('non-physical-goods');
  });
  it.each([
    'https://attacker.example/pay',
    'http://sandbox.sslcommerz.com/pay',
    'https://sandbox.sslcommerz.com.attacker.example/pay',
    'https://user:pass@sandbox.sslcommerz.com/pay',
    'invalid',
  ])('rejects unsafe checkout URL %s', async (url) => {
    const { service, json } = fixture();
    json.mockResolvedValue({
      status: 'SUCCESS',
      sessionkey: 's',
      GatewayPageURL: url,
    });
    await expect(service.initiate(input)).rejects.toMatchObject({
      status: 502,
    });
  });
  it('fails closed on disabled or changed merchant configuration', async () => {
    const { service, json } = fixture();
    expect(() =>
      new SslCommerzService(
        new ConfigService(),
        new GatewayHttpService(),
      ).identity(),
    ).toThrow();
    await expect(
      service.validate({ ...identity, gatewayMode: 'LIVE' }, 'v'),
    ).rejects.toMatchObject({ status: 503 });
    expect(json).not.toHaveBeenCalled();
  });
  it('recognizes definitive initiation rejection without returning provider details', async () => {
    const { service, json } = fixture();
    json.mockResolvedValue({
      status: 'FAILED',
      failedreason: 'private-password',
    });
    expect(await service.initiate(input)).toEqual({ kind: 'rejected' });
  });
  it.each([
    { status: 'INVALID_TRANSACTION' },
    { APIConnect: 'FAILED' },
    { risk_level: undefined },
    { val_id: 'foreign' },
    { amount: '1e3' },
  ])('rejects invalid verification %j', async (changes) => {
    const { service, json } = fixture();
    json.mockResolvedValue({ ...charge, ...changes });
    await expect(
      service.validate(identity, 'validation-1'),
    ).rejects.toMatchObject({ status: 502 });
  });
  it('normalizes VALIDATED and risky evidence without trusting callback amounts', async () => {
    const { service, json } = fixture();
    json.mockResolvedValue({ ...charge, status: 'VALIDATED', risk_level: '1' });
    expect(await service.validate(identity, 'validation-1')).toMatchObject({
      amountMinor: 150000,
      risky: true,
    });
  });
  it('does not close checkout for an individual failed bank attempt', async () => {
    const { service, json } = fixture();
    json
      .mockResolvedValueOnce({
        APIConnect: 'DONE',
        no_of_trans_found: 1,
        element: [{ status: 'FAILED', tran_id: input.merchantTranId }],
      })
      .mockResolvedValueOnce({
        APIConnect: 'DONE',
        status: 'PENDING',
        tran_id: input.merchantTranId,
        sessionkey: 's',
      });
    expect(
      await service.lookup({
        ...identity,
        merchantTranId: input.merchantTranId,
        sessionKey: 's',
      }),
    ).toEqual({ charges: [], terminal: null });
  });
  it('revalidates every distinct captured transaction from merchant lookup', async () => {
    const { service, json } = fixture();
    json
      .mockResolvedValueOnce({
        APIConnect: 'DONE',
        no_of_trans_found: 2,
        element: [{ ...charge }, { ...charge, val_id: 'validation-2' }],
      })
      .mockResolvedValueOnce(charge)
      .mockResolvedValueOnce({
        ...charge,
        val_id: 'validation-2',
        bank_tran_id: 'bank-2',
      });
    expect(
      (
        await service.lookup({
          ...identity,
          merchantTranId: input.merchantTranId,
          sessionKey: null,
        })
      ).charges,
    ).toHaveLength(2);
    expect(json).toHaveBeenCalledTimes(3);
  });
  it.each([
    { APIConnect: 'FAILED', no_of_trans_found: 0 },
    { APIConnect: 'DONE', no_of_trans_found: 1, element: [] },
    {
      APIConnect: 'DONE',
      no_of_trans_found: 1,
      element: [{ status: 'VALID', tran_id: 'foreign', val_id: 'v' }],
    },
  ])('rejects untrusted lookup %j', async (result) => {
    const { service, json } = fixture();
    json.mockResolvedValue(result);
    await expect(
      service.lookup({
        ...identity,
        merchantTranId: input.merchantTranId,
        sessionKey: null,
      }),
    ).rejects.toMatchObject({ status: 502 });
  });
});
describe('Gateway HTTP transport', () => {
  it('redacts URLs and credentials from network errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('store_passwd=private-password')),
    );
    await expect(
      new GatewayHttpService().json(new URL('https://sandbox.sslcommerz.com/')),
    ).rejects.toMatchObject({
      status: 502,
      message: 'Payment gateway unavailable or returned an invalid response',
    });
  });
  it.each([
    new Response('invalid'),
    new Response('x'.repeat(128001)),
    new Response('{}', { status: 503 }),
  ])('rejects malformed, oversized or failed responses', async (response) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    await expect(
      new GatewayHttpService().json(new URL('https://sandbox.sslcommerz.com/')),
    ).rejects.toMatchObject({ status: 502 });
  });
});
