// export-contacts.js
// Exports all Wild Apricot contacts (members + non-members) using the async API pattern.

const path = require("path");
const {
  API_BASE,
  apiGet,
  asyncQuery,
  extractItems,
  ensureDir,
  writeJson,
  writeCsv,
  getNested,
  getAuthAndAccount,
} = require("../lib/wa-api");

const OUT_DIR = path.join(process.cwd(), "exports", "contacts");

function flattenFieldValues(contact) {
  const out = {};
  const fieldValues = contact.FieldValues || contact.fieldValues || [];
  for (const fv of fieldValues) {
    const name = fv.FieldName || fv.fieldName;
    let value = fv.Value !== undefined ? fv.Value : fv.value;
    if (Array.isArray(value)) {
      value = value
        .map((v) => (typeof v === "object" ? v.Label || v.Value || JSON.stringify(v) : v))
        .join("; ");
    } else if (value && typeof value === "object") {
      value = value.Label || value.Value || JSON.stringify(value);
    }
    if (name) out[name] = value;
  }
  return out;
}

function normalizeContact(contact) {
  const flat = flattenFieldValues(contact);
  return {
    id: getNested(contact, ["Id", "id"]),
    firstName: getNested(contact, ["FirstName", "firstName"]),
    lastName: getNested(contact, ["LastName", "lastName"]),
    email: getNested(contact, ["Email", "email"]),
    displayName: getNested(contact, ["DisplayName", "displayName"]),
    organization: getNested(contact, ["Organization", "organization"]) || flat["Organization"] || "",
    membershipEnabled: getNested(contact, ["MembershipEnabled", "membershipEnabled"]),
    membershipLevelName:
      getNested(contact, ["MembershipLevel.Name", "membershipLevel.name"]) || "",
    membershipLevelId:
      getNested(contact, ["MembershipLevel.Id", "membershipLevel.id"]) || "",
    status: getNested(contact, ["Status", "status"]),
    isAccountAdministrator: getNested(contact, ["IsAccountAdministrator", "isAccountAdministrator"]),
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

async function main() {
  ensureDir(OUT_DIR);
  const { token, accountId } = await getAuthAndAccount();

  const baseUrl = `${API_BASE}/accounts/${accountId}/contacts`;

  console.log("Fetching contacts via async API (this can take several minutes for large databases)...");
  // includeDetails=true returns custom field values inline
  const result = await asyncQuery(baseUrl, token, { $async: "false", includeDetails: "true" });
  const contacts = extractItems(result, "Contacts");

  console.log(`Got ${contacts.length} contacts.`);

  const jsonPath = path.join(OUT_DIR, "contacts.json");
  const csvPath = path.join(OUT_DIR, "contacts.csv");

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

  console.log("");
  console.log("Done.");
  console.log(`JSON: ${jsonPath}`);
  console.log(`CSV:  ${csvPath}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
