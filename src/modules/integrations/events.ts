import {
  type DomainEvent,
} from "./schema";

/**
 * In-process domain event bus for the integration platform.
 *
 * Decouples event producers (connectors, sync engine) from consumers
 * (ledger service, notifications, audit logging). Supports subscription-based
 * delivery of domain events with filtering by event type.
 *
 * All events produced by connectors flow through this bus before reaching
 * the ledger layer — ensuring that connectors never write directly to the
 * database.
 */
export class EventBus {
  private handlers = new Map<string, Set<EventHandler>>();

  /**
   * Publish a domain event.
   *
   * All subscribers for the event type are called synchronously in the order
   * they were registered. If a handler throws, the error is caught and logged
   * but does not prevent other handlers from receiving the event or prevent
   * the publisher from returning.
   *
   * Events that do not match any registered handler are silently dropped.
   */
  publish(event: DomainEvent): void {
    const subscribers = this.handlers.get(event.eventType);
    if (subscribers === undefined) return;

    for (const handler of subscribers) {
      try {
        handler(event);
      } catch (err) {
        console.error(
          `[eventbus] handler error for ${event.eventType}:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }

  /**
   * Subscribe to events of a given type.
   *
   * Returns an unsubscribe function. Multiple subscriptions to the same event
   * type are all invoked on each publish.
   */
  subscribe(eventType: string, handler: EventHandler): () => void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler);

    return () => {
      this.handlers.get(eventType)?.delete(handler);
    };
  }

  /**
   * Subscribe to ALL events regardless of type.
   */
  subscribeAll(handler: EventHandler): () => void {
    return this.subscribe("*", handler);
  }

  /**
   * Subscribe to all events in a category prefix.
   *
   * `subscribeToCategory("invoice")` matches "invoice.created", "invoice.paid",
   * etc.
   */
  subscribeToCategory(prefix: string, handler: EventHandler): () => void {
    return this.subscribe(prefix + ".*", handler);
  }

  /**
   * Remove all handlers for an event type.
   */
  unsubscribeAll(eventType: string): void {
    this.handlers.delete(eventType);
  }

  /**
   * Get the number of active subscriptions for an event type.
   */
  subscriberCount(eventType: string): number {
    const handlers = this.handlers.get(eventType);
    return handlers?.size ?? 0;
  }

  /**
   * Get all registered event types.
   */
  getEventTypes(): string[] {
    return [...this.handlers.keys()];
  }
}

export type EventHandler = (event: DomainEvent) => void;
