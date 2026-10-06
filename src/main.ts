import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';

import { AppModule } from './app.module.js';
import { configureApp } from './config/app.config.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  configureApp(app);
  app.enableShutdownHooks();

  await app.listen(config.getOrThrow<number>('PORT'));
}

await bootstrap();
