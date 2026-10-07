import { z } from 'zod';
export const versionSchema = z.number().int().min(1).max(2147483646);
