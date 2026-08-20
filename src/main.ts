import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from '@fastify/helmet';

import { AppModule } from './app.module';
import { HealthService } from './modules/health/health.service';
import { registerDirectoryAssets } from './modules/media-storage/register-directory-assets';
import { registerLocalMedia } from './modules/media-storage/register-local-media';
import { enrichOpenApiDocument } from './openapi-document';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: true, bodyLimit: 16 * 1024 * 1024 }),
  );

  const config = app.get(ConfigService);
  const apiPrefix = config.getOrThrow<string>('API_PREFIX');
  const apiVersion = config.getOrThrow<string>('API_VERSION');
  const port = config.getOrThrow<number>('PORT');
  const corsOrigins = config.getOrThrow<string[]>('CORS_ORIGINS');

  await app.register(helmet, {
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    // API primarily serves JSON; HTML MPGS checkout needs Mastercard Checkout.js + inline bootstrap.
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          'https://test-cbq.mtf.gateway.mastercard.com',
          'https://cbq.gateway.mastercard.com',
          'https://test-gateway.mastercard.com',
          'https://ap-gateway.mastercard.com',
          'https://eu-gateway.mastercard.com',
          'https://na-gateway.mastercard.com',
        ],
        frameSrc: [
          "'self'",
          'https://test-cbq.mtf.gateway.mastercard.com',
          'https://cbq.gateway.mastercard.com',
          'https://test-gateway.mastercard.com',
          'https://ap-gateway.mastercard.com',
          'https://eu-gateway.mastercard.com',
          'https://na-gateway.mastercard.com',
        ],
        connectSrc: [
          "'self'",
          'https://test-cbq.mtf.gateway.mastercard.com',
          'https://cbq.gateway.mastercard.com',
          'https://test-gateway.mastercard.com',
          'https://ap-gateway.mastercard.com',
          'https://eu-gateway.mastercard.com',
          'https://na-gateway.mastercard.com',
        ],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        formAction: ["'self'", 'https:'],
      },
    },
  });
  await registerLocalMedia(app);

  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.setGlobalPrefix(`${apiPrefix}/${apiVersion}`, {
    exclude: ['docs'],
  });

  const enableSwagger =
    config.get<string>('NODE_ENV') !== 'production' ||
    config.get<string>('ENABLE_SWAGGER') === 'true';
  if (enableSwagger) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('BookingQube Backend')
      .setDescription(
        'BookingQube customer, administrator, organizer, checkout, and reporting API. ' +
          'Use the matching login endpoint to obtain a JWT, then select Authorize for protected routes.',
      )
      .setVersion('0.1.0')
      .addServer(config.getOrThrow<string>('BACKEND_PUBLIC_URL'), 'Configured backend')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter an access token returned by a customer, administrator, or organizer login.',
        },
        'bearer',
      )
      .build();
    const document = enrichOpenApiDocument(
      SwaggerModule.createDocument(app, swaggerConfig),
    );
    const httpAdapter = app.getHttpAdapter();
    httpAdapter.useStaticAssets = ((options: { root: string; prefix: string }) => {
      registerDirectoryAssets(app, {
        root: options.root,
        prefix: options.prefix,
      });
      return httpAdapter;
    }) as typeof httpAdapter.useStaticAssets;
    SwaggerModule.setup('docs', app, document);
  }

  const healthService = app.get(HealthService);
  app
    .getHttpAdapter()
    .getInstance()
    .get('/health', async (_request, reply) => {
      return reply.send(await healthService.getHealth());
    });

  await app.listen(port, '0.0.0.0');
}

void bootstrap();
