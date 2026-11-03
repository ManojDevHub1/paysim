/**
 * Structured storage and repository error hierarchy.
 */

export class StorageError extends Error {
  public readonly code: string;

  constructor(message: string, code = 'STORAGE_ERROR') {
    super(message);
    this.name = 'StorageError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class StorageCapacityError extends StorageError {
  public readonly limit: number;
  public readonly resource: string;

  constructor(resource: string, limit: number) {
    super(
      `In-memory capacity limit reached for resource '${resource}' (limit: ${limit}). Saturated storage rejects new records to preserve memory bounds.`,
      'RESOURCE_LIMIT_REACHED'
    );
    this.name = 'StorageCapacityError';
    this.resource = resource;
    this.limit = limit;
  }
}

export class DuplicateEntityError extends StorageError {
  public readonly entityType: string;
  public readonly entityId: string;

  constructor(entityType: string, entityId: string) {
    super(
      `Entity '${entityType}' with ID '${entityId}' already exists. Duplicate insert rejected.`,
      'DUPLICATE_ENTITY'
    );
    this.name = 'DuplicateEntityError';
    this.entityType = entityType;
    this.entityId = entityId;
  }
}

export class EntityNotFoundError extends StorageError {
  public readonly entityType: string;
  public readonly entityId: string;

  constructor(entityType: string, entityId: string) {
    super(
      `Entity '${entityType}' with ID '${entityId}' not found.`,
      'ENTITY_NOT_FOUND'
    );
    this.name = 'EntityNotFoundError';
    this.entityType = entityType;
    this.entityId = entityId;
  }
}

export class ConcurrencyConflictError extends StorageError {
  public readonly entityType: string;
  public readonly entityId: string;
  public readonly currentVersion: number;
  public readonly candidateVersion: number;

  constructor(
    entityType: string,
    entityId: string,
    currentVersion: number,
    candidateVersion: number
  ) {
    super(
      `Concurrency version conflict for '${entityType}' [${entityId}]: current version is ${currentVersion}, but candidate transition provided version ${candidateVersion}. Strict monotonic versioning (v_next = v_current + 1) required.`,
      'CONCURRENCY_CONFLICT'
    );
    this.name = 'ConcurrencyConflictError';
    this.entityType = entityType;
    this.entityId = entityId;
    this.currentVersion = currentVersion;
    this.candidateVersion = candidateVersion;
  }
}

export class InvariantViolationError extends StorageError {
  public readonly invariant: string;

  constructor(invariant: string, message: string) {
    super(`State invariant violation [${invariant}]: ${message}`, 'INVARIANT_VIOLATION');
    this.name = 'InvariantViolationError';
    this.invariant = invariant;
  }
}
