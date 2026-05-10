// src/exporters/contacts.ts
// Exports all Wild Apricot contacts (members + non-members) using the async
// API pattern.

import * as path from "node:path";

import {
  API_BASE,
  asyncQuery,
  extractItems,
  ensureDir,
  writeJson,
  writeCsv,
  getNested,
  getAuthAndAccount,
} from "../wa-api";
import { ExportOptionsSchema } from "../schemas";
import { resolveLogger } from "../logger";
import type { ContactsExportOptions, ContactsExportResult } from "../types";

interface FieldValue {
  FieldName?: string;
  fieldName?: string;
  Value?: unknown;
  value?: unknown;
}

interface FieldValueObject {
  Label?: string;
  Value?: string;
}

function flattenFieldValues(contact: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const obj = (contact ?? {}) as Record<string, unknown>;
  const fieldValues =
    (obj.FieldValues as FieldValue[] | undefined) ??
    (obj.fieldValues as FieldValue[] | undefined) ??
    [];
  for (const fv of fieldValues) {
    const name = fv.FieldName ?? fv.fieldName;
    let value: unknown = fv.Value !== undefined ? fv.Value : fv.value;
    if (Array.isArray(value)) {
      value = value
        .map((v) =>
          typeof v === "object" && v !== null
            ? ((v as FieldValueObject).Label ?? (v as FieldValueObject).Value ?? JSON.stringify(v))
            : v
        )
        .join("; ");
    } else if (value && typeof value === "object") {
      const obj2 = value as FieldValueObject;
      value = obj2.Label ?? obj2.Value ?? JSON.stringify(value);
    }
    if (name) out[name] = value;
  }
  return out;
}

function normalizeContact(contact: unknown): Record<string, unknown> {
  const flat = flattenFieldValues(contact);
  return {
    id: getNested(contact, ["Id", "id"]),
    firstName: getNested(contact, ["FirstName", "firstName"]),
    lastName: getNested(contact, ["LastName", "lastName"]),
    email: getNested(contact, ["Email", "email"]),
    displayName: getNested(contact, ["DisplayName", "displayName"]),
    organization:
      getNested(contact, ["Organization", "organization"]) || flat["Organization"] || "",
    membershipEnabled: getNested(contact, ["MembershipEnabled", "membershipEnabled"]),
    membershipLevelName: getNested(contact, ["MembershipLevel.Name", "membershipLevel.name"]) || "",
    membershipLevelId: getNested(contact, ["MembershipLevel.Id", "membershipLevel.id"]) || "",
    status: getNested(contact, ["Status", "status"]),
    isAccountAdministrator: getNested(contact, [
      "IsAccountAdministrator",
      "isAccountAdministrator",
    ]),
    isSuspendedMember: getNested(contact, ["IsSuspendedMember", "isSuspendedMember"]),
    membershipStartDate: flat["Member since"] || "",
    renewalDueDate: flat["Renewal due"] || "",
    lastLogin: getNested(contact, ["LastLoginDate", "lastLoginDate"]),
    createdDate: flat["Creation date"] || getNested(contact, ["ProfileLastUpdated"]),
    profileLastUpdated: getNested(contact, ["ProfileLastUpdated", "profileLastUpdated"]),
    phone: flat["Phone"] || flat["phone"] || "",
    mobile: flat["Mobile phone"] || "",
    address: flat["Address"] || "",
    city: flat["City"] || "",
    state: flat["State"] || "",
    zip: flat["Zip"] || flat["Postal Code"] || "",
    country: flat["Country"] || "",
  };
}

export async function exportContacts(opts: ContactsExportOptions): Promise<ContactsExportResult> {
  ExportOptionsSchema.parse(opts);
  const logger = resolveLogger(opts.logger);

  const outDir = path.join(opts.outDir || "./exports", "contacts");
  ensureDir(outDir);

  const { tokenManager, accountId } = await getAuthAndAccount({
    apiKey: opts.apiKey,
    accountId: opts.accountId,
    signal: opts.signal,
    logger: opts.logger,
  });

  const baseUrl = `${API_BASE}/accounts/${accountId}/contacts`;

  logger.info(
    "Fetching contacts via async API (this can take several minutes for large databases)..."
  );
  const result = await asyncQuery(
    baseUrl,
    tokenManager,
    { $async: "false", includeDetails: "true" },
    { signal: opts.signal, logger: opts.logger }
  );
  const contacts = extractItems(result, "Contacts");

  logger.info(`Got ${contacts.length} contacts.`);

  const jsonPath = path.join(outDir, "contacts.json");
  const csvPath = path.join(outDir, "contacts.csv");

  writeJson(contacts, jsonPath);

  const normalized = contacts.map(normalizeContact);
  const columns = [
    "id",
    "firstName",
    "lastName",
    "email",
    "displayName",
    "organization",
    "membershipEnabled",
    "membershipLevelName",
    "membershipLevelId",
    "status",
    "isAccountAdministrator",
    "isSuspendedMember",
    "membershipStartDate",
    "renewalDueDate",
    "lastLogin",
    "createdDate",
    "profileLastUpdated",
    "phone",
    "mobile",
    "address",
    "city",
    "state",
    "zip",
    "country",
  ];
  writeCsv(normalized, columns, csvPath);

  logger.info("");
  logger.info("Done.");
  logger.info(`JSON: ${jsonPath}`);
  logger.info(`CSV:  ${csvPath}`);

  return {
    outDir,
    jsonPath,
    csvPath,
    count: contacts.length,
  };
}
