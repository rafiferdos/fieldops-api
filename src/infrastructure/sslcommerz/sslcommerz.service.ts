import {
  BadGatewayException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { GatewayHttpService } from './gateway-http.service.js';
import { formatGatewayAmount, parseGatewayAmount } from './money.js';
import type {
  CheckoutInput,
  CheckoutResult,
  GatewayIdentity,
  GatewayObservation,
  GatewayReference,
  VerifiedCharge,
} from './sslcommerz.types.js';

const identifier = z.string().max(80);
const transaction = z.object({
  status: z.string().min(1).max(30),
  tran_id: z.string().max(30).optional(),
  val_id: z.string().max(50).optional(),
  bank_tran_id: identifier.optional(),
  amount: z.string().max(30).optional(),
  currency: z.string().max(3).optional(),
  currency_amount: z.string().max(30).optional(),
  currency_type: z.string().max(3).optional(),
  risk_level: z
    .union([z.literal('0'), z.literal('1'), z.literal(0), z.literal(1)])
    .optional(),
  APIConnect: z.string().optional(),
  sessionkey: z.string().max(50).optional(),
});
function invalid(): never {
  throw new BadGatewayException('Payment gateway returned an invalid response');
}
function parsed<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  return result.success ? result.data : invalid();
}

@Injectable()
export class SslCommerzService {
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(GatewayHttpService) private readonly http: GatewayHttpService,
  ) {}

  identity(): GatewayIdentity {
    const store = this.config.get<string>('SSLCOMMERZ_STORE_ID');
    if (!store)
      throw new ServiceUnavailableException(
        'Payment gateway is not configured',
      );
    return {
      gatewayStoreId: store,
      gatewayMode:
        this.config.getOrThrow<string>('SSLCOMMERZ_MODE') === 'live'
          ? 'LIVE'
          : 'SANDBOX',
    };
  }
  private credentials(identity: GatewayIdentity) {
    const configured = this.identity();
    if (
      configured.gatewayMode !== identity.gatewayMode ||
      configured.gatewayStoreId !== identity.gatewayStoreId
    )
      throw new ServiceUnavailableException(
        'Payment gateway configuration does not match this attempt',
      );
    return {
      store_id: configured.gatewayStoreId,
      store_passwd: this.config.getOrThrow<string>('SSLCOMMERZ_STORE_PASSWORD'),
    };
  }
  private base(identity: GatewayIdentity) {
    return identity.gatewayMode === 'LIVE'
      ? 'https://securepay.sslcommerz.com'
      : 'https://sandbox.sslcommerz.com';
  }
  private async query(
    identity: GatewayIdentity,
    path: string,
    parameters: Record<string, string>,
    signal?: AbortSignal,
  ) {
    const url = new URL(path, this.base(identity));
    url.search = new URLSearchParams({
      ...this.credentials(identity),
      ...parameters,
      format: 'json',
    }).toString();
    return this.http.json(url, undefined, signal);
  }
  async initiate(input: CheckoutInput): Promise<CheckoutResult> {
    const callback = `${this.config.getOrThrow<string>('PUBLIC_API_URL')}/api/v1/payments/sslcommerz`;
    const form = new URLSearchParams({
      ...this.credentials(input),
      total_amount: formatGatewayAmount(input.amountMinor),
      currency: 'BDT',
      tran_id: input.merchantTranId,
      success_url: `${callback}/return/success`,
      fail_url: `${callback}/return/fail`,
      cancel_url: `${callback}/return/cancel`,
      ipn_url: `${callback}/ipn`,
      cus_name: input.customer.name,
      cus_email: input.customer.email,
      cus_phone: input.customer.phone,
      cus_add1: input.customer.address,
      cus_city: input.customer.city,
      cus_postcode: input.customer.postcode,
      cus_country: 'Bangladesh',
      shipping_method: 'NO',
      product_name: 'Field service invoice',
      product_category: 'Field services',
      product_profile: 'non-physical-goods',
      emi_option: '0',
    });
    const result = parsed(
      z.object({
        status: z.string(),
        sessionkey: z.string().min(1).max(50).optional(),
        GatewayPageURL: z.string().max(255).optional(),
      }),
      await this.http.json(
        new URL('/gwprocess/v4/api.php', this.base(input)),
        form,
      ),
    );
    if (result.status === 'FAILED') return { kind: 'rejected' };
    if (
      result.status !== 'SUCCESS' ||
      !result.sessionkey ||
      !result.GatewayPageURL
    )
      invalid();
    let checkout: URL;
    try {
      checkout = new URL(result.GatewayPageURL);
    } catch {
      return invalid();
    }
    if (
      checkout.origin !== this.base(input) ||
      checkout.username ||
      checkout.password
    )
      invalid();
    return {
      kind: 'ready',
      sessionKey: result.sessionkey,
      checkoutUrl: checkout.toString(),
    };
  }
  async validate(
    identity: GatewayIdentity,
    validationId: string,
    signal?: AbortSignal,
  ): Promise<VerifiedCharge> {
    const row = parsed(
      transaction,
      await this.query(
        identity,
        '/validator/api/validationserverAPI.php',
        {
          val_id: validationId,
        },
        signal,
      ),
    );
    if (
      !['VALID', 'VALIDATED'].includes(row.status) ||
      row.APIConnect !== 'DONE' ||
      row.val_id !== validationId ||
      !row.tran_id ||
      !row.bank_tran_id ||
      row.risk_level === undefined
    )
      invalid();
    const amount = parseGatewayAmount(row.amount);
    const original = parseGatewayAmount(row.currency_amount);
    if (
      amount === null ||
      original === null ||
      !row.currency ||
      !row.currency_type
    )
      invalid();
    return {
      merchantTranId: row.tran_id,
      providerTranId: row.bank_tran_id,
      validationId,
      amountMinor: amount,
      currency: row.currency,
      originalAmountMinor: original,
      originalCurrency: row.currency_type,
      risky: row.risk_level === '1' || row.risk_level === 1,
    };
  }
  async lookup(reference: GatewayReference): Promise<GatewayObservation> {
    const signal = AbortSignal.timeout(20_000);
    const response = parsed(
      z.object({
        APIConnect: z.literal('DONE'),
        no_of_trans_found: z.coerce.number().int().min(0).max(50),
        element: z.array(transaction).max(50).optional(),
      }),
      await this.query(
        reference,
        '/validator/api/merchantTransIDvalidationAPI.php',
        { tran_id: reference.merchantTranId },
        signal,
      ),
    );
    const rows = response.element ?? [];
    if (
      response.no_of_trans_found !== rows.length ||
      rows.some((row) => row.tran_id !== reference.merchantTranId)
    )
      invalid();
    const validationIds = [
      ...new Set(
        rows
          .filter((row) => ['VALID', 'VALIDATED'].includes(row.status))
          .map((row) => row.val_id),
      ),
    ];
    if (validationIds.some((id) => !id) || validationIds.length > 10) invalid();
    const charges: VerifiedCharge[] = [];
    for (const id of validationIds) {
      const charge = await this.validate(reference, id!, signal);
      if (charge.merchantTranId !== reference.merchantTranId) invalid();
      charges.push(charge);
    }
    if (charges.length || !reference.sessionKey)
      return { charges, terminal: null };
    // An individual failed bank attempt does not prove that the hosted checkout is closed.
    const session = parsed(
      transaction,
      await this.query(
        reference,
        '/validator/api/merchantTransIDvalidationAPI.php',
        { sessionkey: reference.sessionKey },
        signal,
      ),
    );
    if (
      session.APIConnect !== 'DONE' ||
      session.tran_id !== reference.merchantTranId ||
      session.sessionkey !== reference.sessionKey
    )
      invalid();
    if (['VALID', 'VALIDATED'].includes(session.status)) {
      if (!session.val_id) invalid();
      const charge = await this.validate(reference, session.val_id, signal);
      if (charge.merchantTranId !== reference.merchantTranId) invalid();
      return { charges: [charge], terminal: null };
    }
    if (
      ['FAILED', 'CANCEL', 'CANCELLED'].includes(session.status) &&
      (session.currency === undefined || session.currency === 'BDT') &&
      parseGatewayAmount(session.amount) === reference.amountMinor &&
      session.currency_type === 'BDT' &&
      parseGatewayAmount(session.currency_amount) === reference.amountMinor
    ) {
      // Session queries omit settlement currency even in the official response example.
      // BDT original currency and equal gross/original amounts still bind the closed session.
      // The sandbox reports cancellation as session FAILED plus merchant CANCELLED;
      // merchant evidence alone must never release a checkout that is still open.
      const cancelled =
        session.status === 'CANCEL' ||
        session.status === 'CANCELLED' ||
        (rows.length > 0 &&
          rows.every(
            (row) =>
              ['CANCEL', 'CANCELLED'].includes(row.status) &&
              row.currency === 'BDT' &&
              row.currency_type === 'BDT' &&
              parseGatewayAmount(row.amount) === reference.amountMinor &&
              parseGatewayAmount(row.currency_amount) === reference.amountMinor,
          ));
      return {
        charges: [],
        terminal: cancelled ? 'CANCELLED' : 'FAILED',
      };
    }
    return { charges: [], terminal: null };
  }
}
