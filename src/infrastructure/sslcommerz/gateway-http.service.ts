import { BadGatewayException, Injectable } from '@nestjs/common';

@Injectable()
export class GatewayHttpService {
  async json(
    url: URL,
    form?: URLSearchParams,
    signal?: AbortSignal,
  ): Promise<unknown> {
    // Never propagate fetch errors: their URLs can contain merchant credentials.
    try {
      const response = await fetch(url, {
        method: form ? 'POST' : 'GET',
        ...(form
          ? {
              body: form,
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            }
          : {}),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(10_000)])
          : AbortSignal.timeout(10_000),
        redirect: 'error',
      });
      if (!response.ok || !response.body)
        throw new Error('Invalid gateway response');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 128_000) throw new Error('Oversized gateway response');
          chunks.push(value);
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch {
      throw new BadGatewayException(
        'Payment gateway unavailable or returned an invalid response',
      );
    }
  }
}
