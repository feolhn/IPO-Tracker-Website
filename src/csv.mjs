export function serializeCsv(rows, header) {
  const cols = header ?? deriveHeader(rows);
  const lines = [cols.map(escapeCell).join(",")];
  for (const row of rows) {
    lines.push(cols.map((key) => escapeCell(row[key] ?? "")).join(","));
  }
  return `${lines.join("\n")}\n`;
}

export function parseCsv(text) {
  const records = parseRecords(text);
  if (!records.length) return { header: [], rows: [] };
  const [header, ...body] = records;
  return {
    header,
    rows: body
      .filter((record) => record.some((value) => value !== ""))
      .map((record) => Object.fromEntries(header.map((key, index) => [key, record[index] ?? ""])))
  };
}

export function deriveHeader(rows) {
  const keys = new Set();
  for (const row of rows) {
    for (const key of Object.keys(row)) keys.add(key);
  }
  return [...keys];
}

function escapeCell(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function parseRecords(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }

  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}
