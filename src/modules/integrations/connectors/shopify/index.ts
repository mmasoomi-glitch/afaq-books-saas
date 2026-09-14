import { BaseConnectorImpl } from "../../connector-base";
import type {
  SyncDirection,
  SyncResult,
  HealthStatus,
  ConnectorManifest,
} from "../../schema";

export const SHOPIFY_MANIFEST: ConnectorManifest = {
  connector_id: "shopify-ecommerce",
  name: "Shopify Ecommerce",
  version: "1.0.0",
  provider: "shopify",
  category: "ecommerce",
  capabilities: [
    "products",
    "customers",
    "invoices",
    "inventory",
  ],
  required_scopes: [
    "read:products",
    "read:orders",
    "read:customers",
    "write:inventory",
  ],
  authentication_type: "oauth2",
  supported_events: [
    "inventory.changed",
    "customer.created",
    "invoice.created",
    "payment.received",
  ],
  sync_directions: ["bidirectional", "inbound"],
  configuration_schema: {
    type: "object",
    properties: {
      shop_domain: { type: "string" },
      api_key: { type: "string" },
      api_secret: { type: "string" },
      access_token: { type: "string" },
    },
    required: ["shop_domain", "api_key", "api_secret"],
  },
};

export class ShopifyConnector extends BaseConnectorImpl {
  private shopDomain: string;
  private accessToken: string;

  constructor(config?: Record<string, unknown>) {
    super();
    this.shopDomain = (config?.shop_domain as string) ?? "";
    this.accessToken = (config?.access_token as string) ?? "";
  }

  async initialize(): Promise<void> {
    if (!this.shopDomain || !this.accessToken) {
      throw new Error("shopify: missing shop domain or access token");
    }
    this.initialized = true;
  }

  async sync(
    _direction: SyncDirection,
    _cursor?: string | null,
  ): Promise<SyncResult> {
    if (!this.initialized) {
      throw new Error("shopify: connector not initialized");
    }

    // Stub: in production this calls the Shopify Admin API
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
      healthy: this.initialized && !!this.shopDomain && !!this.accessToken,
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
    this.shopDomain = "";
    this.accessToken = "";
  }

  getSchema(): Record<string, unknown> {
    return SHOPIFY_MANIFEST.configuration_schema;
  }
}
