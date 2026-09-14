import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const KEY_LENGTH = 32;
const SECRET_VERSION = "v1";

/**
 * Centralized secrets management for connector credentials.
 *
 * All credentials are encrypted at rest using AES-256-GCM. The encryption key
 * is derived from an environment variable (`INTEGRATION_SECRET_KEY`) using
 * PBKDF2 with a random salt. Credentials are NEVER exposed to frontend code —
 * API handlers must strip them before returning data.
 *
 * Thread-safe for the in-memory store (single-threaded Node). For multi-process
 * deployments the store should be replaced with a database-backed variant.
 */
export class AuthManager {
  private readonly key: Buffer;
  private readonly salt: Buffer;

  constructor(secretKey?: string) {
    const keyEnv = secretKey ?? process.env["INTEGRATION_SECRET_KEY"];
    if (!keyEnv || keyEnv.length < 32) {
      throw new Error(
        "INTEGRATION_SECRET_KEY must be set and at least 32 characters",
      );
    }
    this.salt = crypto.randomBytes(SALT_LENGTH);
    this.key = crypto.pbkdf2Sync(keyEnv, this.salt, 100000, KEY_LENGTH, "sha256");
  }

  /**
   * Encrypt sensitive fields from connector credentials.
   *
   * Returns an object with the same keys but values replaced by
   * `{ iv, encryptedData, authTag }` for each encrypted value.
   */
  encryptSecrets(
    credentials: Record<string, string>,
  ): Record<string, EncryptedValue> {
    const result: Record<string, EncryptedValue> = {};

    for (const [key, value] of Object.entries(credentials)) {
      result[key] = this.encryptSingleValue(value);
    }

    return result;
  }

  /**
   * Decrypt stored credentials back to plaintext.
   *
   * Returns the original key-value pairs. Throws if any value cannot be
   * decrypted (tampered or corrupted data).
   */
  decryptSecrets(
    encrypted: Record<string, EncryptedValue>,
  ): Record<string, string> {
    const result: Record<string, string> = {};

    for (const [key, enc] of Object.entries(encrypted)) {
      result[key] = this.decryptSingleValue(enc);
    }

    return result;
  }

  /**
   * Store credentials for a connector-tenant pair.
   *
   * Encrypts all values before storing. The tenantId corresponds to an
   * organization id in the database.
   */
  storeCredentials(
    connectorId: string,
    tenantId: string,
    credentials: Record<string, string>,
  ): void {
    const encrypted = this.encryptSecrets(credentials);
    const key = `${connectorId}:${tenantId}`;

    this.store.set(key, {
      encryptedCredentials: encrypted,
      secretVersion: SECRET_VERSION,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  /**
   * Retrieve stored credentials for a connector-tenant pair.
   *
   * Returns DECRYPTED plaintext values.
   *
   * IMPORTANT: These values must NEVER be sent to the frontend. API handlers
   * should only return metadata (connector name, auth status, etc.) and must
   * never include credential fields in any response body.
   */
  getCredentials(
    connectorId: string,
    tenantId: string,
  ): Record<string, string> | null {
    const key = `${connectorId}:${tenantId}`;
    const record = this.store.get(key);

    if (record === undefined) return null;
    if (record.secretVersion !== SECRET_VERSION) {
      throw new Error(`unsupported secret version: ${record.secretVersion}`);
    }

    return this.decryptSecrets(record.encryptedCredentials);
  }

  /**
   * Revoke and delete credentials for a connector-tenant pair.
   *
   * After this call, `getCredentials` will return null. Use this when a user
   * disconnects a connector or when credentials are suspected to be compromised.
   */
  revokeCredentials(connectorId: string, tenantId: string): void {
    const key = `${connectorId}:${tenantId}`;
    this.store.delete(key);
  }

  // ── Private crypto helpers ───────────────────────────────────────────

  private encryptSingleValue(value: string): EncryptedValue {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv);

    let encrypted = cipher.update(value, "utf8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag();

    return {
      iv: iv.toString("hex"),
      encryptedData: encrypted,
      authTag: authTag.toString("hex"),
      salt: this.salt.toString("hex"),
      version: SECRET_VERSION,
    };
  }

  private decryptSingleValue(enc: EncryptedValue): string {
    if (enc.version !== SECRET_VERSION) {
      throw new Error(`unsupported secret version: ${enc.version}`);
    }

    const iv = Buffer.from(enc.iv, "hex");
    const authTag = Buffer.from(enc.authTag, "hex");
    const decipher = crypto.createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(enc.encryptedData, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  }

  // In-memory store. Replace with database-backed variant for production.
  private store = new Map<string, StoredCredentials>();
}

interface EncryptedValue {
  iv: string;
  encryptedData: string;
  authTag: string;
  salt: string;
  version: string;
}

interface StoredCredentials {
  encryptedCredentials: Record<string, EncryptedValue>;
  secretVersion: string;
  createdAt: Date;
  updatedAt: Date;
}
