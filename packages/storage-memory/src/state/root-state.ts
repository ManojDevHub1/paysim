import type { MockOrder, MockPayment, CanonicalEvent } from '@paysim/domain';
import type {
  WebhookEndpointEntity,
  WebhookDeliveryEntity,
  CheckoutSessionEntity,
} from '@paysim/contracts';
import type { StoredIdempotencyRecord } from '../idempotency.js';
import { ReadonlyStateMap } from './readonly-map.js';

/**
 * Capacity limits defined in PRD v2.3.0 Section 14 and Phase 02.6 audit.
 */
export const MEMORY_BOUNDS = Object.freeze({
  MAX_ORDERS: 2000,
  MAX_PAYMENTS: 3000,
  MAX_SESSIONS: 3000,
  MAX_EVENTS: 2000,
  MAX_DELIVERIES: 5000,
  MAX_IDEMPOTENCY_KEYS: 5000,
  MAX_QUEUE: 100,
  MAX_WORKERS: 5,
  MAX_SECRET_VERSIONS: 5,
  PENDING_ATTEMPT_TIMEOUT_MS: 30 * 60 * 1000, // 30 minutes
  CAPABILITY_TOKEN_TTL_MS: 15 * 60 * 1000,    // 15 minutes
});

/**
 * Retention and capacity counter tracking.
 */
export interface RetentionState {
  readonly activeSecretVersions: number;
  readonly reservedEventSlots: number;
  readonly reservedDeliverySlots: number;
}

/**
 * Monolithic immutable root state container representing all stateful entities in PAYSIM.
 * Follows ADR-003 and Phase 02.6 single pointer swap architecture.
 */
export interface RootState {
  readonly orders: ReadonlyMap<string, Readonly<MockOrder>>;
  readonly payments: ReadonlyMap<string, Readonly<MockPayment>>;
  readonly sessions: ReadonlyMap<string, Readonly<CheckoutSessionEntity>>;
  readonly events: ReadonlyMap<string, Readonly<CanonicalEvent>>;
  readonly endpoints: ReadonlyMap<string, Readonly<WebhookEndpointEntity>>;
  readonly deliveries: ReadonlyMap<string, Readonly<WebhookDeliveryEntity>>;
  readonly idempotency: ReadonlyMap<string, Readonly<StoredIdempotencyRecord>>;
  readonly retention: Readonly<RetentionState>;
  readonly nextGlobalSeq: bigint;
  readonly version: bigint;
}

/**
 * Factory for creating an empty, immutable initial RootState.
 */
export function createInitialRootState(): RootState {
  return Object.freeze({
    orders: new ReadonlyStateMap<string, Readonly<MockOrder>>(),
    payments: new ReadonlyStateMap<string, Readonly<MockPayment>>(),
    sessions: new ReadonlyStateMap<string, Readonly<CheckoutSessionEntity>>(),
    events: new ReadonlyStateMap<string, Readonly<CanonicalEvent>>(),
    endpoints: new ReadonlyStateMap<string, Readonly<WebhookEndpointEntity>>(),
    deliveries: new ReadonlyStateMap<string, Readonly<WebhookDeliveryEntity>>(),
    idempotency: new ReadonlyStateMap<string, Readonly<StoredIdempotencyRecord>>(),
    retention: Object.freeze({
      activeSecretVersions: 1,
      reservedEventSlots: 0,
      reservedDeliverySlots: 0,
    }),
    nextGlobalSeq: 1n,
    version: 0n,
  });
}

/**
 * In-process state holder managing single atomic pointer swaps.
 * Strictly non-throwing and synchronous in the Node.js event loop.
 */
export class RootStateHolder {
  private currentRootState: RootState;

  constructor(initialState?: RootState) {
    this.currentRootState = initialState ?? createInitialRootState();
  }

  /**
   * Returns the current immutable snapshot.
   */
  public getState(): Readonly<RootState> {
    return this.currentRootState;
  }

  /**
   * Executes a synchronous, non-throwing atomic reference swap.
   */
  public commit(candidateState: RootState): void {
    this.currentRootState = candidateState;
  }
}
