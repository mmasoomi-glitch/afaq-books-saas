import { BaseConnector } from "../../connector-base";
import type {
  SyncDirection,
  SyncResult,
  HealthStatus,
  ConnectorManifest,
} from "../../schema";

export const STRIPE_MANIFEST: ConnectorManifest = {
  connector_id: "stripe-payments",
  name: "Stripe Payments",
  version: "1.0.0",
  provider: "stripe",
  category: "payment",
  capabilities: [
    "payments",
    "invoices",
    "customers",
  ],
  required_scopes: [
    "read:customers",
    "read:payments",
    "read:invoices",
    "write:payments",
  ],
  authentication_type: "oauth2",
  supported_events: [
    "payment.received",
    "invoice.created",
    "invoice.paid",
  ],
  sync_directions: ["inbound", "outbound"],
  configuration_schema: {
    type: "object",
    properties: {
      client_id: { type: "string" },
      client_secret: { type: "string" },
      webhook_secret: { type: "string" },
    },
    required: ["client_id", "client_secret"],
  },
};

export class StripeConnector extends BaseConnector {
  private apiKey: string;

  constructor(config?: Record<string, unknown>) {
    super();
    this.apiKey = (config?.api_key as string) ?? "";
  }

  async initialize(): Promise<void> {
    if (!this.apiKey) {
      throw new Error("stripe: missing API key");
    }
    this.initialized = true;
  }

  async sync(
    _direction: SyncDirection,
    _cursor?: string | null,
  ): Promise<SyncResult> {
    if (!this.initialized) {
      throw new Error("stripe: connector not initialized");
    }

    // Stub: in production this calls the Stripe API
    return {
      recordsProcessed: 0,
      newRecords: 0,
      updatedRecords: 0,
      deletedRecords: 0,
      nextCursor: null,
      mappings: [],
      errors: [],
    };
  }

  async healthCheck(): Promise<HealthStatus> {
    const result: { healthy: boolean; latencyMs: number; lastSyncAt: Date | null; error?: string } = {
      healthy: this.initialized && this.apiKey.length > 0,
      latencyMs: 0,
      lastSyncAt: this.lastSyncAt,
    };
    if (!this.initialized) {
      result.error = "not initialized";
    }
    return result;
  }

  async disconnect(): Promise<void> {
    this.initialized = false;
    this.apiKey = "";
  }

  getSchema(): Record<string, unknown> {
    return STRIPE_MANIFEST.configuration_schema;
  }
}
