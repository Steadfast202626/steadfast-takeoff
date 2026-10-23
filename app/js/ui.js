/*
 * Steadfast takeoff: small DOM helpers shared by the screens.
 */
(function () {
  'use strict';

  // el('button', { textContent: 'Save', title: 'Save the file' }, child, ...)
  function el(tag, attrs, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null) continue;
      if (k === 'dataset') Object.assign(e.dataset, v);
      else if (k === 'style') e.setAttribute('style', v);
      else if (k === 'list') e.setAttribute('list', v);
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e[k] = v;
    }
    for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) e.append(c);
    return e;
  }

  function button(text, title, onclick, cls) {
    return el('button', { type: 'button', textContent: text, title, onclick, className: cls || '' });
  }

  function option(value, text, selected) {
    return el('option', { value, textContent: text, selected: !!selected });
  }

  function select(options, value, onchange, attrs) {
    const s = el('select', attrs || {});
    for (const [v, t] of options) s.appendChild(option(v, t, String(v) === String(value === null || value === undefined ? '' : value)));
    if (onchange) s.addEventListener('change', () => onchange(s.value));
    return s;
  }

  function field(label, input, wide) {
    return el('label', { className: 'field' + (wide ? ' wide' : '') }, label, input);
  }

  function numOrNull(v) {
    if (v === '' || v === null || v === undefined) return null;
    const n = Number(String(v).replace(/[$,\s]/g, ''));
    return isFinite(n) ? n : null;
  }

  // A number input that reports a number or null on change.
  function numInput(value, onchange, attrs) {
    const i = el('input', Object.assign({ type: 'number', step: 'any', value: value === null || value === undefined ? '' : value }, attrs || {}));
    i.addEventListener('change', () => onchange(numOrNull(i.value)));
    return i;
  }

  function textInput(value, onchange, attrs) {
    const i = el('input', Object.assign({ value: value || '' }, attrs || {}));
    i.addEventListener('change', () => onchange(i.value.trim()));
    return i;
  }

  function checkbox(checked, onchange, attrs) {
    const i = el('input', Object.assign({ type: 'checkbox', checked: !!checked }, attrs || {}));
    i.addEventListener('change', () => onchange(i.checked));
    return i;
  }

  // Ask a yes or no question, or for a line of text. Resolves to true, the text, or null.
  function ask(text, okLabel, withInput, value) {
    const d = document.getElementById('askDialog');
    document.getElementById('askText').textContent = text;
    document.getElementById('askOk').textContent = okLabel || 'OK';
    const input = document.getElementById('askInput');
    input.hidden = !withInput;
    input.value = value || '';
    return new Promise(resolve => {
      d.returnValue = '';
      d.addEventListener('close', () => {
        if (d.returnValue !== 'ok') return resolve(null);
        resolve(withInput ? input.value.trim() : true);
      }, { once: true });
      d.showModal();
      if (withInput) input.select();
    });
  }

  // Show some content in the general dialog with buttons: [[label, title, value]]. Resolves to the value.
  function showDialog(title, content, buttons, wide) {
    const d = document.getElementById('infoDialog');
    const body = document.getElementById('infoBody');
    document.getElementById('infoTitle').textContent = title;
    body.innerHTML = '';
    body.append(content);
    const row = document.getElementById('infoButtons');
    row.innerHTML = '';
    row.appendChild(el('span', { className: 'spacer' }));
    d.classList.toggle('wide', !!wide);
    return new Promise(resolve => {
      for (const [label, tip, value, primary] of buttons) {
        row.appendChild(el('button', { type: 'button', textContent: label, title: tip, className: primary ? 'primary' : '',
          onclick: () => { d.close(); resolve(value); } }));
      }
      d.addEventListener('cancel', () => resolve(null), { once: true });
      d.showModal();
    });
  }

  function download(fileName, data, type) {
    const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type: type || 'text/plain' }));
    const a = el('a', { href: url, download: fileName });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function pickFile(accept) {
    return new Promise(resolve => {
      const i = el('input', { type: 'file', accept });
      i.addEventListener('change', () => resolve(i.files[0] || null));
      i.click();
    });
  }

  window.SteadfastUI = { el, button, option, select, field, numOrNull, numInput, textInput, checkbox, ask, showDialog, download, pickFile };
})();
