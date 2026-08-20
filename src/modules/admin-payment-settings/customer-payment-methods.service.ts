import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentGateway } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';

export type CustomerPaymentMethodDto = {
  id: number;
  name: string;
};

const GATEWAY_PAYMENT_METHODS: Record<
  PaymentGateway,
  CustomerPaymentMethodDto[]
> = {
  myfatoorah: [
    { id: 10, name: 'Apple Pay' },
    { id: 11, name: 'Google Pay' },
    { id: 12, name: 'MyFatoorah Card' },
  ],
  qpay: [{ id: 7, name: 'NAPS' }],
  mastercard: [{ id: 8, name: 'Visa/MasterCard' }],
};

const METHOD_TO_GATEWAY = new Map<number, PaymentGateway>(
  (
    Object.entries(GATEWAY_PAYMENT_METHODS) as Array<
      [PaymentGateway, CustomerPaymentMethodDto[]]
    >
  ).flatMap(([gateway, methods]) =>
    methods.map((method) => [method.id, gateway] as const),
  ),
);

@Injectable()
export class CustomerPaymentMethodsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Customer-facing V2 payment methods for gateways that are both enabled and active.
   * Free / zero-total (id 0) is never listed here — it is always allowed without a gateway.
   */
  async listEnabledPaymentMethods(): Promise<CustomerPaymentMethodDto[]> {
    const enabledGateways = await this.listEnabledGateways();
    const methods: CustomerPaymentMethodDto[] = [];

    for (const gateway of ['myfatoorah', 'qpay', 'mastercard'] as PaymentGateway[]) {
      if (!enabledGateways.has(gateway)) {
        continue;
      }
      methods.push(...GATEWAY_PAYMENT_METHODS[gateway]);
    }

    return methods;
  }

  async isGatewayEnabled(gateway: PaymentGateway): Promise<boolean> {
    const enabled = await this.listEnabledGateways();
    return enabled.has(gateway);
  }

  async isPaymentMethodAllowed(methodId: number | null | undefined): Promise<boolean> {
    if (methodId == null || methodId === 0) {
      return true;
    }

    const gateway = METHOD_TO_GATEWAY.get(methodId);
    if (!gateway) {
      // Legacy / local placeholder method IDs are not gated by admin gateways.
      return true;
    }

    return this.isGatewayEnabled(gateway);
  }

  async assertPaymentMethodAllowed(methodId: number | null | undefined): Promise<void> {
    if (methodId == null || methodId === 0) {
      return;
    }

    const gateway = METHOD_TO_GATEWAY.get(methodId);
    if (!gateway) {
      return;
    }

    if (!(await this.isGatewayEnabled(gateway))) {
      throw new BadRequestException(
        `${this.gatewayLabel(gateway)} is not enabled in Payment settings.`,
      );
    }
  }

  async assertGatewayEnabled(gateway: PaymentGateway): Promise<void> {
    if (!(await this.isGatewayEnabled(gateway))) {
      throw new BadRequestException(
        `${this.gatewayLabel(gateway)} is not enabled in Payment settings.`,
      );
    }
  }

  private async listEnabledGateways(): Promise<Set<PaymentGateway>> {
    const rows = await this.prisma.paymentGatewayConfig.findMany({
      where: {
        enabled: true,
        isActive: true,
      },
      select: { gateway: true },
    });

    const enabled = new Set(rows.map((row) => row.gateway));
    // Keep installations upgraded from the legacy backend working while their
    // MyFatoorah credential is moved into Admin → Payment Settings.
    if (this.config.get<string>('MYFATOORAH_API_KEY')?.trim()) {
      enabled.add('myfatoorah');
    }
    return enabled;
  }

  private gatewayLabel(gateway: PaymentGateway) {
    if (gateway === 'myfatoorah') return 'MyFatoorah';
    if (gateway === 'mastercard') return 'Mastercard (Visa/MasterCard)';
    return 'QPay (NAPS)';
  }
}
