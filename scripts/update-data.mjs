import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv, serializeCsv } from "../src/csv.mjs";
import { addDays, maxDate, shanghaiDate, subtractMonths } from "../src/dates.mjs";
import { fetchEastMoneyRecentSources } from "../src/eastmoney.mjs";
import { buildEventHeader, buildEventRows, buildMasterHeader, buildMasterRows } from "../src/ipo-data.mjs";

const LOOKBACK_MONTHS = 3;
const INCREMENTAL_OVERLAP_DAYS = 14;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = resolve(root, "data");
const publicDataDir = resolve(root, "public", "data");
const sourceCsvDir = resolve(dataDir, "sources");
const masterPath = resolve(dataDir, "ipo_master.csv");
const eventsPath = resolve(dataDir, "ipo_events.csv");
const fieldCatalogPath = resolve(dataDir, "field_catalog.csv");
const statePath = resolve(dataDir, "run-state.json");

const args = new Set(process.argv.slice(2));
const today = readArg("--today") ?? process.env.IPO_TRACKER_TODAY ?? shanghaiDate();
const fullSince = subtractMonths(today, LOOKBACK_MONTHS);
const previousState = await readJsonIfExists(statePath);
const forceFull = args.has("--full") || process.env.IPO_FULL_REFRESH === "1";
const explicitSince = readArg("--since");
const incrementalSince = previousState?.market_time ? addDays(previousState.market_time, -INCREMENTAL_OVERLAP_DAYS) : null;
const since = explicitSince ?? (forceFull || !incrementalSince ? fullSince : maxDate(incrementalSince, fullSince));
const queryMode = explicitSince ? "explicit_since" : forceFull || !incrementalSince ? "rolling_3_month" : "incremental_overlap";
const generatedAt = new Date().toISOString();
const runId = `${generatedAt.replaceAll(":", "").replace(/\.\d{3}Z$/, "Z")}-${queryMode}`;

await mkdir(dataDir, { recursive: true });
await mkdir(publicDataDir, { recursive: true });
await mkdir(sourceCsvDir, { recursive: true });

const sources = await fetchEastMoneyRecentSources({ since });
const rawDir = resolve(dataDir, "raw", today, runId);
await mkdir(rawDir, { recursive: true });
await writeFile(resolve(rawDir, "eastmoney_ipo_apply.json"), `${JSON.stringify(sources.ipoApply, null, 2)}\n`);
await writeFile(resolve(rawDir, "eastmoney_bse_issueinfo.json"), `${JSON.stringify(sources.bseIssueInfo, null, 2)}\n`);
await writeSourceCsvs(rawDir, sourceCsvDir, sources);

const existing = await readCsvIfExists(masterPath);
const masterRows = buildMasterRows({
  ipoRows: sources.ipoApply.rows,
  bseRows: sources.bseIssueInfo.rows,
  existingRows: existing.rows,
  generatedAt,
  marketTime: today
});
const masterHeader = buildMasterHeader(masterRows, existing.header);
const eventRows = buildEventRows(masterRows, generatedAt, today);
const fieldCatalogRows = buildFieldCatalogRows(sources, masterHeader, generatedAt, today);

await writeFile(masterPath, serializeCsv(masterRows, masterHeader));
await writeFile(eventsPath, serializeCsv(eventRows, buildEventHeader()));
await writeFile(fieldCatalogPath, serializeCsv(fieldCatalogRows, fieldCatalogHeader()));

const state = {
  ok: true,
  generated_at: generatedAt,
  market_time: today,
  query_window: {
    mode: queryMode,
    apply_date_since: since,
    lookback_months: LOOKBACK_MONTHS,
    incremental_overlap_days: queryMode === "incremental_overlap" ? INCREMENTAL_OVERLAP_DAYS : null,
    previous_market_time: previousState?.market_time ?? null
  },
  sources: {
    ipo_apply: {
      rows: sources.ipoApply.rows.length,
      pages: sources.ipoApply.pages,
      fields: sources.ipoApply.fields.length
    },
    bse_issueinfo: {
      rows: sources.bseIssueInfo.rows.length,
      pages: sources.bseIssueInfo.pages,
      fields: sources.bseIssueInfo.fields.length
    }
  },
  outputs: {
    master_csv: "data/ipo_master.csv",
    master_rows: masterRows.length,
    master_columns: masterHeader.length,
    field_catalog_csv: "data/field_catalog.csv",
    field_catalog_rows: fieldCatalogRows.length,
    source_csvs: [
      "data/sources/eastmoney_ipo_apply_latest.csv",
      "data/sources/eastmoney_bse_issueinfo_latest.csv"
    ],
    events_csv: "data/ipo_events.csv",
    event_rows: eventRows.length,
    raw_dir: `data/raw/${today}/${runId}`
  }
};

await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
await mirrorPublicData({
  masterCsv: serializeCsv(masterRows, masterHeader),
  eventsCsv: serializeCsv(eventRows, buildEventHeader()),
  fieldCatalogCsv: serializeCsv(fieldCatalogRows, fieldCatalogHeader()),
  state
});

console.log(`ok=true`);
console.log(`market_time=${today}`);
console.log(`query_mode=${queryMode}`);
console.log(`apply_date_since=${since}`);
console.log(`ipo_apply_rows=${sources.ipoApply.rows.length}`);
console.log(`ipo_apply_fields=${sources.ipoApply.fields.length}`);
console.log(`bse_issueinfo_rows=${sources.bseIssueInfo.rows.length}`);
console.log(`bse_issueinfo_fields=${sources.bseIssueInfo.fields.length}`);
console.log(`master_rows=${masterRows.length}`);
console.log(`master_columns=${masterHeader.length}`);
console.log(`event_rows=${eventRows.length}`);
console.log(`field_catalog_rows=${fieldCatalogRows.length}`);

function readArg(name) {
  const exact = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (exact) return exact.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  if (index !== -1) return process.argv[index + 1];
  return null;
}

async function readJsonIfExists(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(await readFile(path, "utf8"));
}

async function readCsvIfExists(path) {
  if (!existsSync(path)) return { header: [], rows: [] };
  return parseCsv(await readFile(path, "utf8"));
}

async function writeSourceCsvs(rawDir, latestDir, sources) {
  const sourceDefs = [
    ["eastmoney_ipo_apply", sources.ipoApply],
    ["eastmoney_bse_issueinfo", sources.bseIssueInfo]
  ];
  for (const [name, source] of sourceDefs) {
    const csv = serializeCsv(source.rows, source.fields);
    await writeFile(resolve(rawDir, `${name}.csv`), csv);
    await writeFile(resolve(latestDir, `${name}_latest.csv`), csv);
  }
}

function buildFieldCatalogRows(sources, masterHeader, generatedAt, marketTime) {
  const sourceDefs = [
    ["eastmoney_ipo_apply", "ipo", sources.ipoApply],
    ["eastmoney_bse_issueinfo", "bse", sources.bseIssueInfo]
  ];
  const rows = [];
  for (const [sourceName, prefix, source] of sourceDefs) {
    for (const field of source.fields) {
      const masterColumn = `${prefix}__${field}`;
      rows.push({
        source: sourceName,
        source_field: field,
        raw_csv_column: field,
        master_csv_column: masterColumn,
        in_master_csv: masterHeader.includes(masterColumn) ? "1" : "0",
        generated_at: generatedAt,
        market_time: marketTime
      });
    }
  }
  return rows.sort((a, b) => a.source.localeCompare(b.source) || a.source_field.localeCompare(b.source_field));
}

function fieldCatalogHeader() {
  return [
    "source",
    "source_field",
    "raw_csv_column",
    "master_csv_column",
    "in_master_csv",
    "generated_at",
    "market_time"
  ];
}

async function mirrorPublicData({ masterCsv, eventsCsv, fieldCatalogCsv, state }) {
  await writeFile(resolve(publicDataDir, "ipo_master.csv"), masterCsv);
  await writeFile(resolve(publicDataDir, "ipo_events.csv"), eventsCsv);
  await writeFile(resolve(publicDataDir, "field_catalog.csv"), fieldCatalogCsv);
  await writeFile(resolve(publicDataDir, "run-state.json"), `${JSON.stringify(state, null, 2)}\n`);
}
