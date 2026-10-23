/*
 * Steadfast takeoff: the company library kept in this browser, separate from any job.
 * The price book comes from the Monday.com Price book board export; the starter list is only the
 * fallback before the first import. Assemblies start from the starter list.
 */
(function () {
  'use strict';

  const calc = window.SteadfastCalc;
  const KEY = 'steadfast-takeoff.library';
  const STALE_DAYS = 30;

  function starter() {
    const s = window.SteadfastStarter;
    return {
      priceBook: calc.priceBookFromRows(calc.parseCsv(s.priceBookCsv)).items,
      assemblies: calc.assembliesFromRows(calc.parseCsv(s.assembliesCsv))
    };
  }

  function stored() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null') || {}; } catch (e) { return {}; }
  }

  function save(lib) {
    try { localStorage.setItem(KEY, JSON.stringify(lib)); return true; } catch (e) { return false; }
  }

  // { priceBook, assemblies, importedAt, importFile, fromStarter }
  function get() {
    const s = stored();
    const base = starter();
    return {
      priceBook: s.priceBook || base.priceBook,
      assemblies: s.assemblies || base.assemblies,
      importedAt: s.importedAt || '',
      importFile: s.importFile || '',
      fromStarter: !s.priceBook
    };
  }

  function setPriceBook(items, fileName) {
    const s = stored();
    s.priceBook = items;
    s.importedAt = calc.today();
    s.importFile = fileName || '';
    return save(s);
  }

  function setAssemblies(assemblies) {
    const s = stored();
    s.assemblies = assemblies;
    return save(s);
  }

  function daysSince(date) {
    if (!date) return null;
    const ms = new Date(calc.today() + 'T00:00:00') - new Date(date + 'T00:00:00');
    return Math.round(ms / 86400000);
  }

  // Read a Monday.com export (Excel or CSV) into price book items.
  async function readExport(file) {
    let rows;
    if (/\.xlsx$/i.test(file.name)) rows = await window.SteadfastXlsx.readXlsx(await file.arrayBuffer());
    else if (/\.xls$/i.test(file.name)) throw new Error('Old .xls files are not supported. Export as .xlsx or CSV.');
    else rows = calc.parseCsv(await file.text());
    return calc.priceBookFromRows(rows);
  }

  window.SteadfastLibrary = { get, setPriceBook, setAssemblies, daysSince, readExport, starter, STALE_DAYS };
})();
