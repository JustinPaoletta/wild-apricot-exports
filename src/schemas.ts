// src/schemas.ts
// Runtime validation at the API boundary using Zod.
//
// IMPORTANT: These schemas are deliberately PERMISSIVE. Wild Apricot's API
// returns inconsistent casing across endpoints (Id vs id, Name vs Title)
// and occasionally adds new fields. Schemas here serve as shape sanity
// checks — "this is roughly an array of things with optional id/name" —
// rather than strict contracts. A strict schema would fail-loud on benign
// API quirks and break exports for users.
//
// The ExportOptions schemas, by contrast, are strict — they validate
// caller input where we control both sides.

import { z } from "zod";

/* --------------------------------------------------------------------------
 * ExportOptions input validation (strict — caller-controlled)
 * -------------------------------------------------------------------------- */

const baseExportOptionsShape = {
  apiKey: z.string().min(1, "apiKey is required"),
  accountId: z.union([z.string(), z.number()]).optional(),
  outDir: z.string().optional(),
  // logger / onProgress / signal are runtime objects we don't validate
  // structurally; we only check their presence/absence.
  logger: z.unknown().optional(),
  onProgress: z.unknown().optional(),
  signal: z.unknown().optional(),
};

export const ExportOptionsSchema = z.object(baseExportOptionsShape);

export const EventsExportOptionsSchema = z.object({
  ...baseExportOptionsShape,
  requestDelayMs: z.number().int().nonnegative().optional(),
  saveEveryN: z.number().int().positive().optional(),
});

export const RetryEventFailuresOptionsSchema = z.object({
  ...baseExportOptionsShape,
  requestDelayMs: z.number().int().nonnegative().optional(),
});

export const RegistrationsExportOptionsSchema = z.object({
  ...baseExportOptionsShape,
  events: z.array(z.unknown()).optional(),
  requestDelayMs: z.number().int().nonnegative().optional(),
  saveEveryN: z.number().int().positive().optional(),
});

const dateRangeShape = {
  ...baseExportOptionsShape,
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
    .optional(),
};

export const InvoicesExportOptionsSchema = z.object(dateRangeShape);
export const PaymentsExportOptionsSchema = z.object(dateRangeShape);
export const DonationsExportOptionsSchema = z.object(dateRangeShape);
export const AuditLogExportOptionsSchema = z.object(dateRangeShape);

export const FilesExportOptionsSchema = z
  .object({
    webdavUrl: z.string().url().or(z.string().min(1, "webdavUrl is required")),
    adminEmail: z.string().min(1, "adminEmail is required"),
    adminPassword: z.string().min(1, "adminPassword is required"),
    outDir: z.string().optional(),
    fileDirs: z.array(z.string()).optional(),
    interFileDelayMs: z.number().int().nonnegative().optional(),
    maxRetries: z.number().int().positive().optional(),
    retryBaseMs: z.number().int().nonnegative().optional(),
    logger: z.unknown().optional(),
    onProgress: z.unknown().optional(),
    signal: z.unknown().optional(),
  })
  .refine((opts) => !!opts.webdavUrl, { message: "webdavUrl is required" });

/* --------------------------------------------------------------------------
 * API-boundary shape checks (permissive — API-controlled)
 *
 * These are deliberately loose: we use `.passthrough()` everywhere to keep
 * unknown fields on the object, and we accept either casing (`Id`/`id`,
 * etc.) by leaving fields optional. A schema here failing means the API
 * returned something fundamentally different (e.g. a string instead of an
 * object) — not just that field names changed.
 * -------------------------------------------------------------------------- */

const idLike = z.union([z.string(), z.number()]).optional();

export const TokenResponseSchema = z
  .object({
    access_token: z.string(),
    expires_in: z.number().int().positive().optional(),
  })
  .passthrough();

/** A list-version event from /accounts/{id}/events. */
export const EventListItemSchema = z
  .object({
    Id: idLike,
    id: idLike,
    EventId: idLike,
    eventId: idLike,
    Name: z.string().optional(),
    Title: z.string().optional(),
  })
  .passthrough();

export const EventsResponseSchema = z.union([
  z.array(z.unknown()),
  z.object({ Events: z.array(z.unknown()).optional() }).passthrough(),
  z.object({ events: z.array(z.unknown()).optional() }).passthrough(),
  z.object({ Items: z.array(z.unknown()).optional() }).passthrough(),
  z.object({ items: z.array(z.unknown()).optional() }).passthrough(),
]);

/** A registration row. */
export const RegistrationSchema = z
  .object({
    Id: idLike,
    id: idLike,
  })
  .passthrough();

export const RegistrationsResponseSchema = z.union([
  z.array(RegistrationSchema),
  z
    .object({
      Items: z.array(RegistrationSchema).optional(),
      Registrations: z.array(RegistrationSchema).optional(),
    })
    .passthrough(),
]);

/** A contact row (from the async query response). */
export const ContactSchema = z
  .object({
    Id: idLike,
    id: idLike,
    FirstName: z.string().optional(),
    LastName: z.string().optional(),
    Email: z.string().optional(),
    FieldValues: z.array(z.unknown()).optional(),
  })
  .passthrough();

export const ContactsResponseSchema = z.union([
  z.array(z.unknown()),
  z
    .object({
      Items: z.array(z.unknown()).optional(),
      Contacts: z.array(z.unknown()).optional(),
      ResultId: z.union([z.string(), z.number()]).optional(),
      resultId: z.union([z.string(), z.number()]).optional(),
      State: z.string().optional(),
    })
    .passthrough(),
]);

/** Generic "list of records with idLike id" response — used for invoices,
 * payments, donations, audit-log. */
export const RecordListResponseSchema = z.union([
  z.array(z.unknown()),
  z
    .object({
      Items: z.array(z.unknown()).optional(),
      items: z.array(z.unknown()).optional(),
    })
    .passthrough(),
]);

/** Paginated wrapper used for downstream extraction. */
export const PaginatedResponseSchema = RecordListResponseSchema;
