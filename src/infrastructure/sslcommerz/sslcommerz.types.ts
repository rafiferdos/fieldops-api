import type { GatewayMode } from '../../generated/prisma/enums.js';
export type GatewayIdentity = {
  gatewayMode: GatewayMode;
  gatewayStoreId: string;
};
export type GatewayReference = GatewayIdentity & {
  merchantTranId: string;
  sessionKey: string | null;
};
export type CheckoutInput = GatewayIdentity & {
  merchantTranId: string;
  amountMinor: number;
  customer: {
    name: string;
    email: string;
    phone: string;
    address: string;
    city: string;
    postcode: string;
  };
};
export type VerifiedCharge = {
  merchantTranId: string;
  providerTranId: string;
  validationId: string;
  amountMinor: number;
  currency: string;
  originalAmountMinor: number;
  originalCurrency: string;
  risky: boolean;
};
export type GatewayObservation = {
  charges: VerifiedCharge[];
  terminal: 'FAILED' | 'CANCELLED' | null;
};
export type CheckoutResult =
  | { kind: 'ready'; sessionKey: string; checkoutUrl: string }
  | { kind: 'rejected' };
