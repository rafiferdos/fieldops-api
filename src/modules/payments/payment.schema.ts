import { z } from 'zod';
export const idempotencyKeySchema = z
  .string()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._:-]{15,99}$/,
    'Idempotency-Key must contain 16–100 safe ASCII characters',
  );
export const paymentSessionSchema = z.strictObject({
  billing: z.strictObject({
    address: z.string().trim().min(5).max(50),
    city: z.string().trim().min(2).max(50),
    postcode: z.string().trim().min(1).max(30),
  }),
});
export type PaymentSessionInput = z.infer<typeof paymentSessionSchema>;
// SSLCommerz can add form fields. Only these identifiers influence verification; no callback price/status is trusted.
export const callbackSchema = z.object({
  tran_id: z.string().regex(/^[a-f0-9]{24}$/),
  val_id: z.string().min(1).max(50).optional(),
});
export type PaymentCallback = z.infer<typeof callbackSchema>;
export const browserCallbackKindSchema = z.enum(['success', 'fail', 'cancel']);
export type BrowserCallbackKind = z.infer<typeof browserCallbackKindSchema>;
