import {
  RootStateHolder,
  CommitCoordinator,
  LockManager,
  WebhookSecretVault,
  DeliveryBodyVault,
  IdempotencyStore,
} from '@paysim/storage-memory';
import type { RuntimeListenerConfig } from '@paysim/contracts';
import { OrderService } from './services/order.service.js';
import { PaymentService } from './services/payment.service.js';
import { CheckoutService } from './services/checkout.service.js';
import { ControlService } from './services/control.service.js';
import { WebhookService } from './services/webhook.service.js';
import { WebhookEngine, type Clock } from '../webhook-engine/index.js';

export interface ApplicationContextOptions {
  readonly stateHolder?: RootStateHolder;
  readonly lockManager?: LockManager;
  readonly secretVault?: WebhookSecretVault;
  readonly bodyVault?: DeliveryBodyVault;
  readonly idempotencyStore?: IdempotencyStore;
  readonly engine?: WebhookEngine;
  readonly clock?: Clock;
  readonly baseUrl?: string;
  readonly runtimeConfig?: RuntimeListenerConfig;
  readonly autoStartEngine?: boolean;
}

export interface ApplicationContext {
  readonly stateHolder: RootStateHolder;
  readonly coordinator: CommitCoordinator;
  readonly lockManager: LockManager;
  readonly secretVault: WebhookSecretVault;
  readonly bodyVault: DeliveryBodyVault;
  readonly idempotencyStore: IdempotencyStore;
  readonly engine: WebhookEngine;
  readonly runtimeConfig?: RuntimeListenerConfig;
  readonly orders: OrderService;
  readonly payments: PaymentService;
  readonly checkout: CheckoutService;
  readonly control: ControlService;
  readonly webhooks: WebhookService;
}

/**
 * Creates and initializes the unified Application Service Layer context.
 * Connects pure domain state machines, RootState coordinator, in-memory repositories,
 * cryptographic vaults, idempotency store, and use case services.
 */
export function createApplicationContext(
  options: ApplicationContextOptions = {}
): ApplicationContext {
  const stateHolder = options.stateHolder ?? new RootStateHolder();
  const lockManager = options.lockManager ?? new LockManager();
  const secretVault = options.secretVault ?? new WebhookSecretVault();
  const bodyVault = options.bodyVault ?? new DeliveryBodyVault();
  const idempotencyStore = options.idempotencyStore ?? new IdempotencyStore();

  const coordinator = new CommitCoordinator(stateHolder, lockManager);

  const engine =
    options.engine ??
    new WebhookEngine({
      coordinator,
      secretVault,
      bodyVault,
      clock: options.clock,
      runtimeConfig: options.runtimeConfig,
    });

  const orders = new OrderService(coordinator);
  const payments = new PaymentService(coordinator);
  const checkout = new CheckoutService(coordinator, options.baseUrl);
  const control = new ControlService(coordinator);
  const webhooks = new WebhookService(
    coordinator,
    secretVault,
    bodyVault,
    (deliveryId, initiator) => {
      engine.cancelScheduledRetry(deliveryId);
      engine.enqueueDelivery(deliveryId, initiator);
    },
    options.runtimeConfig
  );

  if (options.autoStartEngine) {
    engine.start();
  }

  return {
    stateHolder,
    coordinator,
    lockManager,
    secretVault,
    bodyVault,
    idempotencyStore,
    engine,
    runtimeConfig: options.runtimeConfig,
    orders,
    payments,
    checkout,
    control,
    webhooks,
  };
}
