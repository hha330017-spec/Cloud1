import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { loadConfig } from './config/configuration';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  // rawBody:true preserves the exact bytes of incoming requests so payment
  // webhook signatures can be verified against the unparsed payload.
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });

  app.enableShutdownHooks(); // triggers OnModuleDestroy -> closes pools cleanly
  app.setGlobalPrefix('v1', { exclude: ['health', 'webhooks/(.*)'] });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  app.enableCors({ origin: config.corsOrigins, credentials: true });

  await app.listen(config.port);
  Logger.log(`API listening on :${config.port}`, 'Bootstrap');
}

void bootstrap();
