import {
  type Capability,
  type Category,
  type SyncDirection,
  type AuthenticationType,
  type ConnectorManifest,
  type ConnectorRegistration,
} from "./schema";

const VALID_CATEGORIES = new Set<Category>([
  "payment",
  "ecommerce",
  "banking",
  "crm",
  "erp",
  "accounting",
  "inventory",
  "hr",
  "other",
]);

const VALID_CAPABILITIES = new Set<Capability>([
  "invoices",
  "payments",
  "customers",
  "products",
  "bills",
  "expenses",
  "bank_reconciliation",
  "inventory",
  "journal_entries",
]);

const VALID_SYNC_DIRECTIONS = new Set<SyncDirection>([
  "outbound",
  "inbound",
  "bidirectional",
]);

const VALID_AUTH_TYPES = new Set<AuthenticationType>([
  "oauth2",
  "api_key",
  "token",
  "basic",
  "jwt",
  "custom",
]);

export class InvalidManifestError extends Error {
  readonly code = "INVALID_MANIFEST";
  readonly field: string;

  constructor(message: string, field: string) {
    super(message);
    this.name = "InvalidManifestError";
    this.field = field;
  }
}

function validateNonEmptyString(
  value: unknown,
  field: string,
): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new InvalidManifestError(
      `${field} must be a non-empty string`,
      field,
    );
  }
}

function validateVersion(value: string): void {
  // Semver-ish: major.minor.patch or major.minor
  if (!/^\d+\.\d+(\.\d+)?$/.test(value)) {
    throw new InvalidManifestError(
      `${field} must be a valid semver string (e.g. 1.0.0)`,
      "version",
    );
  }
}

function validateArray(
  value: unknown,
  field: string,
  minItems = 1,
): asserts value is unknown[] {
  if (!Array.isArray(value) || value.length < minItems) {
    throw new InvalidManifestError(
      `${field} must be an array with at least ${minItems} items`,
      field,
    );
  }
}

function validateStringArray(
  value: unknown,
  field: string,
  minItems = 1,
): asserts value is string[] {
  validateArray(value, field, minItems);
  for (let i = 0; i < value.length; i++) {
    if (typeof value[i] !== "string" || value[i].trim() === "") {
      throw new InvalidManifestError(
        `${field}[${i}] must be a non-empty string`,
        `${field}[${i}]`,
      );
    }
  }
}

function validateCategory(value: string): asserts value is Category {
  if (!VALID_CATEGORIES.has(value as Category)) {
    throw new InvalidManifestError(
      `${field} must be one of: ${[...VALID_CATEGORIES].join(", ")}`,
      "category",
    );
  }
}

function validateCapabilities(value: unknown): void {
  validateStringArray(value, "capabilities", 1);
  for (let i = 0; i < value.length; i++) {
    const cap = value[i];
    if (!VALID_CAPABILITIES.has(cap as Capability)) {
      throw new InvalidManifestError(
        `capabilities[${i}] "${cap}" must be one of: ${[...VALID_CAPABILITIES].join(", ")}`,
        `capabilities[${i}]`,
      );
    }
  }
}

function validateSyncDirections(value: unknown): void {
  validateStringArray(value, "sync_directions", 1);
  for (let i = 0; i < value.length; i++) {
    const dir = value[i];
    if (!VALID_SYNC_DIRECTIONS.has(dir as SyncDirection)) {
      throw new InvalidManifestError(
        `sync_directions[${i}] "${dir}" must be one of: ${[...VALID_SYNC_DIRECTIONS].join(", ")}`,
        `sync_directions[${i}]`,
      );
    }
  }
}

function validateAuthType(value: string): asserts value is AuthenticationType {
  if (!VALID_AUTH_TYPES.has(value as AuthenticationType)) {
    throw new InvalidManifestError(
      `authentication_type must be one of: ${[...VALID_AUTH_TYPES].join(", ")}`,
      "authentication_type",
    );
  }
}

function validateNonEmptyId(value: string, field: string): void {
  if (value.length === 0) {
    throw new InvalidManifestError(
      `${field} must not be empty`,
      field,
    );
  }
  // connector_id must be kebab-case
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(value)) {
    throw new InvalidManifestError(
      `${field} must be kebab-case (e.g. "stripe-payments")`,
      field,
    );
  }
}

/**
 * Validate a connector manifest against the required schema.
 *
 * Throws `InvalidManifestError` with details about which field failed and why.
 * This is a hard check — a manifest that does not conform cannot be registered,
 * because the registry will not have the information it needs to wire up the
 * connector correctly.
 */
export function validateConnectorManifest(
  manifest: ConnectorManifest,
): ConnectorManifest {
  const {
    connector_id,
    name,
    version,
    provider,
    category,
    capabilities,
    required_scopes,
    authentication_type,
    supported_events,
    sync_directions,
    configuration_schema,
  } = manifest;

  validateNonEmptyId(connector_id, "connector_id");
  validateNonEmptyString(name, "name");
  validateNonEmptyString(provider, "provider");

  const v = String(version);
  validateVersion(v);

  validateCategory(String(category));
  validateCapabilities(capabilities);
  validateStringArray(required_scopes, "required_scopes", 1);
  validateAuthType(String(authentication_type));
  validateStringArray(supported_events, "supported_events", 1);
  validateSyncDirections(sync_directions);

  if (
    configuration_schema !== undefined &&
    configuration_schema !== null &&
    typeof configuration_schema !== "object"
  ) {
    throw new InvalidManifestError(
      "configuration_schema must be a JSON object",
      "configuration_schema",
    );
  }

  return manifest;
}

/**
 * Register a connector after validating its manifest.
 *
 * Returns a `ConnectorRegistration` that the registry will store.
 * If the manifest is invalid, throws `InvalidManifestError`.
 */
export function registerConnector(
  registration: ConnectorRegistration,
): ConnectorRegistration {
  validateConnectorManifest(registration.manifest);
  return registration;
}
