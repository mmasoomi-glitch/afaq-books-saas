/**
 * Named integration errors.
 *
 * Every failure path throws one of these, never a bare `new Error('failed')`.
 * Callers need to distinguish "manifest validation failed" from "credentials
 * expired" from "the external API is rate limiting us" from "this connector
 * is not registered".
 */

export class IntegrationError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.code = code;
    this.name = new.target.name;
  }
}

/** A requested connector is not in the registry. */
export class ConnectorNotFoundError extends IntegrationError {
  readonly connectorId: string;

  constructor(message: string, connectorId: string) {
    super(message, "INTEGRATION_CONNECTOR_NOT_FOUND");
    this.name = "ConnectorNotFoundError";
    this.connectorId = connectorId;
  }
}

/** A connector manifest failed validation. */
export class ManifestValidationError extends IntegrationError {
  readonly field: string;

  constructor(message: string, field: string) {
    super(message, "INTEGRATION_MANIFEST_INVALID");
    this.name = "ManifestValidationError";
    this.field = field;
  }
}

/** Credentials for a connector-tenant pair are missing. */
export class CredentialsNotFoundError extends IntegrationError {
  readonly connectorId: string;
  readonly tenantId: string;

  constructor(message: string, connectorId: string, tenantId: string) {
    super(message, "INTEGRATION_CREDENTIALS_NOT_FOUND");
    this.name = "CredentialsNotFoundError";
    this.connectorId = connectorId;
    this.tenantId = tenantId;
  }
}

/** Credentials were already revoked or expired. */
export class CredentialsRevokedError extends IntegrationError {
  readonly connectorId: string;
  readonly tenantId: string;

  constructor(message: string, connectorId: string, tenantId: string) {
    super(message, "INTEGRATION_CREDENTIALS_REVOKED");
    this.name = "CredentialsRevokedError";
    this.connectorId = connectorId;
    this.tenantId = tenantId;
  }
}

/** A sync operation failed irrecoverably. */
export class SyncFailedError extends IntegrationError {
  readonly syncRunId: string;

  constructor(message: string, syncRunId: string) {
    super(message, "INTEGRATION_SYNC_FAILED");
    this.name = "SyncFailedError";
    this.syncRunId = syncRunId;
  }
}

/** An external API returned an error (4xx/5xx). */
export class ExternalApiError extends IntegrationError {
  readonly statusCode?: number | undefined;

  constructor(message: string, statusCode?: number): void {
    super(message, "INTEGRATION_EXTERNAL_API");
    this.name = "ExternalApiError";
    if (statusCode !== undefined) {
      this.statusCode = statusCode;
    }
  }
}

/** Webhook signature verification failed. */
export class WebhookSignatureError extends IntegrationError {
  constructor(message: string) {
    super(message, "INTEGRATION_WEBHOOK_INVALID_SIGNATURE");
    this.name = "WebhookSignatureError";
  }
}

/** A connector's health check failed. */
export class HealthCheckFailedError extends IntegrationError {
  constructor(message: string) {
    super(message, "INTEGRATION_HEALTH_CHECK_FAILED");
    this.name = "HealthCheckFailedError";
  }
}

/** A connector was uninstalled or is not active. */
export class ConnectorInactiveError extends IntegrationError {
  readonly connectorId: string;

  constructor(message: string, connectorId: string) {
    super(message, "INTEGRATION_CONNECTOR_INACTIVE");
    this.name = "ConnectorInactiveError";
    this.connectorId = connectorId;
  }
}

/** Encryption/decryption of credentials failed. */
export class EncryptionError extends IntegrationError {
  constructor(message: string) {
    super(message, "INTEGRATION_ENCRYPTION_ERROR");
    this.name = "EncryptionError";
  }
}
