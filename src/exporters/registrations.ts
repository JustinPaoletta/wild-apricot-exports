// src/exporters/registrations.ts
// Exports event registrations for every event in the account.
//
// Cross-exporter cache contract: the caller may pass `events: Event[]` to
// avoid re-fetching the event list. If omitted, this function fetches the
// event list fresh from the API. (The CLI shim handles "read from
// <outDir>/events/wild-apricot-events.json if present" so library users
// don't get surprise file I/O.)

import * as fs from "node:fs";
import * as path from "node:path";

import {
  API_BASE,
  apiGet,
  paginate,
  ensureDir,
  writeJson,
  writeCsv,
  getNested,
  getAuthAndAccount,
  sleep,
} from "../wa-api";
import { RegistrationsExportOptionsSchema } from "../schemas";
import { resolveLogger } from "../logger";
import type {
  RegistrationsExportOptions,
  RegistrationsExportResult,
  Logger,
} from "../types";

const DEFAULT_REQUEST_DELAY_MS = 350;
const DEFAULT_SAVE_EVERY_N = 5;

interface FailureRecord {
  eventId: string | number;
  error: string;
}

interface PartialState {
  completedEventIds: string[];
  registrations: unknown[];
  failures: FailureRecord[];
}

function loadPartial(partialPath: string, logger: Logger): PartialState {
  const empty: PartialState = {
    completedEventIds: [],
    registrations: [],
    failures: [],
  };
  if (!fs.existsSync(partialPath)) return empty;
  try {
    const raw = JSON.parse(
      fs.readFileSync(partialPath, "utf8")
    ) as Partial<PartialState>;
    if (
      raw &&
      Array.isArray(raw.completedEventIds) &&
      Array.isArray(raw.registrations)
    ) {
      return {
        completedEventIds: raw.completedEventIds,
        registrations: raw.registrations,
        failures: Array.isArray(raw.failures) ? raw.failures : [],
      };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`  partial cache unreadable, starting fresh: ${msg}`);
  }
  return empty;
}

function savePartial(state: PartialState, partialPath: string): void {
  fs.writeFileSync(partialPath, JSON.stringify(state, null, 2), "utf8");
}

interface RegistrationWithEvent {
  _event?: { Id?: string | number; Name?: string };
  [key: string]: unknown;
}

function normalizeRegistration(
  reg: unknown,
  event: unknown
): Record<string, unknown> {
  const regObj = (reg ?? {}) as Record<string, unknown>;
  const contact =
    (regObj.Contact as Record<string, unknown> | undefined) ??
    (regObj.contact as Record<string, unknown> | undefined) ??
    {};
  return {
    registrationId: getNested(reg, ["Id", "id"]),
    eventId:
      getNested(event, ["Id", "id"]) || getNested(reg, ["Event.Id", "EventId"]),
    eventTitle: getNested(event, ["Name", "Title"]) || "",
    eventStartDate: getNested(event, ["StartDate", "StartDateTime"]) || "",
    contactId:
      getNested(contact, ["Id", "id"]) || getNested(reg, ["ContactId"]),
    firstName: getNested(contact, ["FirstName", "firstName"]),
    lastName: getNested(contact, ["LastName", "lastName"]),
    email:
      getNested(contact, ["Email", "email"]) ||
      getNested(reg, ["RegistrationFields.Email"]),
    displayName:
      getNested(reg, ["DisplayName", "displayName"]) ||
      getNested(contact, ["DisplayName"]),
    registrationTypeName: getNested(reg, [
      "RegistrationType.Name",
      "RegistrationTypeName",
    ]),
    registrationTypeId: getNested(reg, [
      "RegistrationTypeId",
      "RegistrationType.Id",
    ]),
    isPaid: getNested(reg, ["IsPaid", "isPaid"]),
    paidSum: getNested(reg, ["PaidSum", "paidSum"]),
    invoiceId: getNested(reg, ["InvoiceId", "invoiceId"]),
    confirmationCode: getNested(reg, ["ConfirmationCode"]),
    isCheckedIn: getNested(reg, ["IsCheckedIn"]),
    onWaitList: getNested(reg, ["OnWaitList"]),
    status: getNested(reg, ["Status"]),
    memo: getNested(reg, ["Memo"]),
    createdDate: getNested(reg, ["CreatedDate", "createdDate"]),
  };
}

export async function exportRegistrations(
  opts: RegistrationsExportOptions
): Promise<RegistrationsExportResult> {
  RegistrationsExportOptionsSchema.parse(opts);
  const logger = resolveLogger(opts.logger);

  const outDir = path.join(opts.outDir || "./exports", "registrations");
  const partialPath = path.join(outDir, "registrations.partial.json");
  const failuresPath = path.join(outDir, "_failures.json");
  const requestDelayMs =
    typeof opts.requestDelayMs === "number"
      ? opts.requestDelayMs
      : DEFAULT_REQUEST_DELAY_MS;
  const saveEveryN =
    typeof opts.saveEveryN === "number" ? opts.saveEveryN : DEFAULT_SAVE_EVERY_N;

  ensureDir(outDir);

  const { tokenManager, accountId } = await getAuthAndAccount({
    apiKey: opts.apiKey,
    accountId: opts.accountId,
    signal: opts.signal,
    logger: opts.logger,
  });

  let events: unknown[];
  if (Array.isArray(opts.events)) {
    events = opts.events;
    logger.info(`Using ${events.length} events from caller (no fetch).`);
  } else {
    logger.info("No events passed in — fetching event list...");
    const url = `${API_BASE}/accounts/${accountId}/events`;
    events = await paginate(url, tokenManager, {
      top: 100,
      signal: opts.signal,
      logger: opts.logger,
    });
  }
  logger.info(`Will fetch registrations for ${events.length} events.`);

  const partial = loadPartial(partialPath, logger);
  const completed = new Set(partial.completedEventIds.map(String));
  const allRegistrations = partial.registrations as RegistrationWithEvent[];
  const failures = partial.failures;

  if (completed.size) {
    logger.info(
      `Resuming: ${completed.size} events already processed (${allRegistrations.length} registrations cached).`
    );
  }

  opts.onProgress?.({
    kind: "start",
    exporter: "registrations",
    total: events.length,
  });

  let processedSinceSave = 0;

  for (let i = 0; i < events.length; i++) {
    const event = events[i] as Record<string, unknown> | undefined;
    if (!event) continue;
    const id = (event.Id ?? event.id) as string | number | undefined;
    if (!id) continue;
    const idKey = String(id);

    if (completed.has(idKey)) {
      // already done in a previous run
      continue;
    }

    const title = (event.Name ?? event.Title ?? "(untitled)") as string;
    logger.info(`[${i + 1}/${events.length}] event ${id} — ${title}`);

    try {
      const url = `${API_BASE}/accounts/${accountId}/eventregistrations?eventId=${id}&includeDetails=true`;
      const data = await apiGet(url, tokenManager, {
        signal: opts.signal,
        logger: opts.logger,
      });
      const items = Array.isArray(data)
        ? data
        : (data as { Items?: unknown[]; Registrations?: unknown[] })?.Items ||
          (data as { Items?: unknown[]; Registrations?: unknown[] })?.Registrations ||
          [];
      for (const reg of items) {
        const regObj = (reg ?? {}) as Record<string, unknown>;
        allRegistrations.push({
          ...regObj,
          _event: { Id: id, Name: title },
        });
      }
      logger.info(`  ${items.length} registrations`);
      completed.add(idKey);
      partial.completedEventIds.push(idKey);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") throw err;
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`  failed: ${msg.split("\n")[0]}`);
      failures.push({ eventId: id, error: msg });
      // Mark as completed so we don't get stuck retrying the same broken event
      // on every resume. Failures are still tracked in _failures.json.
      completed.add(idKey);
      partial.completedEventIds.push(idKey);
    }

    opts.onProgress?.({
      kind: "step",
      exporter: "registrations",
      index: i + 1,
      total: events.length,
      label: String(id),
    });

    processedSinceSave++;
    if (processedSinceSave >= saveEveryN) {
      savePartial(partial, partialPath);
      processedSinceSave = 0;
    }

    await sleep(requestDelayMs, opts.signal);
  }

  savePartial(partial, partialPath);

  const jsonPath = path.join(outDir, "registrations.json");
  const csvPath = path.join(outDir, "registrations.csv");
  writeJson(allRegistrations, jsonPath);

  const normalized = allRegistrations.map((r) =>
    normalizeRegistration(r, r._event ?? {})
  );
  const columns = [
    "registrationId",
    "eventId",
    "eventTitle",
    "eventStartDate",
    "contactId",
    "firstName",
    "lastName",
    "email",
    "displayName",
    "registrationTypeName",
    "registrationTypeId",
    "isPaid",
    "paidSum",
    "invoiceId",
    "confirmationCode",
    "isCheckedIn",
    "onWaitList",
    "status",
    "memo",
    "createdDate",
  ];
  writeCsv(normalized, columns, csvPath);

  let writtenFailuresPath: string | undefined;
  if (failures.length) {
    writeJson(failures, failuresPath);
    writtenFailuresPath = failuresPath;
    logger.info(`\n${failures.length} events failed — see ${failuresPath}`);
  } else if (fs.existsSync(failuresPath)) {
    fs.unlinkSync(failuresPath);
  }

  if (fs.existsSync(partialPath)) fs.unlinkSync(partialPath);

  logger.info("");
  logger.info("Done.");
  logger.info(`Total registrations: ${allRegistrations.length}`);
  logger.info(`JSON: ${jsonPath}`);
  logger.info(`CSV:  ${csvPath}`);

  opts.onProgress?.({
    kind: "finish",
    exporter: "registrations",
    count: allRegistrations.length,
    failures: failures.length,
  });

  return {
    outDir,
    jsonPath,
    csvPath,
    failuresPath: writtenFailuresPath,
    count: allRegistrations.length,
    failureCount: failures.length,
  };
}
