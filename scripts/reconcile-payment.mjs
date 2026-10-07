import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../dist/app.module.js';
import { PaymentSettlementService } from '../dist/modules/payments/payment-settlement.service.js';

const id = process.argv[2];
if (
  process.argv.length !== 3 ||
  !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
    id ?? '',
  )
) {
  console.error('Usage: npm run payment:reconcile -- <payment UUID>');
  process.exitCode = 1;
} else {
  let app;
  try {
    app = await NestFactory.createApplicationContext(AppModule, {
      logger: false,
    });
    const result = await app
      .get(PaymentSettlementService)
      .reconcile(id.toLowerCase());
    console.log(
      JSON.stringify({
        paymentId: result.id,
        status: result.status,
        requiresReview: result.requiresReview,
      }),
    );
  } catch {
    console.error(
      'Reconciliation failed. Check gateway configuration/connectivity and retry the same payment; do not create a replacement for an unresolved attempt.',
    );
    process.exitCode = 1;
  } finally {
    await app?.close();
  }
}
