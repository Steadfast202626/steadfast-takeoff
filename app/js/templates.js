/*
 * Steadfast takeoff: room templates. A template adds a room with its floor, wall, ceiling and base
 * build-ups, and lines for the items that go in that kind of room (fixtures, devices, lights, doors,
 * cabinets), so Kamal only measures. Costs come from the build-ups and the price book, never from here.
 * The counts are starting points for Kamal to confirm on each job.
 * Works in the browser (SteadfastTemplates) and in Node (require), so the tests can use it.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./calc.js'));
  else root.SteadfastTemplates = factory(root.SteadfastCalc);
})(typeof self !== 'undefined' ? self : this, function (calc) {
  'use strict';

  // finishes: build-up names for floor, walls, ceiling and base (null for none).
  // items: build-ups added as lines, with a starting quantity per room.
  const TEMPLATES = [
    {
      id: 'commercial-washroom', name: 'Commercial washroom', type: 'commercial', heightFt: 9, doors: 1, windows: 0,
      finishes: { floor: 'Floor tile', walls: 'Paint walls, 2 coats', ceiling: 'T-bar ceiling 2x4', base: null },
      items: [
        { assembly: 'Plumbing fixture', qty: 3, label: 'Plumbing fixtures (toilet, urinal, sink)' },
        { assembly: 'Electrical device', qty: 2, label: 'Receptacles and switches' },
        { assembly: 'Pot light', qty: 4, label: 'Pot lights' }
      ]
    },
    {
      id: 'staff-kitchen', name: 'Staff kitchen', type: 'commercial', heightFt: 9, doors: 1, windows: 0,
      finishes: { floor: 'VCT or sheet vinyl', walls: 'Paint walls, 2 coats', ceiling: 'T-bar ceiling 2x4', base: 'Rubber base 4"' },
      items: [
        { assembly: 'Kitchen cabinets, base and upper, with countertop', qty: 12, label: 'Cabinets and countertop' },
        { assembly: 'Plumbing fixture', qty: 1, label: 'Kitchen sink' },
        { assembly: 'Electrical device', qty: 6, label: 'Receptacles and switches' },
        { assembly: 'Pot light', qty: 4, label: 'Pot lights' }
      ]
    },
    {
      id: 'basement', name: 'Basement', type: 'residential', heightFt: 8, doors: 2, windows: 2,
      finishes: { floor: 'LVP flooring with underlay', walls: 'Basement exterior wall, 2x4, batt, poly, drywall one side', ceiling: 'Drywall ceiling', base: 'Baseboard, MDF, painted' },
      items: [
        { assembly: 'Interior door, prehung, cased both sides', qty: 2, label: 'Interior doors' },
        { assembly: 'Electrical device', qty: 10, label: 'Receptacles and switches' },
        { assembly: 'Pot light', qty: 12, label: 'Pot lights' }
      ]
    },
    {
      id: 'bathroom', name: 'Bathroom', type: 'residential', heightFt: 8, doors: 1, windows: 0,
      finishes: { floor: 'Floor tile', walls: 'Paint walls, 2 coats', ceiling: 'Paint ceiling', base: 'Baseboard, MDF, painted' },
      items: [
        { assembly: 'Plumbing fixture', qty: 3, label: 'Plumbing fixtures (toilet, vanity, tub or shower)' },
        { assembly: 'Electrical device', qty: 3, label: 'Receptacles, switches and fan' },
        { assembly: 'Pot light', qty: 2, label: 'Pot lights' }
      ]
    },
    {
      id: 'kitchen', name: 'Kitchen', type: 'residential', heightFt: 8, doors: 0, windows: 1,
      finishes: { floor: 'LVP flooring with underlay', walls: 'Paint walls, 2 coats', ceiling: 'Paint ceiling', base: 'Baseboard, MDF, painted' },
      items: [
        { assembly: 'Remove cabinets', qty: 16, label: 'Remove old cabinets' },
        { assembly: 'Kitchen cabinets, base and upper, with countertop', qty: 16, label: 'Cabinets and countertop' },
        { assembly: 'Plumbing fixture', qty: 2, label: 'Sink and dishwasher' },
        { assembly: 'Electrical device', qty: 8, label: 'Receptacles and switches' },
        { assembly: 'Pot light', qty: 6, label: 'Pot lights' }
      ]
    }
  ];

  const UNIT = { count: 'ea', length: 'lf', area: 'sf', wall: 'lf' };
  const PER = { count: 'ea', length: 'lf', area: 'sf', wall: 'lf' };

  function findAssembly(est, name) {
    return est.assemblies.find(a => calc.sameText(a.name, name)) || null;
  }

  // The price book type that carries most of a build-up's cost, so the line lands in the right column.
  function mainType(est, assembly) {
    const byType = {};
    for (const item of assembly.items) {
      const pb = est.priceBook.find(p => p.code === item.code);
      if (!pb) continue;
      const cost = typeof pb.unitCost === 'number' ? pb.unitCost * (item.qtyPerUnit || 0) : 0;
      byType[pb.type] = (byType[pb.type] || 0) + cost + 1e-9; // a type with no cost yet still counts
    }
    const best = Object.entries(byType).sort((a, b) => b[1] - a[1])[0];
    return best ? best[0] : 'S';
  }

  // Cost of one unit of a build-up from today's price book: null if any item has no cost yet.
  function unitCost(est, assembly) {
    const u = calc.assemblyUnitCost(est, assembly);
    if (u.missing) return null;
    return calc.round2(u[PER[assembly.measure] || 'ea']);
  }

  /*
   * Add a room from a template. opts: { name, location, lengthFt, widthFt, heightFt, doors, windows,
   * quantities: { [index]: qty }, alternateId }. Returns { roomId, lines: [ids], skipped: [text] }.
   * Changes est in place; the caller wraps it in app.change so it can be undone.
   */
  function addRoom(est, template, opts) {
    opts = opts || {};
    const skipped = [];
    const finishId = name => {
      if (!name) return null;
      const a = findAssembly(est, name);
      if (!a) skipped.push('Build-up "' + name + '" is not in this job, so that finish is left empty.');
      return a ? a.id : null;
    };
    const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
    const room = {
      id: calc.nextId(est.rooms, 'r'),
      name: opts.name || template.name,
      location: opts.location || '',
      lengthFt: num(opts.lengthFt, null), widthFt: num(opts.widthFt, null), heightFt: num(opts.heightFt, template.heightFt),
      areaSf: null, perimeterLf: null,
      doors: num(opts.doors, template.doors), windows: num(opts.windows, template.windows),
      floorAssemblyId: finishId(template.finishes.floor),
      wallAssemblyId: finishId(template.finishes.walls),
      ceilingAssemblyId: finishId(template.finishes.ceiling),
      baseAssemblyId: finishId(template.finishes.base),
      alternateId: opts.alternateId || null, measurementId: null,
      source: 'owner', status: 'ok', basis: 'Room template: ' + template.name
    };
    est.rooms.push(room);

    const lines = [];
    template.items.forEach((it, i) => {
      const a = findAssembly(est, it.assembly);
      if (!a) { skipped.push('Build-up "' + it.assembly + '" is not in this job, so ' + it.label.toLowerCase() + ' were not added.'); return; }
      const q = opts.quantities && typeof opts.quantities[i] === 'number' ? opts.quantities[i] : it.qty;
      if (!(q > 0)) return;
      const line = {
        id: calc.nextId(est.lines, 'l'),
        division: a.division || '01',
        description: it.label,
        scope: a.name,
        location: room.name,
        qty: q,
        unit: UNIT[a.measure] || 'ea',
        unitCost: unitCost(est, a),
        type: mainType(est, a),
        allowance: false,
        alternateId: room.alternateId,
        source: 'owner', status: 'ok',
        basis: 'Room template: ' + template.name + ', ' + a.name + ' from the price book'
      };
      est.lines.push(line);
      lines.push(line.id);
    });
    return { roomId: room.id, lines, skipped };
  }

  // Price template lines that still have no cost, from today's price book. A line that already
  // has a cost is never touched, so a price someone typed stays. Returns how many were priced.
  function refreshLines(est) {
    let changed = 0;
    for (const l of est.lines) {
      if (!/^Room template: /.test(l.basis || '') || l.unitCost !== null) continue;
      const a = findAssembly(est, l.scope);
      const cost = a ? unitCost(est, a) : null;
      if (cost === null) continue;
      l.unitCost = cost;
      changed++;
    }
    return changed;
  }

  return { TEMPLATES, addRoom, refreshLines, findAssembly, unitCost };
});
