import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { vi } from 'vitest';
import { z } from 'zod';

const redis = vi.hoisted(() => ({
  isReady: true,
  isOpen: true,
  connect: vi.fn().mockResolvedValue(undefined),
  destroy: vi.fn(),
  on: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
  withAbortSignal: vi.fn(),
}));
vi.mock('redis', () => ({ createClient: vi.fn(() => redis) }));
import { createClient } from 'redis';
import { RedisCacheService } from './redis-cache.service.js';

describe('Optional catalog cache', () => {
  let cache: RedisCacheService;
  const warn = vi.fn();
  const schema = z.strictObject({ name: z.string() });
  const value = { name: 'Fresh DB data' };
  const database = 'postgresql://user:secret@localhost:5432/fieldops_test';
  const config = (url?: string) =>
    new ConfigService({ DATABASE_URL: database, REDIS_URL: url });

  beforeEach(() => {
    vi.clearAllMocks();
    redis.isReady = true;
    redis.isOpen = true;
    redis.get.mockResolvedValue(null);
    redis.set.mockResolvedValue('OK');
    redis.withAbortSignal.mockReturnValue(redis);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(warn);
    cache = new RedisCacheService(config('redis://localhost:6379/1'));
  });
  afterEach(() => vi.restoreAllMocks());

  it('returns validated hits without consulting the loader', async () => {
    redis.get.mockResolvedValue(JSON.stringify(value));
    const load = vi.fn().mockResolvedValue(value);
    expect(
      await cache.remember('catalog:v1:1:detail:test', schema, load),
    ).toEqual(value);
    expect(load).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
    expect(redis.get.mock.calls[0]?.[0]).toMatch(
      /^fieldops:[a-f0-9]{16}:catalog:/,
    );
    expect(redis.get.mock.calls[0]?.[0]).not.toContain('secret');
  });

  it.each([
    '{broken',
    JSON.stringify({ name: 'Old', passwordHash: 'injected' }),
    JSON.stringify({ name: 42 }),
  ])('replaces malformed or non-public cached payloads: %s', async (raw) => {
    redis.get.mockResolvedValue(raw);
    const load = vi.fn().mockResolvedValue(value);
    expect(await cache.remember('catalog:test', schema, load)).toEqual(value);
    expect(load).toHaveBeenCalledOnce();
    expect(redis.set).toHaveBeenCalledWith(
      expect.any(String),
      JSON.stringify(value),
      { EX: 60 },
    );
  });

  it('falls back immediately with no URL or disconnected client', async () => {
    const load = vi.fn().mockResolvedValue(value);
    await new RedisCacheService(config()).remember(
      'catalog:test',
      schema,
      load,
    );
    redis.isReady = false;
    await cache.remember('catalog:test', schema, load);
    expect(load).toHaveBeenCalledTimes(2);
    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('survives read/write errors and propagates database errors', async () => {
    redis.get.mockRejectedValue(new Error('Private connection credentials'));
    redis.set.mockRejectedValue(new Error('Redis unavailable'));
    expect(
      await cache.remember('catalog:test', schema, async () => value),
    ).toEqual(value);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining('credentials'),
    );
    const dbError = new Error('Database unavailable');
    await expect(
      cache.remember('catalog:test', schema, () => Promise.reject(dbError)),
    ).rejects.toBe(dbError);
  });

  it('bounds hung cache commands with an AbortSignal', async () => {
    redis.withAbortSignal.mockImplementation((signal: AbortSignal) => ({
      get: () =>
        new Promise((_, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          }),
        ),
      set: redis.set,
    }));
    expect(
      await cache.remember('catalog:test', schema, async () => value),
    ).toEqual(value);
    const signal = redis.withAbortSignal.mock.calls[0]?.[0] as AbortSignal;
    expect(signal.aborted).toBe(true);
  });

  it('starts asynchronously, handles connection failure and stops reconnecting on shutdown', async () => {
    redis.connect.mockRejectedValueOnce(new Error('Connection failed'));
    cache.onModuleInit();
    await Promise.resolve();
    expect(warn).toHaveBeenCalledOnce();
    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({
        disableOfflineQueue: true,
        socket: expect.objectContaining({ connectTimeout: 500 }),
      }),
    );
    cache.onModuleDestroy();
    expect(redis.destroy).toHaveBeenCalledOnce();
  });

  it('isolates cache keys between application databases', async () => {
    await cache.remember('catalog:test', schema, async () => value);
    const main = new RedisCacheService(
      new ConfigService({
        DATABASE_URL: database.replace('fieldops_test', 'fieldops'),
        REDIS_URL: 'redis://localhost:6379',
      }),
    );
    await main.remember('catalog:test', schema, async () => value);
    expect(redis.get.mock.calls[0]?.[0]).not.toEqual(
      redis.get.mock.calls[1]?.[0],
    );
  });
});
