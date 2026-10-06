import {
  BadRequestException,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
  type ArgumentsHost,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { HttpExceptionFilter } from './http-exception.filter.js';

describe('HttpExceptionFilter', () => {
  const reply = vi.fn();
  const response = {};
  const adapter = { httpAdapter: { reply } } as unknown as HttpAdapterHost;
  const host = {
    switchToHttp: () => ({ getResponse: () => response }),
  } as ArgumentsHost;

  beforeEach(() => {
    reply.mockReset();
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  it.each([
    [new BadRequestException('Invalid input'), 400, 'Invalid input', []],
    [
      new BadRequestException(['Email is invalid']),
      400,
      'Request validation failed',
      ['Email is invalid'],
    ],
    [
      new InternalServerErrorException('Private database detail'),
      500,
      'Internal server error',
      [],
    ],
    [new Error('Private credentials'), 500, 'Internal server error', []],
    [
      new ServiceUnavailableException('Private database detail'),
      503,
      'Service unavailable',
      [],
    ],
  ])(
    'preserves status and returns a safe error envelope for %s',
    (exception, status, message, errors) => {
      new HttpExceptionFilter(adapter).catch(exception, host);

      expect(reply).toHaveBeenCalledWith(
        response,
        { success: false, message, errors },
        status,
      );
    },
  );
});
