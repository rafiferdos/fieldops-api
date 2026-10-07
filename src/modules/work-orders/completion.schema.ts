import { z } from 'zod';
import { versionSchema } from '../../common/validation/version.schema.js';

export const completionSchema = z.strictObject({
  version: versionSchema,
  report: z.string().trim().min(10).max(2000),
});
export type CompletionInput = z.output<typeof completionSchema>;
