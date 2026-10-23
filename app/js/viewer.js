/*
 * Steadfast takeoff: the drawing viewer. Zoom, pan, measuring, scale calibration and markup editing.
 * Points are stored from 0 to 1 across and down the sheet (docs/estimate-file-format.md).
 */
(function () {
  'use strict';

  const calc = window.SteadfastCalc;
  const Drawings = window.SteadfastDrawings;

  const CLOSE_PX = 10;     // click this near the first point to close an area
  const DRAG_PX = 4;       // movement before a press becomes a drag
  const HANDLE_PX = 8;
  const MIN_POINTS = { area: 3, length: 2, wall: 2, count: 1 };
  const ACCENT = '#53412c';

  function createViewer(canvas, readout, app) {
    const ctx = canvas.getContext('2d');
    const v = {
      zoom: 1, panX: 0, panY: 0,
      tool: 'select',
      draft: null,          // { conditionId, deduct, points: [[x, y]] }
      calib: null,          // [[x, y]] while setting the scale from a dimension
      hover: null,          // [x, y] under the cursor (snapped when Shift is held)
      mouse: null,          // [sx, sy] in CSS pixels
      shift: false,
      sheetId: null,
      fitted: true          // refit when the window changes size until the person zooms or pans
    };
    let down = null;        // the press in progress
    const touches = new Map();
    let pinch = null;
    let frame = 0;
    let dpr = window.devicePixelRatio || 1;

    function sheet() {
      return app.est.sheets.find(s => s.id === v.sheetId) || null;
    }

    // ---------- Coordinates ----------

    function toScreen(p, s) {
      return [p[0] * s.widthPt * v.zoom + v.panX, p[1] * s.heightPt * v.zoom + v.panY];
    }

    function toNorm(sx, sy, s) {
      return [(sx - v.panX) / (v.zoom * s.widthPt), (sy - v.panY) / (v.zoom * s.heightPt)];
    }

    function eventPos(e) {
      const r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    }

    // Shift keeps lines straight: snap to the nearest 45 degrees from the last point.
    function snap(sx, sy, s) {
      const pts = v.draft ? v.draft.points : v.calib;
      if (!v.shift || !pts || !pts.length) return [sx, sy];
      const [lx, ly] = toScreen(pts[pts.length - 1], s);
      const dx = sx - lx, dy = sy - ly;
      const len = Math.hypot(dx, dy);
      const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
      return [lx + len * Math.cos(ang), ly + len * Math.sin(ang)];
    }

    // ---------- View ----------

    function resize() {
      dpr = window.devicePixelRatio || 1;
      const r = canvas.parentElement.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
      canvas.style.width = r.width + 'px';
      canvas.style.height = r.height + 'px';
      if (v.fitted) fit();
      else draw();
    }

    function size() {
      return [canvas.width / dpr, canvas.height / dpr];
    }

    function fit() {
      const s = sheet();
      if (!s) return draw();
      const [w, h] = size();
      v.zoom = Math.min((w - 40) / s.widthPt, (h - 40) / s.heightPt);
      if (!(v.zoom > 0)) v.zoom = 0.1;
      v.panX = (w - s.widthPt * v.zoom) / 2;
      v.panY = (h - s.heightPt * v.zoom) / 2;
      v.fitted = true;
      draw();
    }

    function zoomAt(factor, sx, sy) {
      const s = sheet();
      if (!s) return;
      const [w, h] = size();
      const fitZoom = Math.min(w / s.widthPt, h / s.heightPt);
      const z = Math.min(Math.max(v.zoom * factor, fitZoom * 0.2), 24);
      if (sx === undefined) { sx = w / 2; sy = h / 2; }
      v.panX = sx - (sx - v.panX) * (z / v.zoom);
      v.panY = sy - (sy - v.panY) * (z / v.zoom);
      v.zoom = z;
      v.fitted = false;
      draw();
    }

    function setSheet(id) {
      if (v.sheetId === id) return;
      cancel();
      v.sheetId = id;
      fit();
    }

    // ---------- Tools ----------

    function setTool(tool) {
      cancel();
      v.tool = tool;
      canvas.dataset.tool = tool;
      app.onToolChange(tool);
      draw();
    }

    function cancel() {
      v.draft = null;
      v.calib = null;
      hideReadout();
      draw();
    }

    function dedupe(points, s) {
      const out = [];
      for (const p of points) {
        const last = out[out.length - 1];
        if (last) {
          const a = toScreen(last, s), b = toScreen(p, s);
          if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 3) continue;
        }
        out.push(p);
      }
      return out;
    }

    function finish() {
      const s = sheet();
      if (!v.draft || !s) return;
      const cond = app.est.conditions.find(c => c.id === v.draft.conditionId);
      const points = dedupe(v.draft.points, s);
      // Too few points: keep drawing (a quick click on a shared corner can arrive as a double-click)
      if (cond && points.length < MIN_POINTS[cond.measure]) {
        v.draft.points = points;
        draw();
        return;
      }
      if (cond) {
        const draft = v.draft;
        app.change(est => {
          const id = calc.nextId(est.measurements, 'm');
          est.measurements.push({
            id, conditionId: draft.conditionId, sheetId: s.id,
            points: points.map(p => [calc.round(p[0], 6), calc.round(p[1], 6)]),
            deduct: !!draft.deduct, statedQty: null, note: '',
            source: 'owner', status: 'ok', basis: '', confidence: null
          });
        });
      }
      v.draft = null;
      hideReadout();
      draw();
    }

    function removeLast() {
      const pts = v.draft ? v.draft.points : v.calib;
      if (!pts || !pts.length) return false;
      pts.pop();
      if (!pts.length) { v.draft = null; if (v.calib) v.calib = null; }
      updateReadout();
      draw();
      return true;
    }

    function addPoint(sx, sy) {
      const s = sheet();
      if (!s) return;
      if (v.tool === 'calibrate') {
        const p = toNorm(...snap(sx, sy, s), s);
        v.calib = v.calib || [];
        v.calib.push(p);
        if (v.calib.length === 2) {
          const pts = v.calib;
          v.calib = null;
          draw();
          app.onCalibrated(s, pts[0], pts[1]);
        }
        draw();
        return;
      }
      if (!calc.hasScale(s)) {
        app.needScale(s);
        return;
      }
      const cond = app.activeCondition();
      if (!cond) {
        app.needCondition();
        return;
      }
      if (cond.hidden) app.change(() => { cond.hidden = false; });
      if (!v.draft || v.draft.conditionId !== cond.id) {
        v.draft = { conditionId: cond.id, deduct: app.deduct, points: [] };
      }
      const pts = v.draft.points;
      if (cond.measure === 'area' && pts.length >= 3) {
        const first = toScreen(pts[0], s);
        if (Math.hypot(first[0] - sx, first[1] - sy) <= CLOSE_PX) return finish();
      }
      pts.push(toNorm(...snap(sx, sy, s), s));
      updateReadout();
      draw();
    }

    // ---------- Hit testing ----------

    function distToSegment(p, a, b) {
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const l2 = dx * dx + dy * dy;
      let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
      t = Math.max(0, Math.min(1, t));
      return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
    }

    function inPolygon(p, poly) {
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i], [xj, yj] = poly[j];
        if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    }

    function visibleMeasurements(s) {
      const conds = new Map(app.est.conditions.map(c => [c.id, c]));
      return app.est.measurements
        .filter(m => m.sheetId === s.id && conds.has(m.conditionId) && !conds.get(m.conditionId).hidden)
        .map(m => ({ m, c: conds.get(m.conditionId) }));
    }

    function hitMeasurement(sx, sy, s) {
      const p = [sx, sy];
      const list = visibleMeasurements(s);
      for (let i = list.length - 1; i >= 0; i--) {
        const { m, c } = list[i];
        const pts = m.points.map(q => toScreen(q, s));
        if (c.measure === 'count') {
          if (pts.some(q => Math.hypot(q[0] - sx, q[1] - sy) <= 10)) return m;
          continue;
        }
        const closed = c.measure === 'area';
        for (let k = 1; k < pts.length + (closed ? 1 : 0); k++) {
          if (distToSegment(p, pts[k - 1], pts[k % pts.length]) <= 6) return m;
        }
        if (closed && pts.length > 2 && inPolygon(p, pts)) return m;
      }
      return null;
    }

    function hitHandle(sx, sy, s) {
      const m = app.est.measurements.find(x => x.id === app.selectedId && x.sheetId === s.id);
      if (!m) return null;
      for (let i = m.points.length - 1; i >= 0; i--) {
        const q = toScreen(m.points[i], s);
        if (Math.hypot(q[0] - sx, q[1] - sy) <= HANDLE_PX) return { m, index: i };
      }
      return null;
    }

    // ---------- Pointer input ----------

    canvas.addEventListener('pointerdown', e => {
      canvas.setPointerCapture(e.pointerId);
      const pos = eventPos(e);
      if (e.pointerType === 'touch') {
        touches.set(e.pointerId, pos);
        if (touches.size === 2) {
          const [a, b] = [...touches.values()];
          pinch = { dist: Math.hypot(a[0] - b[0], a[1] - b[1]), mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
          down = null;
          return;
        }
      }
      const s = sheet();
      down = { x: pos[0], y: pos[1], panX: v.panX, panY: v.panY, moved: false, mode: 'click', button: e.button };
      if (!s) return;
      if (e.button === 1) { down.mode = 'pan'; return; }
      if (v.tool === 'select') {
        const h = hitHandle(pos[0], pos[1], s);
        if (h) { down.mode = 'point'; down.handle = h; return; }
        const m = hitMeasurement(pos[0], pos[1], s);
        app.select(m ? m.id : null);
        down.mode = 'pan';
      }
    });

    canvas.addEventListener('pointermove', e => {
      const pos = eventPos(e);
      v.mouse = pos;
      if (pinch && touches.has(e.pointerId)) {
        touches.set(e.pointerId, pos);
        const [a, b] = [...touches.values()];
        const dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
        const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        v.panX += mid[0] - pinch.mid[0];
        v.panY += mid[1] - pinch.mid[1];
        zoomAt(dist / pinch.dist, mid[0], mid[1]);
        pinch = { dist, mid };
        return;
      }
      const s = sheet();
      if (s) v.hover = toNorm(...snap(pos[0], pos[1], s), s);
      if (down) {
        if (!down.moved && Math.hypot(pos[0] - down.x, pos[1] - down.y) > DRAG_PX) {
          down.moved = true;
          if (down.mode === 'click') down.mode = 'pan';
          if (down.mode === 'point') app.beginEdit();
        }
        if (down.moved && down.mode === 'pan') {
          v.fitted = false;
          v.panX = down.panX + pos[0] - down.x;
          v.panY = down.panY + pos[1] - down.y;
        }
        if (down.moved && down.mode === 'point' && s) {
          const [nx, ny] = toNorm(pos[0], pos[1], s);
          down.handle.m.points[down.handle.index] = [calc.round(nx, 6), calc.round(ny, 6)];
          app.liveEdit();
        }
      }
      updateReadout();
      draw();
    });

    function endPress(e) {
      touches.delete(e.pointerId);
      if (pinch) { if (touches.size < 2) pinch = null; down = null; return; }
      if (!down) return;
      const d = down;
      down = null;
      if (d.mode === 'point' && d.moved) { app.endEdit(); return; }
      if (d.mode === 'click' && !d.moved && d.button === 0 && e.type === 'pointerup') {
        if (v.tool === 'measure' || v.tool === 'calibrate') addPoint(d.x, d.y);
      }
    }
    canvas.addEventListener('pointerup', endPress);
    canvas.addEventListener('pointercancel', endPress);

    canvas.addEventListener('pointerleave', () => {
      v.mouse = null;
      v.hover = null;
      hideReadout();
      draw();
    });

    canvas.addEventListener('dblclick', e => {
      e.preventDefault();
      if (v.tool === 'measure') finish();
    });

    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const [sx, sy] = eventPos(e);
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomAt(Math.exp(-delta * 0.0015), sx, sy);
    }, { passive: false });

    canvas.addEventListener('contextmenu', e => e.preventDefault());

    // ---------- Readout ----------

    function hideReadout() {
      readout.hidden = true;
    }

    function updateReadout() {
      const s = sheet();
      if (!s || !v.mouse || (!v.draft && !v.calib)) return hideReadout();
      let text = '';
      if (v.calib && v.calib.length && v.hover) {
        text = 'Click the other end';
      } else if (v.draft) {
        const cond = app.est.conditions.find(c => c.id === v.draft.conditionId);
        if (!cond) return hideReadout();
        const pts = v.hover ? v.draft.points.concat([v.hover]) : v.draft.points;
        const q = calc.measurementQty({ points: pts, deduct: v.draft.deduct }, s, cond);
        text = qtyLabel(q, cond);
      }
      if (!text) return hideReadout();
      readout.textContent = text;
      readout.hidden = false;
      readout.style.left = (v.mouse[0] + 16) + 'px';
      readout.style.top = (v.mouse[1] + 16) + 'px';
    }

    function qtyLabel(q, cond) {
      if (cond.measure === 'count') return calc.fmtQty(q.ea, 'ea').replace('.0 ', ' ');
      if (cond.measure === 'area') return calc.fmtQty(q.sf, 'sf') + ' · ' + calc.fmtQty(q.lf, 'lf');
      if (q.sf !== null) return calc.fmtQty(q.lf, 'lf') + ' · ' + calc.fmtQty(q.sf, 'sf');
      return calc.fmtQty(q.lf, 'lf');
    }

    // ---------- Drawing ----------

    function draw() {
      if (frame) return;
      frame = requestAnimationFrame(render);
    }

    function hatchPattern(color) {
      const c = document.createElement('canvas');
      c.width = c.height = 8;
      const x = c.getContext('2d');
      x.strokeStyle = color;
      x.lineWidth = 1.5;
      x.beginPath();
      x.moveTo(0, 8); x.lineTo(8, 0);
      x.stroke();
      return ctx.createPattern(c, 'repeat');
    }

    function label(text, x, y, color, warn) {
      ctx.font = '600 12px Barlow, Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const w = ctx.measureText(text).width + 10;
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.strokeStyle = warn ? '#c92a2a' : color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.rect(x - w / 2, y - 9, w, 18);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = warn ? '#c92a2a' : '#222';
      ctx.fillText(text, x, y + 0.5);
    }

    function pathFor(pts, closed) {
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      if (closed) ctx.closePath();
    }

    function drawMeasurement(m, c, s, selected) {
      const pts = m.points.map(p => toScreen(p, s));
      if (!pts.length) return;
      const color = c.color || '#1971c2';
      const estimator = m.status === 'check';
      ctx.save();
      ctx.setLineDash(estimator ? [7, 5] : []);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      const q = calc.measurementQty(m, s, c);
      let text = qtyLabel(q, c);
      if (estimator) text = '? ' + text;
      let at;

      if (c.measure === 'count') {
        for (const p of pts) {
          ctx.beginPath();
          ctx.arc(p[0], p[1], 7, 0, Math.PI * 2);
          ctx.fillStyle = m.deduct ? '#fff' : color;
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = m.deduct ? color : '#fff';
          ctx.stroke();
          if (m.deduct) {
            ctx.beginPath();
            ctx.moveTo(p[0] - 4, p[1] - 4); ctx.lineTo(p[0] + 4, p[1] + 4);
            ctx.moveTo(p[0] + 4, p[1] - 4); ctx.lineTo(p[0] - 4, p[1] + 4);
            ctx.stroke();
          }
        }
        const last = pts[pts.length - 1];
        at = [last[0], last[1] - 20];
      } else if (c.measure === 'area') {
        pathFor(pts, true);
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = color;
        ctx.fill();
        ctx.globalAlpha = 1;
        if (m.deduct) {
          ctx.fillStyle = hatchPattern(color);
          ctx.fill();
        }
        ctx.lineWidth = 2;
        ctx.strokeStyle = color;
        ctx.stroke();
        // Label at the centre of the outline
        let ax = 0, ay = 0;
        pts.forEach(p => { ax += p[0]; ay += p[1]; });
        at = [ax / pts.length, ay / pts.length];
      } else {
        pathFor(pts, false);
        ctx.lineWidth = c.measure === 'wall' ? 6 : 3;
        ctx.globalAlpha = c.measure === 'wall' ? 0.6 : 1;
        ctx.strokeStyle = color;
        ctx.stroke();
        ctx.globalAlpha = 1;
        if (m.deduct) {
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = '#fff';
          ctx.stroke();
        }
        let best = 0, bi = 1;
        for (let i = 1; i < pts.length; i++) {
          const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
          if (l > best) { best = l; bi = i; }
        }
        const a = pts[bi - 1] || pts[0], b = pts[bi] || pts[0];
        at = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 14];
      }
      ctx.restore();
      if (app.showLabels) label(text, at[0], at[1], color, q.flagged);

      if (selected) {
        ctx.save();
        for (const p of pts) {
          ctx.fillStyle = '#fff';
          ctx.strokeStyle = ACCENT;
          ctx.lineWidth = 2;
          ctx.fillRect(p[0] - 4.5, p[1] - 4.5, 9, 9);
          ctx.strokeRect(p[0] - 4.5, p[1] - 4.5, 9, 9);
        }
        ctx.restore();
      }
    }

    function drawDraft(s) {
      if (v.draft) {
        const cond = app.est.conditions.find(c => c.id === v.draft.conditionId);
        if (!cond) return;
        const pts = v.draft.points.map(p => toScreen(p, s));
        const color = cond.color;
        ctx.save();
        if (cond.measure === 'count') {
          for (const p of pts) {
            ctx.beginPath();
            ctx.arc(p[0], p[1], 7, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
          }
        } else {
          const all = v.hover ? pts.concat([toScreen(v.hover, s)]) : pts;
          if (cond.measure === 'area' && all.length > 2) {
            pathFor(all, true);
            ctx.globalAlpha = 0.15;
            ctx.fillStyle = color;
            ctx.fill();
            ctx.globalAlpha = 1;
          }
          pathFor(all, false);
          ctx.lineWidth = 2;
          ctx.strokeStyle = color;
          ctx.stroke();
          for (const p of pts) {
            ctx.fillStyle = '#fff';
            ctx.strokeStyle = color;
            ctx.beginPath();
            ctx.arc(p[0], p[1], 3.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }
          if (cond.measure === 'area' && pts.length >= 3 && v.mouse) {
            const f = pts[0];
            if (Math.hypot(f[0] - v.mouse[0], f[1] - v.mouse[1]) <= CLOSE_PX) {
              ctx.beginPath();
              ctx.arc(f[0], f[1], CLOSE_PX, 0, Math.PI * 2);
              ctx.strokeStyle = ACCENT;
              ctx.stroke();
            }
          }
        }
        ctx.restore();
      }
      if (v.calib && v.calib.length) {
        const a = toScreen(v.calib[0], s);
        const b = v.hover ? toScreen(v.hover, s) : a;
        ctx.save();
        ctx.strokeStyle = ACCENT;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
        ctx.restore();
      }
    }

    function render() {
      frame = 0;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const [w, h] = size();
      ctx.fillStyle = '#d9d9d6';
      ctx.fillRect(0, 0, w, h);
      const s = sheet();
      if (!s) return;
      const sw = s.widthPt * v.zoom, sh = s.heightPt * v.zoom;

      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.25)';
      ctx.shadowBlur = 8;
      ctx.fillStyle = '#fff';
      ctx.fillRect(v.panX, v.panY, sw, sh);
      ctx.restore();

      const bmp = Drawings.bitmap(s);
      if (bmp) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bmp.source, v.panX, v.panY, sw, sh);
      } else {
        ctx.fillStyle = '#868e96';
        ctx.font = '16px Barlow, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Drawing not attached: ' + s.file, v.panX + sw / 2, v.panY + sh / 2);
      }
      if (s.kind === 'pdf') Drawings.request(s, v.zoom * dpr, draw);

      for (const { m, c } of visibleMeasurements(s)) drawMeasurement(m, c, s, m.id === app.selectedId);
      drawDraft(s);
    }

    new ResizeObserver(resize).observe(canvas.parentElement);

    return {
      state: v, setSheet, fit, zoomAt, setTool, finish, cancel, removeLast, draw,
      setShift(on) {
        v.shift = on;
        const s = sheet();
        if (s && v.mouse) v.hover = toNorm(...snap(v.mouse[0], v.mouse[1], s), s);
        updateReadout();
        draw();
      },
      drafting() { return !!(v.draft || v.calib); }
    };
  }

  window.createViewer = createViewer;
})();
