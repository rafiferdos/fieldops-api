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
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let errors: string[] = [];

    if (exception instanceof HttpException && status < 500) {
      const response = exception.getResponse();
      const detail: unknown =
        typeof response === 'string'
          ? response
          : (response as { message?: unknown }).message;

      if (typeof detail === 'string') {
        message = detail;
      } else if (Array.isArray(detail)) {
        message = 'Request validation failed';
        errors = detail.filter(
          (item): item is string => typeof item === 'string',
        );
      } else {
        message = exception.message;
      }
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
