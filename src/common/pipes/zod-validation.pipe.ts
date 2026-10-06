import {
  BadRequestException,
  Injectable,
  type PipeTransform,
} from '@nestjs/common';
import { z } from 'zod';

@Injectable()
export class ZodValidationPipe<S extends z.ZodType> implements PipeTransform<
  unknown,
  Promise<z.output<S>>
> {
  constructor(private readonly schema: S) {}

  async transform(value: unknown): Promise<z.output<S>> {
    const result = await this.schema.safeParseAsync(value);

    if (!result.success) {
      throw new BadRequestException(
        result.error.issues.map((issue) => {
          const field = issue.path.map(String).join('.') || 'input';
          return `${field}: ${issue.message}`;
        }),
      );
    }

    return result.data;
  }
}
