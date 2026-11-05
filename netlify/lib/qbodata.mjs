/*
 * Steadfast takeoff: reading QuickBooks Online. Bills, purchases (expenses and cheques), vendors, items
 * and projects. Read only: every call here is a GET to the query endpoint. Nothing is ever written.
 *
 * Matching a QuickBooks line to a price book code, in this order:
 *   1. the QuickBooks item's SKU is the code (09-LVP)
 *   2. the item's name or the line's description starts with or contains the code in brackets or alone
 *   3. the item's name is the price book item's name
 * Unit prices are compared in the price book's own unit, so the QuickBooks item must be bought in it.
 */
import * as Q from './qbo.mjs';

const MINOR_VERSION = 75;
const PAGE = 1000;

export class QboError extends Error {}

// One read from the QuickBooks query endpoint, all pages. GET only.
export async function query(env, store, sql, fetchFn = fetch, now = Date.now()) {
  const record = await Q.accessToken(env, store, fetchFn, now);
  if (!record) throw new QboError('QuickBooks is not connected. Connect it from the Price book screen.');
  const cfg = Q.config(env);
  const out = [];
  for (let start = 1; start < 100000; start += PAGE) {
    const q = sql + ' STARTPOSITION ' + start + ' MAXRESULTS ' + PAGE;
    const url = cfg.apiBase + '/v3/company/' + encodeURIComponent(record.realmId) + '/query?minorversion=' + MINOR_VERSION + '&query=' + encodeURIComponent(q);
    const res = await fetchFn(url, { method: 'GET', headers: { authorization: 'Bearer ' + record.accessToken, accept: 'application/json' } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const f = data.Fault && data.Fault.Error && data.Fault.Error[0];
      throw new QboError('QuickBooks said: ' + (f ? f.Message + (f.Detail ? ' (' + f.Detail + ')' : '') : 'HTTP ' + res.status));
    }
    const qr = data.QueryResponse || {};
    const key = Object.keys(qr).find(k => Array.isArray(qr[k]));
    const rows = key ? qr[key] : [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

const day = (now, back) => new Date(now - back * 86400000).toISOString().slice(0, 10);

export async function items(env, store, fetchFn, now) {
  return query(env, store, 'select Id, Name, Sku, FullyQualifiedName from Item', fetchFn, now);
}

export async function bills(env, store, sinceDays, fetchFn, now = Date.now()) {
  return query(env, store, "select * from Bill where TxnDate >= '" + day(now, sinceDays) + "'", fetchFn, now);
}

export async function purchases(env, store, sinceDays, fetchFn, now = Date.now()) {
  return query(env, store, "select * from Purchase where TxnDate >= '" + day(now, sinceDays) + "'", fetchFn, now);
}

export async function projects(env, store, fetchFn, now) {
  const rows = await query(env, store, 'select Id, DisplayName, FullyQualifiedName, Job, IsProject, Active from Customer', fetchFn, now);
  return rows.filter(c => c.Active !== false && (c.IsProject || c.Job))
    .map(c => ({ id: String(c.Id), name: c.DisplayName, fullName: c.FullyQualifiedName || c.DisplayName }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}

// ---------- Matching ----------

const CODE_RE = /\b(\d{2}-[A-Z0-9]{2,6})\b/;

export function codeFromText(text, codes) {
  const m = String(text || '').toUpperCase().match(new RegExp(CODE_RE.source, 'g')) || [];
  return m.find(c => codes.has(c)) || null;
}

// A matcher from QuickBooks lines to price book codes. book: [{ code, name }]; qboItems: QuickBooks items.
export function matcher(book, qboItems) {
  const codes = new Set(book.map(b => String(b.code).toUpperCase()));
  const byName = new Map(book.map(b => [String(b.name || '').trim().toLowerCase(), String(b.code).toUpperCase()]));
  const itemCode = new Map();
  for (const it of qboItems || []) {
    const sku = String(it.Sku || '').trim().toUpperCase();
    const code = (codes.has(sku) && sku) || codeFromText(it.Name, codes) || codeFromText(it.FullyQualifiedName, codes) ||
      byName.get(String(it.Name || '').trim().toLowerCase()) || null;
    if (code) itemCode.set(String(it.Id), code);
  }
  return function match(line) {
    const d = line.ItemBasedExpenseLineDetail;
    if (d && d.ItemRef && itemCode.has(String(d.ItemRef.value))) return itemCode.get(String(d.ItemRef.value));
    if (d && d.ItemRef) {
      const c = codeFromText(d.ItemRef.name, codes) || byName.get(String(d.ItemRef.name || '').trim().toLowerCase());
      if (c) return c;
    }
    return codeFromText(line.Description, codes);
  };
}

// The cost lines of a bill or purchase, flattened: { code, unitPrice, qty, amount, customerId, description }.
export function costLines(txn, match) {
  const out = [];
  for (const line of txn.Line || []) {
    const item = line.ItemBasedExpenseLineDetail;
    const acct = line.AccountBasedExpenseLineDetail;
    if (!item && !acct) continue;
    const detail = item || acct;
    out.push({
      code: match ? match(line) : null,
      unitPrice: item && typeof item.UnitPrice === 'number' ? item.UnitPrice : null,
      qty: item && typeof item.Qty === 'number' ? item.Qty : null,
      amount: typeof line.Amount === 'number' ? line.Amount : 0,
      customerId: detail.CustomerRef ? String(detail.CustomerRef.value) : null,
      description: line.Description || (item && item.ItemRef ? item.ItemRef.name : '') || ''
    });
  }
  return out;
}

export function txnLabel(txn, kind) {
  const who = (txn.VendorRef && txn.VendorRef.name) || (txn.EntityRef && txn.EntityRef.name) || 'unknown vendor';
  return (kind === 'Bill' ? 'Bill' : 'Expense') + (txn.DocNumber ? ' ' + txn.DocNumber : '') + ', ' + who + ', ' + (txn.TxnDate || '');
}
