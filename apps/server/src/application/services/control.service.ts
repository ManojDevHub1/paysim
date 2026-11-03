import { randomBytes } from 'node:crypto';
import {
  type RotateNativeCredentialRequest,
  type NativeCredentialResponse,
  type RotateCompatCredentialRequest,
  type CompatCredentialResponse,
  type CredentialsOverviewResponse,
  type NativeCredentialSummary,
  type CompatCredentialSummary,
  RotateNativeCredentialRequestSchema,
  RotateCompatCredentialRequestSchema,
} from '@paysim/contracts';
import { generateId } from '@paysim/shared';
import type { CommitCoordinator } from '@paysim/storage-memory';
import {
  createValidationError,
  createControlTokenInvalidError,
} from '../errors/application.error.js';

interface StoredNativeCredential {
  readonly id: string;
  readonly token: string;
  readonly prefix: 'ps_test_';
  readonly active: boolean;
  readonly createdAt: string;
}

interface StoredCompatCredential {
  readonly id: string;
  readonly keyId: string;
  readonly keySecret: string;
  readonly version: number;
  readonly active: boolean;
  readonly createdAt: string;
}

interface StoredControlSession {
  readonly sessionToken: string;
  readonly csrfToken: string;
  readonly expiresAt: string;
}

/**
 * Application Service orchestrating PAYSIM Control credentials and session management.
 * Strictly shields raw secrets and tokens from inspection/overview endpoints.
 */
export class ControlService {
  private nativeCredential: StoredNativeCredential | null = null;
  private readonly compatCredentials = new Map<string, StoredCompatCredential>();
  private activeCompatVersion = 1;

  // Active control sessions: sessionToken -> StoredControlSession
  private readonly controlSessions = new Map<string, StoredControlSession>();
  private bootstrapToken: string | null = null;
  private bootstrapTokenConsumed = false;

  constructor(private readonly coordinator: CommitCoordinator) {
    // Initialize default credentials
    const initialNativeId = 'cred_ps_default';
    const initialNativeToken = `ps_test_${randomBytes(24).toString('hex')}`;
    this.nativeCredential = {
      id: initialNativeId,
      token: initialNativeToken,
      prefix: 'ps_test_',
      active: true,
      createdAt: new Date().toISOString(),
    };

    const initialCompatId = 'cred_rzp_v1';
    const initialCompatKeyId = `rzp_test_${randomBytes(8).toString('hex')}`;
    const initialCompatSecret = randomBytes(24).toString('hex');
    this.compatCredentials.set(initialCompatId, {
      id: initialCompatId,
      keyId: initialCompatKeyId,
      keySecret: initialCompatSecret,
      version: 1,
      active: true,
      createdAt: new Date().toISOString(),
    });
  }

  /**
   * Rotates the Native API bearer token.
   * Returns one-time disclosure of the newly generated raw bearer token.
   */
  public async rotateNativeCredential(
    options?: { request?: RotateNativeCredentialRequest }
  ): Promise<NativeCredentialResponse> {
    if (options?.request) {
      const parsed = RotateNativeCredentialRequestSchema.safeParse(options.request);
      if (!parsed.success) {
        throw createValidationError('Invalid native credential rotation request', parsed.error.errors);
      }
    }

    const id = generateId('cred_ps');
    const token = `ps_test_${randomBytes(24).toString('hex')}`;
    const createdAt = new Date().toISOString();

    const newCred: StoredNativeCredential = {
      id,
      token,
      prefix: 'ps_test_',
      active: true,
      createdAt,
    };

    // Commit retention state update atomically
    const locks = ['retention'];
    await this.coordinator.transaction({ locks }, async (ctx) => {
      ctx.updateRetention((curr) => ({
        ...curr,
      }));
    });

    this.nativeCredential = newCred;

    return {
      id,
      token,
      prefix: 'ps_test_',
      active: true,
      createdAt,
    };
  }

  /**
   * Rotates the Razorpay Compatibility API key pair.
   * Returns one-time disclosure of the newly generated keySecret.
   */
  public async rotateCompatCredential(
    options?: { request?: RotateCompatCredentialRequest }
  ): Promise<CompatCredentialResponse> {
    if (options?.request) {
      const parsed = RotateCompatCredentialRequestSchema.safeParse(options.request);
      if (!parsed.success) {
        throw createValidationError('Invalid compatibility credential rotation request', parsed.error.errors);
      }
    }

    const newVersion = this.activeCompatVersion + 1;
    const id = generateId('cred_rzp');
    const keyId = `rzp_test_${randomBytes(8).toString('hex')}`;
    const keySecret = randomBytes(24).toString('hex');
    const createdAt = new Date().toISOString();

    const newCred: StoredCompatCredential = {
      id,
      keyId,
      keySecret,
      version: newVersion,
      active: true,
      createdAt,
    };

    const locks = ['retention'];
    await this.coordinator.transaction({ locks }, async (ctx) => {
      ctx.updateRetention((curr) => ({
        ...curr,
        activeSecretVersions: curr.activeSecretVersions + 1,
      }));
    });

    this.compatCredentials.set(id, newCred);
    this.activeCompatVersion = newVersion;

    return {
      id,
      keyId,
      keySecret,
      version: newVersion,
      active: true,
      createdAt,
    };
  }

  /**
   * Retrieves safe credential overview metadata.
   * NEVER returns raw secrets or bearer tokens!
   */
  public getCredentialsOverview(): CredentialsOverviewResponse {
    let nativeSummary: NativeCredentialSummary | null = null;
    if (this.nativeCredential) {
      nativeSummary = {
        id: this.nativeCredential.id,
        prefix: 'ps_test_',
        maskedToken: `${this.nativeCredential.prefix}••••••••${this.nativeCredential.token.slice(-4)}`,
        active: this.nativeCredential.active,
        createdAt: this.nativeCredential.createdAt,
      };
    }

    const compatSummaries: CompatCredentialSummary[] = [];
    for (const cred of this.compatCredentials.values()) {
      compatSummaries.push({
        id: cred.id,
        keyId: cred.keyId,
        version: cred.version,
        active: cred.version === this.activeCompatVersion,
        createdAt: cred.createdAt,
      });
    }

    // Sort compatibility summaries by version descending
    compatSummaries.sort((a, b) => b.version - a.version);

    return {
      native: nativeSummary,
      compatibility: compatSummaries,
      activeCompatVersion: this.activeCompatVersion,
    };
  }

  /**
   * Sets the bootstrap one-time token (for testing or server init).
   */
  public setBootstrapToken(token: string): void {
    this.bootstrapToken = token;
    this.bootstrapTokenConsumed = false;
  }

  /**
   * Retrieves or lazily creates the bootstrap one-time token.
   */
  public getBootstrapToken(): string {
    if (!this.bootstrapToken && !this.bootstrapTokenConsumed) {
      this.bootstrapToken = randomBytes(32).toString('hex');
    }
    return this.bootstrapToken ?? '';
  }

  /**
   * Exchanges an ephemeral control bootstrap token for a persistent dashboard session.
   * Atomically consumes the bootstrap token if one was configured.
   */
  public sessionExchange(token: string): { sessionToken: string; csrfToken: string; expiresAt: string } {
    if (!token || token.trim().length === 0) {
      throw createControlTokenInvalidError('Control token cannot be empty.');
    }

    if (this.bootstrapTokenConsumed) {
      throw createControlTokenInvalidError('Invalid, expired, or already-consumed control token');
    }

    if (this.bootstrapToken !== null && token !== this.bootstrapToken) {
      throw createControlTokenInvalidError('Invalid, expired, or already-consumed control token');
    }

    // Atomically consume bootstrap token upon first successful exchange
    if (this.bootstrapToken !== null) {
      this.bootstrapToken = null;
      this.bootstrapTokenConsumed = true;
    }

    const sessionToken = `sess_ps_${randomBytes(24).toString('hex')}`;
    const csrfToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    this.controlSessions.set(sessionToken, {
      sessionToken,
      csrfToken,
      expiresAt,
    });

    return { sessionToken, csrfToken, expiresAt };
  }

  /**
   * Logs out / terminates an active dashboard control session.
   */
  public sessionLogout(sessionToken: string): void {
    this.controlSessions.delete(sessionToken);
  }

  /**
   * Validates whether a control session token is currently active and unexpired.
   */
  public isSessionValid(sessionToken: string): boolean {
    const session = this.controlSessions.get(sessionToken);
    if (!session) {
      return false;
    }
    if (Date.now() > new Date(session.expiresAt).getTime()) {
      this.controlSessions.delete(sessionToken);
      return false;
    }
    return true;
  }

  /**
   * Validates that the provided CSRF token matches the active session.
   */
  public validateCsrf(sessionToken: string, csrfToken: string): boolean {
    if (!this.isSessionValid(sessionToken)) {
      return false;
    }
    const session = this.controlSessions.get(sessionToken);
    return session !== undefined && session.csrfToken === csrfToken;
  }

  /**
   * Validates whether the provided bearer token matches the currently active Native credential.
   */
  public validateNativeToken(token: string): boolean {
    return this.nativeCredential !== null && this.nativeCredential.active && this.nativeCredential.token === token;
  }

  /**
   * Returns the currently active Native API bearer token.
   */
  public getActiveNativeToken(): string | null {
    return this.nativeCredential?.active ? this.nativeCredential.token : null;
  }

  /**
   * Validates whether the provided keyId and keySecret match an active Compatibility credential.
   */
  public validateCompatCredential(keyId: string, keySecret: string): boolean {
    for (const cred of this.compatCredentials.values()) {
      if (cred.active && cred.version === this.activeCompatVersion && cred.keyId === keyId && cred.keySecret === keySecret) {
        return true;
      }
    }
    return false;
  }

  /**
   * Returns the currently active Compatibility keyId and keySecret pair.
   */
  public getActiveCompatCredential(): { keyId: string; keySecret: string } | null {
    for (const cred of this.compatCredentials.values()) {
      if (cred.active && cred.version === this.activeCompatVersion) {
        return { keyId: cred.keyId, keySecret: cred.keySecret };
      }
    }
    return null;
  }
}
