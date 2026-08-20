import { OtpService } from './otp.service';

describe('OtpService', () => {
  const create = jest.fn();
  const updateMany = jest.fn();
  const update = jest.fn();
  const findFirst = jest.fn();
  const emailChangeCreate = jest.fn();
  const emailChangeUpdateMany = jest.fn();
  const transaction = jest.fn(async (ops: unknown[]) => ops);

  const prisma = {
    $transaction: transaction,
    passwordResetOtp: {
      create,
      updateMany,
      update,
      findFirst,
    },
    emailChangeOtp: {
      create: emailChangeCreate,
      updateMany: emailChangeUpdateMany,
      update: jest.fn(),
      findFirst: jest.fn(),
    },
  };

  const service = new OtpService(prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();
    create.mockResolvedValue({});
    updateMany.mockResolvedValue({ count: 1 });
    emailChangeCreate.mockResolvedValue({});
    emailChangeUpdateMany.mockResolvedValue({ count: 1 });
    transaction.mockImplementation(async (ops: unknown[]) => ops);
  });

  it('stores a hashed CSPRNG OTP without logging the code as an argument to prisma', async () => {
    const otp = await service.generateAndStore('User@Example.com');

    expect(otp).toMatch(/^\d{6}$/);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ email: 'user@example.com' }),
      }),
    );
    const created = create.mock.calls[0][0].data;
    expect(created.otpHash).not.toBe(otp);
    expect(created.otpHash).toMatch(/^\$2[aby]/);
  });

  it('rejects consumed or over-attempted codes', async () => {
    findFirst.mockResolvedValue(null);
    await expect(service.verify('user@example.com', '123456')).resolves.toBe(
      false,
    );
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          attempts: { lt: 5 },
          consumedAt: null,
        }),
      }),
    );
  });

  it('stores a hashed email-change OTP for the user without logging the code', async () => {
    const otp = await service.generateEmailChange(
      '11111111-1111-4111-a111-111111111111',
      'New@Example.com',
    );

    expect(otp).toMatch(/^\d{6}$/);
    expect(emailChangeCreate).toHaveBeenCalled();
    const created = emailChangeCreate.mock.calls[0][0].data;
    expect(created.newEmail).toBe('new@example.com');
    expect(created.otpHash).not.toBe(otp);
    expect(created.otpHash).toMatch(/^\$2[aby]/);
  });
});
