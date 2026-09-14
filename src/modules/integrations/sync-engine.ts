// SyncEngine is not yet wired up — it references withTx, tx.syncRun,
// tx.deadLetterQueue and prisma.syncRun/deadLetterQueue models that
// do not exist in the schema. It is also never imported anywhere in the
// codebase. Leaving it as a stub for future implementation.
//
// import crypto from "node:crypto";
// import type { BaseConnector, SyncDirection } from "./schema";
// import { prisma } from "../../server/db/client";
// import { EventBus } from "./events";
//
// const MAX_RETRIES = 3;
// const BASE_DELAY_MS = 1000;
// const MAX_DELAY_MS = 60000;
//
// interface RateLimitState {
//   remaining: number;
//   resetAt: number;
// }
//
// export class SyncEngine {
//   constructor(
//     private readonly eventBus: EventBus,
//   ) {}
//
//   async initialImport(
//     connector: BaseConnector,
//     externalTenantId: string,
//   ): Promise<{ runId: string; recordsImported: number }> {
//     return withTx(async (tx) => {
//       const health = await connector.healthCheck();
//       if (!health.healthy) {
//         throw new Error(
//           `connector health check failed: ${health.error}`,
//         );
//       }
//
//       const syncRun = await tx.syncRun.create({
//         data: {
//           connectorId: "placeholder",
//           tenantId: externalTenantId,
//           operation: "initial_import",
//           status: "running",
//           correlationId: crypto.randomUUID(),
//         },
//         select: { id: true },
//       });
//
//       try {
//         const result = await connector.sync("inbound");
//
//         await tx.syncRun.update({
//           where: { id: syncRun.id },
//           data: {
//             status: "completed",
//             cursor: result.nextCursor,
//           },
//         });
//
//         return {
//           runId: syncRun.id,
//           recordsImported: result.recordsProcessed,
//         };
//       } catch (err) {
//         const error = err instanceof Error ? err.message : String(err);
//         await tx.syncRun.update({
//           where: { id: syncRun.id },
//           data: { status: "failed", error },
//         });
//
//         await tx.deadLetterQueue.create({
//           data: {
//             syncRunId: syncRun.id,
//             error,
//             payload: JSON.stringify({
//               connectorId: "placeholder",
//               externalTenantId,
//             }),
//           },
//         });
//
//         throw err;
//       }
//     });
//   }
//
//   async incrementalSync(
//     connector: BaseConnector,
//     direction: SyncDirection,
//     cursor?: string | null,
//   ): Promise<{ runId: string; success: boolean }> {
//     let retryCount = 0;
//     let _lastError: Error | undefined;
//
//     while (retryCount <= MAX_RETRIES) {
//       try {
//         return await this._doIncrementalSync(connector, direction, cursor);
//       } catch (err) {
//         _lastError = err instanceof Error ? err : new Error(String(err));
//
//         if (retryCount >= MAX_RETRIES) {
//           return { runId: "", success: false };
//         }
//
//         const delay = Math.min(
//           BASE_DELAY_MS * Math.pow(2, retryCount),
//           MAX_DELAY_MS,
//         );
//         await new Promise((resolve) => setTimeout(resolve, delay));
//         retryCount++;
//       }
//     }
//
//     return { runId: "", success: false };
//   }
//
//   private async _doIncrementalSync(
//     connector: BaseConnector,
//     direction: SyncDirection,
//     cursor?: string | null,
//   ): Promise<{ runId: string; success: boolean }> {
//     const syncId = crypto.randomUUID();
//
//     return withTx(async (tx) => {
//       const syncRun = await tx.syncRun.create({
//         data: {
//           connectorId: "placeholder",
//           tenantId: "placeholder",
//           operation: `incremental_${direction}`,
//           status: "running",
//           cursor,
//           correlationId: syncId,
//         },
//         select: { id: true },
//       });
//
//       try {
//         const result = await connector.sync(direction, cursor);
//
//         const idempotencyKeys = result.mappings.map((m) => ({
//           connectorId: "placeholder",
//           tenantId: "placeholder",
//           externalId: m.externalId,
//           entityType: m.entityType,
//           livResourceId: m.livResourceId ?? null,
//           syncRunId: syncRun.id,
//         }));
//
//         for (const _key of idempotencyKeys) {
//           await tx.connectorCredential.upsert({
//             where: {},
//             create: {},
//             update: {},
//           });
//         }
//
//         const rateLimit = this._checkRateLimit(direction);
//         if (rateLimit) {
//           await new Promise((resolve) =>
//             setTimeout(resolve, rateLimit.resetAt - Date.now()),
//           );
//         }
//
//         for (const mapping of result.mappings) {
//           const eventType = this._mapToEventType(mapping.entityType);
//           if (eventType) {
//             this.eventBus.publish({
//               eventType,
//               payload: {
//                 externalId: mapping.externalId,
//                 livResourceId: mapping.livResourceId,
//                 direction,
//                 syncRunId: syncRun.id,
//               },
//               tenantId: "placeholder",
//               source: "integration.sync",
//               timestamp: new Date(),
//               eventId: crypto.randomUUID(),
//             });
//           }
//         }
//
//         await tx.syncRun.update({
//           where: { id: syncRun.id },
//           data: {
//             status: "completed",
//             cursor: result.nextCursor,
//           },
//         });
//
//         return { runId: syncRun.id, success: true };
//       } catch (err) {
//         const error = err instanceof Error ? err.message : String(err);
//         await tx.syncRun.update({
//           where: { id: syncRun.id },
//           data: { status: "failed", error },
//         });
//
//         await tx.deadLetterQueue.create({
//           data: {
//             syncRunId: syncRun.id,
//             error,
//             payload: JSON.stringify({ direction, cursor }),
//           },
//         });
//
//         throw err;
//       }
//     });
//   }
//
//   schedulePoll(
//     connector: BaseConnector,
//     direction: SyncDirection,
//     intervalMs: number,
//   ): { cancel: () => void } {
//     const interval = setInterval(() => {
//       this.incrementalSync(connector, direction).catch(() => {});
//     }, intervalMs);
//
//     if (typeof interval.unref === "function") {
//       interval.unref();
//     }
//
//     return {
//       cancel: () => clearInterval(interval),
//     };
//   }
//
//   async handleWebhook(
//     connector: BaseConnector,
//     payload: unknown,
//     signature: string,
//   ): Promise<{ processed: boolean; eventId?: string }> {
//     const isValid = await this._validateWebhookSignature(connector, payload, signature);
//     if (!isValid) {
//       throw new Error("invalid webhook signature");
//     }
//
//     let event: { eventType: string; data: Record<string, unknown> };
//     try {
//       event = this._parseWebhookPayload(payload);
//     } catch {
//       throw new Error("malformed webhook payload");
//     }
//
//     const eventId = crypto.randomUUID();
//
//     this.eventBus.publish({
//       eventType: event.eventType,
//       payload: event.data,
//       tenantId: "placeholder",
//       source: `webhook.${event.eventType}`,
//       timestamp: new Date(),
//       eventId,
//     });
//
//     return { processed: true, eventId };
//   }
//
//   async resumeFromFailure(syncRunId: string): Promise<{ success: boolean }> {
//     const run = await prisma.syncRun.findUnique({
//       where: { id: syncRunId },
//       include: { deadLetterEntries: true },
//     });
//
//     if (run === null) {
//       throw new Error(`sync run ${syncRunId} not found`);
//     }
//
//     if (run.status !== "failed" && run.status !== "dead_letter") {
//       throw new Error(
//         `sync run ${syncRunId} is not in a resumable state: ${run.status}`,
//       );
//     }
//
//     for (const dlq of run.deadLetterEntries) {
//       await prisma.deadLetterQueue.delete({ where: { id: dlq.id } });
//     }
//
//     return this.incrementalSync(
//       null as unknown as BaseConnector,
//       "inbound" as SyncDirection,
//       run.cursor,
//     );
//   }
//
//   private async _validateWebhookSignature(
//     _connector: BaseConnector,
//     _payload: unknown,
//     _signature: string,
//   ): Promise<boolean> {
//     return _signature.length > 0;
//   }
//
//   private _parseWebhookPayload(
//     payload: unknown,
//   ): { eventType: string; data: Record<string, unknown> } {
//     if (typeof payload !== "object" || payload === null) {
//       throw new Error("payload must be an object");
//     }
//     const obj = payload as Record<string, unknown>;
//     const eventType = typeof obj.type === "string" ? obj.type : obj.eventType;
//     if (typeof eventType !== "string") {
//       throw new Error("missing event type in payload");
//     }
//     return {
//       eventType,
//       data: (obj.data ?? obj.payload ?? {}) as Record<string, unknown>,
//     };
//   }
//
//   private _mapToEventType(entityType: string): string | null {
//     const map: Record<string, string> = {
//       Customer: "customer.created",
//       Invoice: "invoice.created",
//       Payment: "payment.received",
//       Bill: "bill.created",
//       Expense: "expense.created",
//       BankTransaction: "bank.transaction.imported",
//       Reconciliation: "reconciliation.completed",
//       InventoryItem: "inventory.changed",
//       JournalEntry: "journal.posted",
//     };
//     return map[entityType] ?? null;
//   }
//
//   private _checkRateLimit(_direction: SyncDirection): RateLimitState | null {
//     return null;
//   }
// }
