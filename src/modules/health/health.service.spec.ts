import { HealthService } from './health.service';

describe('HealthService', () => {
  const prisma = { $queryRaw: jest.fn() };
  const redis = { ping: jest.fn() };
  const config = { get: jest.fn() };

  beforeEach(() => {
    prisma.$queryRaw.mockReset();
    redis.ping.mockReset();
    config.get.mockReset();
  });

  it('omits infrastructure checks from the public probe', async () => {
    const service = new HealthService(
      prisma as never,
      redis as never,
      config as never,
    );

    const body = await service.getHealth();

    expect(body).toEqual(
      expect.objectContaining({
        status: 'ok',
        service: 'bookingqube-backend',
      }),
    );
    expect(body).not.toHaveProperty('checks');
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(redis.ping).not.toHaveBeenCalled();
  });

  it('returns DB/Redis checks only with a matching probe token', async () => {
    config.get.mockImplementation((key: string) =>
      key === 'HEALTH_TOKEN' ? 'probe-secret' : undefined,
    );
    prisma.$queryRaw.mockResolvedValue(1);
    redis.ping.mockResolvedValue(true);
    const service = new HealthService(
      prisma as never,
      redis as never,
      config as never,
    );

    const body = await service.getHealth('probe-secret');

    expect('checks' in body && body.checks).toEqual({ database: true, redis: true });
    expect(prisma.$queryRaw).toHaveBeenCalled();
  });
});
