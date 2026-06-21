import { dateOnly } from "./dates.mjs";

const NORMALIZED_HEADER = [
  "code",
  "secucode",
  "name",
  "name_full",
  "board",
  "market",
  "apply_code",
  "apply_date",
  "ballot_date",
  "pay_date",
  "refund_date",
  "listing_date",
  "issue_price",
  "issue_pe",
  "industry_pe",
  "online_issue_lwr",
  "main_business",
  "recommend_org",
  "underwriter_org",
  "source_presence",
  "first_seen_at",
  "last_seen_at",
  "last_seen_market_time"
];

const EVENT_DEFS = [
  ["review", "审核", ["ipo__REVIEW_DATE"]],
  ["apply", "申购", ["ipo__APPLY_DATE", "bse__APPLY_DATE"]],
  ["online_issue", "网上发行", ["ipo__ONLINE_ISSUE_DATE"]],
  ["offline_placing", "网下配售", ["ipo__OFFLINE_PLACING__DATE"]],
  ["assign", "配号", ["ipo__ASSIGN_DATE"]],
  ["ballot", "中签", ["ipo__BALLOT_NUM_DATE"]],
  ["pay", "缴款", ["ipo__BALLOT_PAY_DATE", "ipo__ONLINE_PAY_DATE", "bse__ONLINE_PAY_DATE"]],
  ["result_notice", "结果公告", ["ipo__RESULT_NOTICE_DATE", "bse__RESULT_NOTICE_DATE"]],
  ["refund", "退款", ["ipo__ONLINE_REFUND_DATE", "bse__ONLINE_REFUND_DATE"]],
  ["listing", "上市", ["ipo__LISTING_DATE", "ipo__SELECT_LISTING_DATE", "bse__SELECT_LISTING_DATE"]]
];

export function buildMasterRows({ ipoRows, bseRows, existingRows, generatedAt, marketTime }) {
  const rowsByCode = new Map();
  for (const row of existingRows) {
    if (row.code) rowsByCode.set(row.code, { ...row });
  }

  const sourceRows = new Map();
  for (const row of ipoRows) addSourceRow(sourceRows, row.SECURITY_CODE, "ipo", row);
  for (const row of bseRows) addSourceRow(sourceRows, row.SECURITY_CODE, "bse", row);

  for (const [code, sources] of sourceRows) {
    const existing = rowsByCode.get(code) ?? {};
    const next = mergeNonEmpty(existing, buildWideRow({ code, sources, existing, generatedAt, marketTime }));
    rowsByCode.set(code, next);
  }

  return [...rowsByCode.values()].sort((a, b) => {
    const byApply = String(b.apply_date ?? "").localeCompare(String(a.apply_date ?? ""));
    if (byApply) return byApply;
    return String(a.code ?? "").localeCompare(String(b.code ?? ""));
  });
}

export function buildMasterHeader(rows, existingHeader = []) {
  const keys = new Set([...NORMALIZED_HEADER, ...existingHeader]);
  for (const row of rows) {
    for (const key of Object.keys(row)) keys.add(key);
  }
  const raw = [...keys].filter((key) => !NORMALIZED_HEADER.includes(key)).sort();
  return [...NORMALIZED_HEADER, ...raw];
}

export function buildEventRows(masterRows, generatedAt, marketTime) {
  const events = [];
  for (const row of masterRows) {
    const seen = new Set();
    for (const [type, label, fields] of EVENT_DEFS) {
      for (const field of fields) {
        const eventDate = dateOnly(row[field]);
        if (!eventDate) continue;
        const key = `${row.code}:${type}:${eventDate}`;
        if (seen.has(key)) continue;
        seen.add(key);
        events.push({
          event_id: `${row.code}-${type}-${eventDate}`,
          code: row.code,
          secucode: row.secuCode || row.secucode || "",
          name: row.name,
          board: row.board,
          event_type: type,
          event_label: label,
          event_date: eventDate,
          source_field: field,
          generated_at: generatedAt,
          market_time: marketTime
        });
      }
    }
  }
  return events.sort((a, b) => {
    const byDate = String(a.event_date).localeCompare(String(b.event_date));
    if (byDate) return byDate;
    return String(a.code).localeCompare(String(b.code)) || String(a.event_type).localeCompare(String(b.event_type));
  });
}

export function buildEventHeader() {
  return [
    "event_id",
    "code",
    "secucode",
    "name",
    "board",
    "event_type",
    "event_label",
    "event_date",
    "source_field",
    "generated_at",
    "market_time"
  ];
}

function addSourceRow(map, codeValue, sourceName, row) {
  const code = String(codeValue ?? "").trim();
  if (!code) return;
  if (!map.has(code)) map.set(code, {});
  map.get(code)[sourceName] = row;
}

function buildWideRow({ code, sources, existing, generatedAt, marketTime }) {
  const ipo = sources.ipo ?? {};
  const bse = sources.bse ?? {};
  const sourcePresence = [
    sources.ipo ? "ipo_apply" : "",
    sources.bse ? "bse_issueinfo" : ""
  ].filter(Boolean).join("|");

  return {
    code,
    secucode: firstText(ipo.SECUCODE, bse.SECUCODE, existing.secucode),
    name: firstText(ipo.SECURITY_NAME, ipo.SECURITY_NAME_ABBR, bse.SECURITY_NAME_ABBR, existing.name),
    name_full: firstText(ipo.SECURITY_NAME_FULL, existing.name_full),
    board: classifyBoard(code, firstText(ipo.MARKET, ipo.MARKET_TYPE_NEW, ipo.MARKET_TYPE, bse.SECUCODE)),
    market: firstText(ipo.MARKET, ipo.TRADE_MARKET, ipo.MARKET_TYPE_NEW, existing.market),
    apply_code: firstText(ipo.APPLY_CODE, bse.APPLY_CODE, existing.apply_code),
    apply_date: dateOnly(firstText(ipo.APPLY_DATE, bse.APPLY_DATE, existing.apply_date)),
    ballot_date: dateOnly(firstText(ipo.BALLOT_NUM_DATE, existing.ballot_date)),
    pay_date: dateOnly(firstText(ipo.BALLOT_PAY_DATE, ipo.ONLINE_PAY_DATE, bse.ONLINE_PAY_DATE, existing.pay_date)),
    refund_date: dateOnly(firstText(ipo.ONLINE_REFUND_DATE, bse.ONLINE_REFUND_DATE, existing.refund_date)),
    listing_date: dateOnly(firstText(ipo.LISTING_DATE, ipo.SELECT_LISTING_DATE, bse.SELECT_LISTING_DATE, existing.listing_date)),
    issue_price: firstText(ipo.ISSUE_PRICE, bse.ISSUE_PRICE, existing.issue_price),
    issue_pe: firstText(ipo.AFTER_ISSUE_PE, bse.ISSUE_PE_RATIO, existing.issue_pe),
    industry_pe: firstText(ipo.INDUSTRY_PE_NEW, ipo.INDUSTRY_PE, bse.INDUSTRY_PE_RATIO, existing.industry_pe),
    online_issue_lwr: firstText(ipo.ONLINE_ISSUE_LWR, bse.ONLINE_ISSUE_LWR, existing.online_issue_lwr),
    main_business: firstText(ipo.MAIN_BUSINESS, bse.MAIN_BUSINESS, existing.main_business),
    recommend_org: firstText(ipo.RECOMMEND_ORG, existing.recommend_org),
    underwriter_org: firstText(ipo.UNDERWRITER_ORG, existing.underwriter_org),
    source_presence: mergePresence(existing.source_presence, sourcePresence),
    first_seen_at: existing.first_seen_at || generatedAt,
    last_seen_at: generatedAt,
    last_seen_market_time: marketTime,
    ...prefixFields("ipo", ipo),
    ...prefixFields("bse", bse)
  };
}

function prefixFields(prefix, row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [`${prefix}__${key}`, cellValue(value)]));
}

function mergeNonEmpty(existing, next) {
  const merged = { ...existing };
  for (const [key, value] of Object.entries(next)) {
    if (value !== "" && value != null) merged[key] = value;
    else if (!(key in merged)) merged[key] = "";
  }
  return merged;
}

function firstText(...values) {
  for (const value of values) {
    if (value !== "" && value != null) return cellValue(value);
  }
  return "";
}

function cellValue(value) {
  if (value == null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function mergePresence(previous, current) {
  const values = new Set(String(previous ?? "").split("|").filter(Boolean));
  for (const value of String(current ?? "").split("|").filter(Boolean)) values.add(value);
  return [...values].sort().join("|");
}

function classifyBoard(code, rawText) {
  const raw = String(rawText ?? "");
  if (/^(8|4|920)/.test(code) || raw.includes("北交")) return "bse";
  if (/^(688|689)/.test(code) || raw.includes("科创")) return "kcb";
  if (/^30/.test(code) || raw.includes("创业")) return "cyb";
  return "main";
}
