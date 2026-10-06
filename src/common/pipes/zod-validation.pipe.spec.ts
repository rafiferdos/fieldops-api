import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe.js';

describe('ZodValidationPipe', () => {
  it('returns transformed query values and schema defaults', async () => {
    const pipe = new ZodValidationPipe(
      z.strictObject({
        page: z.coerce.number().int().positive().default(1),
        search: z.string().trim().optional(),
      }),
    );

    await expect(
      pipe.transform({ page: '2', search: '  repair  ' }),
    ).resolves.toEqual({ page: 2, search: 'repair' });
    await expect(pipe.transform({})).resolves.toEqual({ page: 1 });
  });

  it('validates a single route parameter', async () => {
    const pipe = new ZodValidationPipe(z.uuid());
    await expect(pipe.transform('invalid-id')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('supports asynchronous refinements', async () => {
    const pipe = new ZodValidationPipe(
      z.string().refine(async (value) => value === 'allowed'),
    );
    await expect(pipe.transform('allowed')).resolves.toBe('allowed');
    await expect(pipe.transform('denied')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects unknown body fields instead of silently dropping them', async () => {
    const pipe = new ZodValidationPipe(z.strictObject({ name: z.string() }));
    await expect(
      pipe.transform({ name: 'Rafi', role: 'ADMIN' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('provides field errors without including the rejected input value', async () => {
    const pipe = new ZodValidationPipe(
      z.strictObject({ password: z.string().min(15) }),
    );
    try {
      await pipe.transform({ password: 'secret-value' });
      expect.fail('Invalid input must throw');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const response = (error as BadRequestException).getResponse();
      expect(response).toMatchObject({
        statusCode: 400,
        message: [expect.stringContaining('password:')],
      });
      expect(JSON.stringify(response)).not.toContain('secret-value');
    }
  });
});
