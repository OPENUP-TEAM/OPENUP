/**
 * One export path for every report.
 *
 * Four modules in Table 8 list "Export Report" as a sub-function. Written
 * four times that is four CSV serialisers, four sets of quoting bugs, and
 * four different ways of handling a comma in a barangay name. This is the
 * only place a report becomes a file.
 *
 * CSV rather than PDF, deliberately. An LGU takes a report to a budget
 * meeting, and what they actually do with it is open it in Excel and add
 * a column. A server-generated PDF is harder to produce, needs another
 * dependency, and is worse for the person receiving it. Printable
 * documents are handled by a print stylesheet on the report screen, which
 * gives a PDF through the browser without either problem.
 */

/**
 * Excel on a Philippine Windows install often uses a semicolon as the list
 * separator, and opens a comma-delimited file as one column. A BOM makes
 * Excel detect UTF-8 so peso signs and Bisaya text are not mangled.
 */
const BOM = '\uFEFF';

/** RFC 4180 quoting: wrap when the value contains a delimiter, quote or newline. */
function cell(value) {
  if (value === null || value === undefined) return '';

  if (value instanceof Date) return value.toISOString();

  if (typeof value === 'object') return JSON.stringify(value).replace(/"/g, '""');

  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * @param {Array<object>} rows
 * @param {Array<{key: string, label: string}>} columns
 *        Explicit columns so a report has stable headings in a readable
 *        order, rather than whatever order the SQL happened to return.
 */
export function toCsv(rows, columns) {
  const header = columns.map((c) => cell(c.label)).join(',');
  const body = rows.map((r) =>
    columns.map((c) => cell(r[c.key])).join(',')
  );
  return BOM + [header, ...body].join('\r\n') + '\r\n';
}

/**
 * Report metadata as leading lines, so a file sitting in someone's
 * Downloads folder in three months still says what it is and when it was
 * taken. A report without a period is a number nobody can check.
 */
export function withHeader(csv, meta) {
  const lines = Object.entries(meta)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${cell(k.replace(/_/g, ' '))},${cell(v)}`);
  return BOM + lines.join('\r\n') + '\r\n\r\n' + csv.replace(BOM, '');
}

/** Safe, dated filename. */
export function filename(base, period) {
  const safe = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const stamp = period
    ? `${period.from ?? ''}_${period.to ?? ''}`.replace(/[^0-9_-]/g, '')
    : new Date().toISOString().slice(0, 10);
  return `openup-${safe}-${stamp}.csv`;
}

/**
 * Send a CSV as a download.
 *
 * Content-Disposition attachment rather than inline: a browser rendering a
 * CSV as text in a tab is not what anyone clicking "Export" wanted.
 */
export function sendCsv(res, { rows, columns, name, meta, period }) {
  let csv = toCsv(rows, columns);
  if (meta) csv = withHeader(csv, meta);

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename(name, period)}"`);
  // Reports are point-in-time; a cached copy would quietly go stale.
  res.setHeader('Cache-Control', 'no-store');
  res.send(csv);
}

/** Period parsing shared by every report, with a sane default. */
export function resolvePeriod(query, defaultDays = 30) {
  const to = query.to ? new Date(query.to) : new Date();
  const from = query.from
    ? new Date(query.from)
    : new Date(to.getTime() - defaultDays * 86_400_000);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()))
    throw new Error('Those dates are not valid.');
  if (from > to)
    throw new Error('The start date is after the end date.');

  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}
