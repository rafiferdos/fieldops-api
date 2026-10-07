import { createHash } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from 'redis';
import type { z } from 'zod';

@Injectable()
export class RedisCacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisCacheService.name);
  private readonly client: ReturnType<typeof createClient> | undefined;
  private readonly prefix: string;
  private outageReported = false;

  constructor(@Inject(ConfigService) config: ConfigService) {
    const database = new URL(config.getOrThrow<string>('DATABASE_URL'));
    const scope = [
      database.hostname,
      database.port || '5432',
      database.pathname,
      database.searchParams.get('schema') || 'public',
    ].join('|');
    this.prefix = `fieldops:${createHash('sha256').update(scope).digest('hex').slice(0, 16)}:`;
    const url = config.get<string>('REDIS_URL')?.trim();
    if (url) {
      this.client = createClient({
        url,
        disableOfflineQueue: true,
        socket: {
          connectTimeout: 500,
          reconnectStrategy: (retries) =>
            Math.min(100 * 2 ** Math.min(retries, 5), 3000),
        },
      });
      // Mandatory listener; never log connection URLs, credentials or provider errors.
      this.client.on('error', () => this.reportOutage());
      this.client.on('ready', () => {
        this.outageReported = false;
      });
    }
  }

  onModuleInit() {
    // Optional cache must never hold up API startup or queue requests during outages.
    void this.client?.connect().catch(() => this.reportOutage());
  }

  onModuleDestroy() {
    if (this.client?.isOpen) this.client.destroy();
  }

  async remember<T>(
    key: string,
    schema: z.ZodType<T>,
    load: () => Promise<T>,
  ): Promise<T> {
    const cacheKey = this.prefix + key;
    if (this.client?.isReady) {
      try {
        const raw = await this.client
          .withAbortSignal(AbortSignal.timeout(150))
          .get(cacheKey);
        if (raw !== null) {
          const parsed = schema.safeParse(JSON.parse(raw));
          if (parsed.success) return parsed.data;
        }
      } catch {
        this.reportOutage();
      }
    }

    // Database failures propagate; only optional cache failures are swallowed.
    const value = await load();
    if (this.client?.isReady) {
      try {
        await this.client
          .withAbortSignal(AbortSignal.timeout(150))
          .set(cacheKey, JSON.stringify(value), { EX: 60 });
      } catch {
        this.reportOutage();
      }
    }
    return value;
  }

  private reportOutage() {
    if (!this.outageReported) {
      this.logger.warn('Catalog cache unavailable; falling back to PostgreSQL');
      this.outageReported = true;
    }
  }
}
