const EASTMONEY_URL = "https://datacenter-web.eastmoney.com/api/data/v1/get";
const REQUEST_TIMEOUT_MS = 12000;
const PAGE_SIZE = 200;
const MAX_PAGES_PER_SOURCE = 5;

export async function fetchEastMoneyRecentSources({ since }) {
  const [ipoApply, bseIssueInfo] = await Promise.all([
    fetchPagedSource({
      name: "eastmoney_ipo_apply",
      params: {
        sortColumns: "APPLY_DATE,SECURITY_CODE",
        sortTypes: "-1,-1",
        reportName: "RPTA_APP_IPOAPPLY",
        columns: "ALL",
        filter: `(APPLY_DATE>='${since}')`,
        source: "WEB",
        client: "WEB"
      }
    }),
    fetchPagedSource({
      name: "eastmoney_bse_issueinfo",
      params: {
        sortColumns: "APPLY_DATE",
        sortTypes: "-1",
        reportName: "RPT_NEEQ_ISSUEINFO_LIST",
        quoteColumns: "f14~01~SECURITY_CODE~SECURITY_NAME_ABBR",
        columns: "ALL",
        filter: `(APPLY_DATE>='${since}')`,
        source: "NEEQSELECT",
        client: "WEB"
      }
    })
  ]);

  return { ipoApply, bseIssueInfo };
}

async function fetchPagedSource({ name, params }) {
  const first = await fetchPage({ params, pageNumber: 1 });
  assertSourceResponse(name, first);

  const pages = Number(first.result.pages ?? 1);
  if (pages > MAX_PAGES_PER_SOURCE) {
    throw new Error(`${name} returned ${pages} pages, above max ${MAX_PAGES_PER_SOURCE}; refusing broad fetch`);
  }

  const rows = [...first.result.data];
  for (let pageNumber = 2; pageNumber <= pages; pageNumber += 1) {
    const page = await fetchPage({ params, pageNumber });
    assertSourceResponse(name, page);
    rows.push(...page.result.data);
  }

  return {
    name,
    ok: true,
    pages,
    count: Number(first.result.count ?? rows.length),
    rows,
    fields: fieldUnion(rows),
    fetched_at: new Date().toISOString(),
    request: {
      ...params,
      pageSize: String(PAGE_SIZE)
    }
  };
}

async function fetchPage({ params, pageNumber }) {
  const url = new URL(EASTMONEY_URL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("pageSize", String(PAGE_SIZE));
  url.searchParams.set("pageNumber", String(pageNumber));

  const response = await fetch(url, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      "User-Agent": "Mozilla/5.0 IPOTracker/0.1",
      Accept: "application/json,text/plain,*/*"
    }
  });

  if (!response.ok) throw new Error(`EastMoney HTTP ${response.status}`);
  return response.json();
}

function assertSourceResponse(name, value) {
  if (!value?.success || !Array.isArray(value?.result?.data)) {
    throw new Error(`${name} response missing result.data`);
  }
}

function fieldUnion(rows) {
  const fields = new Set();
  for (const row of rows) {
    for (const key of Object.keys(row)) fields.add(key);
  }
  return [...fields].sort();
}
