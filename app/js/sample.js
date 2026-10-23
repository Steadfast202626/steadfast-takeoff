/*
 * Steadfast takeoff: opens the sample job (File menu only). The drawing and the estimate come from
 * sample-plan.js, made by tools/make-sample.js. Made-up prices, never for quoting.
 */
(function () {
  'use strict';

  const calc = window.SteadfastCalc;
  const { ask } = window.SteadfastUI;

  function base64ToBuffer(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }

  // opts.forTour: start with no scale, so the tour's first step is real. Resolves true once open.
  async function open(app, opts) {
    const s = window.SteadfastSample;
    const onSample = window.SteadfastOutputs.isSample(app.est);
    if (app.hasWork() && !onSample && !await ask('Open the sample job? It replaces the job in this browser. Save the current estimate first if you need it.', 'Open sample')) return false;
    const data = base64ToBuffer(s.pdfBase64);
    try {
      await window.SteadfastDrawings.open(s.fileName, 'application/pdf', data);
      await window.SteadfastStorage.putDrawing(s.fileName, 'application/pdf', data).catch(() => null);
    } catch (e) {
      app.setStatus('The sample drawing did not open: ' + e.message, true, 8000);
    }
    const est = calc.clone(s.estimate);
    est.job.date = calc.today();
    if (opts && opts.forTour) for (const sh of est.sheets) { sh.ftPerUnit = null; sh.scaleLabel = ''; sh.scaleSource = ''; }
    app.goto('takeoff');
    app.loadEstimate(est);
    app.setStatus('Sample job opened. Made-up prices, not for quoting.', false, 6000);
    return true;
  }

  window.SteadfastSampleJob = { open };
})();
