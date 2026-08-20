import { BadRequestException, HttpStatus } from '@nestjs/common';

import { AllExceptionsFilter } from './all-exceptions.filter';

describe('AllExceptionsFilter', () => {
  const send = jest.fn();
  const status = jest.fn().mockReturnValue({ send });
  const reply = { status };
  const request = { method: 'GET', url: '/api/v2/health' };
  const host = {
    switchToHttp: () => ({
      getResponse: () => reply,
      getRequest: () => request,
    }),
  };

  beforeEach(() => {
    send.mockReset();
    status.mockClear();
  });

  it('forwards HttpException payloads unchanged', () => {
    const filter = new AllExceptionsFilter();
    filter.catch(new BadRequestException('Nope'), host as never);

    expect(status).toHaveBeenCalledWith(400);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Nope' }),
    );
  });

  it('hides unexpected error details in production', () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const filter = new AllExceptionsFilter();

    try {
      filter.catch(new Error('secret stack'), host as never);
      expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(send).toHaveBeenCalledWith({
        statusCode: 500,
        message: 'Internal server error',
      });
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});
