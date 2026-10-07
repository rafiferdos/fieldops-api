import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { databaseErrorCode, serializable } from './serializable.js';

const prismaError = (code: string, sqlstate?: string) =>
  new Prisma.PrismaClientKnownRequestError('Fixture database failure', {
    code,
    clientVersion: '7.10.0',
    ...(sqlstate
      ? { meta: { driverAdapterError: { cause: { originalCode: sqlstate } } } }
      : {}),
  });
const fixture = () => {
  const transaction = vi.fn();
  return {
    transaction,
    prisma: { $transaction: transaction } as unknown as PrismaService,
  };
};
const directAdapterConflict = (sqlstate: string) => {
  const error = new Error('Fixture commit conflict', {
    cause: { originalCode: sqlstate, kind: 'TransactionWriteConflict' },
  });
  error.name = 'DriverAdapterError';
  return error;
};
describe('Serializable transaction retry', () => {
  it.each([
    prismaError('P2034'),
    prismaError('P2039', '40001'),
    prismaError('P2039', '40P01'),
    directAdapterConflict('40001'),
    directAdapterConflict('40P01'),
  ])(
    'retries recognized DB conflicts and returns the committed result',
    async (error) => {
      const { prisma, transaction } = fixture();
      transaction
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce('committed');
      expect(await serializable(prisma, async () => 'unused')).toBe(
        'committed',
      );
      expect(transaction).toHaveBeenCalledTimes(2);
      expect(transaction.mock.calls[0]?.[1]).toMatchObject({
        isolationLevel: 'Serializable',
      });
    },
  );
  it('bounds retries and reports a retryable HTTP failure', async () => {
    const { prisma, transaction } = fixture();
    transaction.mockRejectedValue(prismaError('P2034'));
    await expect(
      serializable(prisma, async () => undefined),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(transaction).toHaveBeenCalledTimes(4);
  });
  it.each([
    new ConflictException('Policy conflict'),
    new Error('Network failure'),
    prismaError('P2002'),
    prismaError('P2039', '23P01'),
  ])(
    'does not retry policy, overlap, uniqueness or unknown failures',
    async (error) => {
      const { prisma, transaction } = fixture();
      transaction.mockRejectedValue(error);
      await expect(serializable(prisma, async () => undefined)).rejects.toBe(
        error,
      );
      expect(transaction).toHaveBeenCalledTimes(1);
    },
  );
  it('reads SQLSTATE only from a recognized Prisma adapter error', () => {
    expect(databaseErrorCode(prismaError('P2039', '23P01'))).toBe('23P01');
    for (const error of [
      undefined,
      {},
      new Error('23P01'),
      { meta: { driverAdapterError: { cause: { originalCode: '23P01' } } } },
      prismaError('P2002'),
    ])
      expect(databaseErrorCode(error)).toBeUndefined();
  });
});
