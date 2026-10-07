import { z } from 'zod';

export const feedbackSchema = z.strictObject({
  rating: z.number().int().min(1).max(5),
  comment: z
    .string()
    .trim()
    .min(1)
    .max(1000)
    .refine(
      // oxlint-disable-next-line no-control-regex -- Reject database NUL and unsafe controls while permitting normal line breaks/tabs.
      (value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value),
      'Comment contains unsupported control characters',
    )
    .optional(),
});
export type FeedbackInput = z.infer<typeof feedbackSchema>;
