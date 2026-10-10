import { z } from 'zod';

// Restrict the delivery origin; actual attachment also requires a verified owned upload.
export const imageUrlSchema = z
  .url()
  .max(2048)
  .refine((value) => {
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.hostname === 'res.cloudinary.com' &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      /^\/[a-zA-Z0-9_-]+\/image\/upload\/v\d+\/fieldops\//.test(url.pathname)
    );
  }, 'Use an image uploaded through FieldOps');
