import { auditMetadata } from './audit-metadata.js';

describe('Audit metadata disclosure policy', () => {
  it('fails closed for unknown actions, nested payloads and unknown fields', () => {
    expect(auditMetadata('UNRECOGNIZED', { password: 'secret' })).toEqual({});
    expect(
      auditMetadata('PAYMENT_SETTLED', {
        invoiceId: { password: 'secret' },
        receiptId: 'receipt',
        amountMinor: 150000,
        currency: 'BDT',
        checkoutUrl: 'secret',
      }),
    ).toEqual({ receiptId: 'receipt', amountMinor: 150000, currency: 'BDT' });
    expect(
      auditMetadata('USER_PROFILE_UPDATED', {
        updatedFields: ['name'],
        passwordHash: 'secret',
      }),
    ).toEqual({ updatedFields: ['name'] });
  });
});
