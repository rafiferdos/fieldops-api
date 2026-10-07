import {
  Catch,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  constructor(
    @Inject(HttpAdapterHost) private readonly adapter: HttpAdapterHost,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const parserErrors: Readonly<
      Record<string, { status: number; message: string }>
    > = {
      'entity.too.large': { status: 413, message: 'Request body too large' },
      'parameters.too.many': {
        status: 413,
        message: 'Too many form parameters',
      },
      'charset.unsupported': {
        status: 415,
        message: 'Unsupported request charset',
      },
      'encoding.unsupported': {
        status: 415,
        message: 'Unsupported request encoding',
      },
      'request.aborted': {
        status: 400,
        message: 'Request body was interrupted',
      },
      'request.size.invalid': {
        status: 400,
        message: 'Invalid request body length',
      },
    };
    const parserError =
      exception instanceof Error &&
      'type' in exception &&
      typeof exception.type === 'string' &&
      Object.hasOwn(parserErrors, exception.type) &&
      'status' in exception
        ? parserErrors[exception.type]
        : undefined;
    const safeParserError =
      parserError &&
      'status' in (exception as Error) &&
      parserError.status === (exception as Error & { status: unknown }).status
        ? parserError
        : undefined;
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : (safeParserError?.status ?? HttpStatus.INTERNAL_SERVER_ERROR);
    let message = 'Internal server error';
    let errors: string[] = [];

    if (exception instanceof HttpException && status < 500) {
      const response = exception.getResponse();
      const detail: unknown =
        typeof response === 'string'
          ? response
          : (response as { message?: unknown }).message;

      if (typeof detail === 'string') {
        // Nest maps parser SyntaxError/URIError into a string BadRequestException; never echo their input snippets.
        message =
          status === HttpStatus.BAD_REQUEST ? 'Invalid request' : detail;
      } else if (Array.isArray(detail)) {
        message = 'Request validation failed';
        errors = detail.filter(
          (item): item is string => typeof item === 'string',
        );
      } else {
        message = exception.message;
      }
    } else if (safeParserError) {
      message = safeParserError.message;
    } else if (status === HttpStatus.BAD_GATEWAY) {
      message = 'Payment gateway unavailable or verification failed';
    } else if (status === HttpStatus.SERVICE_UNAVAILABLE) {
      message = 'Service unavailable';
    }

    if (status >= 500) {
      this.logger.error(
        exception instanceof Error ? exception.stack : 'Unknown server error',
      );
    }

    this.adapter.httpAdapter.reply(
      context.getResponse(),
      {
        success: false,
        message,
        errors,
      },
      status,
    );
  }
}
