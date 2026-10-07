import { z } from 'zod';

export const uuidSchema = z.uuid().transform((value) => value.toLowerCase());
