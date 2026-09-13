/**
 * Canonical types for the integration platform.
 *
 * Connector manifests define what a plugin can do. The registry holds them.
 * The sync engine drives data movement. The event bus decouples producers from
 * consumers. None of these touch the database directly — they operate on
 * plain objects and pass through handlers that do.
 */

export type SyncDirection = "outbound" | "inbound" | "bidirectional";

export type AuthenticationType =
  | "oauth2"
  | "api_key"
  | "token"
  | "basic"
  | "jwt"
  | "custom";

export type Capability =
  | "invoices"
  | "payments"
  | "customers"
  | "products"
  | "bills"
  | "expenses"
  | "bank_reconciliation"
  | "inventory"
  | "journal_entries";

export type Category =
  | "payment"
  | "ecommerce"
  | "banking"
  | "crm"
  | "erp"
  | "accounting"
  | "inventory"
  | "hr"
  | "other";

export interface ConnectorManifest {
  readonly connector_id: string;
  readonly name: string;
  readonly version: string;
  readonly provider: string;
  readonly category: Category;
  readonly capabilities: readonly Capability[];
  readonly required_scopes: readonly string[];
  readonly authentication_type: AuthenticationType;
  readonly supported_events: readonly string[];
  readonly sync_directions: readonly SyncDirection[];
  readonly configuration_schema: Record<string, unknown>;
}

export interface ConnectorRegistration {
  readonly manifest: ConnectorManifest;
  readonly ConnectorClass: BaseConnectorConstructor;
}

export type BaseConnectorConstructor = new (config?: Record<string, unknown>) => BaseConnector;

export interface BaseConnector {
  initialize(): Promise<void>;
  sync(
    direction: SyncDirection,
    cursor?: string | null,
  ): Promise<SyncResult>;
  healthCheck(): Promise<HealthStatus>;
  disconnect(): Promise<void>;
  getSchema(): Record<string, unknown>;
}

export interface SyncResult {
  readonly recordsProcessed: number;
  readonly newRecords: number;
  readonly updatedRecords: number;
  readonly deletedRecords: number;
  readonly nextCursor: string | null;
  readonly mappings: readonly ExternalIdMapping[];
  readonly errors: readonly SyncError[];
}

export interface ExternalIdMapping {
  readonly externalId: string;
  readonly livResourceId: string | null;
  readonly entityType: string;
}

export interface SyncError {
  readonly externalId?: string;
  readonly entityType?: string;
  readonly message: string;
  readonly retryable: boolean;
}

export interface HealthStatus {
  readonly healthy: boolean;
  readonly latencyMs: number;
  readonly lastSyncAt: Date | null;
  readonly error?: string;
}

export interface SyncRunRecord {
  readonly id: string;
  readonly connectorId: string;
  readonly tenantId: string;
  readonly externalResourceId: string | null;
  readonly livResourceId: string | null;
  readonly operation: string;
  readonly status: "pending" | "running" | "completed" | "failed" | "dead_letter";
  readonly cursor: string | null;
  readonly error: string | null;
  readonly correlationId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface DomainEvent {
  readonly eventType: string;
  readonly payload: Record<string, unknown>;
  readonly tenantId: string;
  readonly source: string;
  readonly timestamp: Date;
  readonly eventId: string;
}

export interface DeadLetterEntry {
  readonly id: string;
  readonly syncRunId: string | null;
  readonly error: string;
  readonly payload: string;
  readonly createdAt: Date;
}

// Canonical LIV concept mappings — every connector must map to these.
export const LIV_CONCEPTS = [
  "Customer",
  "Product",
  "Invoice",
  "Payment",
  "JournalEntry",
  "Bill",
  "Expense",
  "BankTransaction",
  "Reconciliation",
  "InventoryItem",
] as const;

export type LivConcept = (typeof LIV_CONCEPTS)[number];

// Supported domain events
export const SUPPORTED_EVENTS = [
  "invoice.created",
  "invoice.paid",
  "payment.received",
  "bill.created",
  "expense.created",
  "bank.transaction.imported",
  "reconciliation.completed",
  "inventory.changed",
  "customer.created",
  "journal.posted",
  "period.closed",
] as const;

export type SupportedEvent = (typeof SUPPORTED_EVENTS)[number];
