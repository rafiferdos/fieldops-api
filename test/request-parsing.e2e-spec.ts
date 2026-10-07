import { Logger } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeTestApi, createTestApi, type TestApi } from './helpers/api.js';

describe('Safe request parsing errors', () => {
  let api: TestApi;
  beforeEach(async () => {
    api = await createTestApi();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await closeTestApi(api);
  });
  it('does not echo credential/card snippets from malformed JSON', async () => {
    const log = vi.spyOn(Logger.prototype, 'error');
    const result = await request(api.app.getHttpServer())
      .post('/api/v1/payments/sslcommerz/ipn')
      .type('json')
      .send('{"password":"private-password","card_no":"private-card", broken }')
      .expect(400);
    expect(result.body).toEqual({
      success: false,
      message: 'Invalid request',
      errors: [],
    });
    expect(result.headers['cache-control']).toBe('no-store');
    expect(log).not.toHaveBeenCalled();
  });
  it('preserves an oversized-body 413 using a safe JSON envelope', async () => {
    const log = vi.spyOn(Logger.prototype, 'error');
    const result = await request(api.app.getHttpServer())
      .post('/api/v1/payments/sslcommerz/ipn')
      .type('json')
      .send({ value: 'x'.repeat(110000) })
      .expect(413);
    expect(result.body).toEqual({
      success: false,
      message: 'Request body too large',
      errors: [],
    });
    expect(log).not.toHaveBeenCalled();
  });
  it('does not echo invalid URI input and handles unsupported encodings', async () => {
    const invalid = await request(api.app.getHttpServer())
      .get('/api/v1/services/%FF')
      .expect(400);
    expect(invalid.body.message).toBe('Invalid request');
    const encoding = await request(api.app.getHttpServer())
      .post('/api/v1/payments/sslcommerz/ipn')
      .set('Content-Encoding', 'unsupported-private-data')
      .type('json')
      .send('{}')
      .expect(415);
    expect(encoding.body).toEqual({
      success: false,
      message: 'Unsupported request encoding',
      errors: [],
    });
  });
});
