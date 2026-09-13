import type {
  BaseConnector,
  SyncDirection,
  SyncResult,
  HealthStatus,
} from "./schema";

/**
 * Abstract base class that every connector must extend.
 *
 * The sync engine and all handler code reference `BaseConnector` as the
 * contract — a concrete connector (StripeConnector, ShopifyConnector, etc.)
 * is just a subclass that implements the five methods below.
 *
 * Tenant scoping is the responsibility of the caller (the API handler or
 * sync engine), not the connector itself. A connector operates on whatever
 * credentials it was initialized with.
 */
export abstract class BaseConnector implements BaseConnector {
  protected initialized = false;
  protected lastSyncAt: Date | null = null;

  abstract initialize(): Promise<void>;
  abstract sync(
    direction: SyncDirection,
    cursor?: string | null,
  ): Promise<SyncResult>;
  abstract healthCheck(): Promise<HealthStatus>;
  abstract disconnect(): Promise<void>;
  abstract getSchema(): Record<string, unknown>;

  /**
   * Check if the connector has been initialised.
   */
  get isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * When the last successful sync completed.
   */
  get lastSyncAt(): Date | null {
    return this.lastSyncAt;
  }
}
