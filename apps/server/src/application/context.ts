import {
  RootStateHolder,
  CommitCoordinator,
  LockManager,
  WebhookSecretVault,
  IdempotencyStore,
} from '@paysim/storage-memory';
import { OrderService } from './services/order.service.js';
import { PaymentService } from './services/payment.service.js';
import { CheckoutService } from './services/checkout.service.js';
import { ControlService } from './services/control.service.js';
import { WebhookService } from './services/webhook.service.js';

export interface ApplicationContextOptions {
  readonly stateHolder?: RootStateHolder;
  readonly lockManager?: LockManager;
  readonly secretVault?: WebhookSecretVault;
  readonly idempotencyStore?: IdempotencyStore;
  readonly baseUrl?: string;
}

export interface ApplicationContext {
  readonly stateHolder: RootStateHolder;
  readonly coordinator: CommitCoordinator;
  readonly lockManager: LockManager;
  readonly secretVault: WebhookSecretVault;
  readonly idempotencyStore: IdempotencyStore;
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
  const idempotencyStore = options.idempotencyStore ?? new IdempotencyStore();

  const coordinator = new CommitCoordinator(stateHolder, lockManager);

  const orders = new OrderService(coordinator);
  const payments = new PaymentService(coordinator);
  const checkout = new CheckoutService(coordinator, options.baseUrl);
  const control = new ControlService(coordinator);
  const webhooks = new WebhookService(coordinator, secretVault);

  return {
    stateHolder,
    coordinator,
    lockManager,
    secretVault,
    idempotencyStore,
    orders,
    payments,
    checkout,
    control,
    webhooks,
  };
}
