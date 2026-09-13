import {
  type ConnectorManifest,
  type ConnectorRegistration,
  type BaseConnector,
  type Category,
} from "./schema";
import { registerConnector } from "./manifest";

/**
 * In-memory registry for connector definitions.
 *
 * Production deployments should replace this with a database-backed variant,
 * but during bootstrap an in-memory registry is sufficient. The interface is
 * fixed so it can be swapped without changing consumers.
 *
 * Connector IDs are unique — registering the same ID twice overwrites the
 * previous registration with the new one.
 */
export class ConnectorRegistry {
  private readonly connectors = new Map<string, ConnectorRegistration>();

  /**
   * Register a connector. Validates the manifest, then stores it indexed by
   * `connector_id`.
   */
  register(registration: ConnectorRegistration): ConnectorRegistration {
    const validated = registerConnector(registration);
    this.connectors.set(validated.manifest.connector_id, validated);
    return validated;
  }

  /**
   * Look up a connector by its ID. Returns `undefined` if not found rather
   * than throwing — callers should decide whether not-found is an error.
   */
  getById(id: string): ConnectorRegistration | undefined {
    return this.connectors.get(id);
  }

  /**
   * Return all connectors that declare the given category in their manifest.
   */
  listByCategory(category: Category): ConnectorRegistration[] {
    return [...this.connectors.values()].filter(
      (r) => r.manifest.category === category,
    );
  }

  /**
   * Return all connectors from the given provider.
   */
  listByProvider(provider: string): ConnectorRegistration[] {
    return [...this.connectors.values()].filter(
      (r) => r.manifest.provider === provider,
    );
  }

  /**
   * Return every registered connector.
   */
  getAll(): ConnectorRegistration[] {
    return [...this.connectors.values()];
  }

  /**
   * Whether the registry knows about this connector.
   */
  has(id: string): boolean {
    return this.connectors.has(id);
  }

  /**
   * Number of connectors in the registry.
   */
  get size(): number {
    return this.connectors.size;
  }

  /**
   * Remove a connector from the registry.
   */
  remove(id: string): boolean {
    return this.connectors.delete(id);
  }
}
