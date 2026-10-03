// ── Picking & Packing — TikTok Shop ─────────────────────────────
// Standalone page (picking.html). Reuses the main app's Supabase project
// and the same localStorage session token ('sb_token') so a logged-in
// admin doesn't have to log in twice — see checkAuthGate() below.

const SUPABASE_URL = 'https://qyejhtyryweesbsiwpxn.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5ZWpodHlyeXdlZXNic2l3cHhuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4MTg3MDIsImV4cCI6MjA5NDM5NDcwMn0.fKedoQ-VhAq2NFRp0WA_Ldbomqy9M5jrVY9fWb0SaIc';

if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
}

// Demo barcodes for testing without the tiktok_skus table populated yet.
// Checked first, before Supabase, so the demo always works offline from the
// database. Once a SKU is in Supabase (via the auto-registration flow or
// entered by hand), that takes over — see resolveSku().
const DEMO_BARCODES = [
  // Producto individual — Developer 20 Vol
  {
    tiktok_sku: 'Kuul Color Cream Developer ( peroxide ) Change Me Color System. / 10, 20, 30 & 40 Volume. 4.5 FL oz. Ea 20 Volume',
    barcode: '7501438303594',
    product_name: 'Kuul Developer 20 Vol 4.5 oz',
    is_set: false
  },
  // Set — Kit Red Violet 30 Vol (2 componentes a escanear por separado)
  {
    tiktok_sku: 'Kuul Hair Color Kit with Developer Included - 90Ml Coconut Oil Formula for Vibrant Tones Red Violet Reflects, 30 Vol',
    barcode: '7501438303709',
    product_name: 'Kuul Developer 30 Vol 4.5 oz',
    is_set: true,
    set_parent_sku: 'Kuul Hair Color Kit with Developer Included - 90Ml Coconut Oil Formula for Vibrant Tones Red Violet Reflects, 30 Vol'
  },
  {
    tiktok_sku: 'Kuul Hair Color Kit with Developer Included - 90Ml Coconut Oil Formula for Vibrant Tones Red Violet Reflects, 30 Vol',
    barcode: '7501438303600',
    product_name: 'Kuul Color Red Violet 90ml',
    is_set: true,
    set_parent_sku: 'Kuul Hair Color Kit with Developer Included - 90Ml Coconut Oil Formula for Vibrant Tones Red Violet Reflects, 30 Vol'
  },
  // Producto individual — Reflects Red
  {
    tiktok_sku: 'Kuul Reflects Professional Hair Color Cream - 90ml Permanent Color - No Bleaching Needed Red - Reflects',
    barcode: '7501438303693',
    product_name: 'Kuul Reflects Red 90ml',
    is_set: false
  }
];

// ── State ────────────────────────────────────────────────────
let pdfDoc = null;              // pdf.js document proxy for the uploaded file
let orders = [];                // [{ index, labelPageNum, slipPageNum, orderId, tracking, rawText, lines, complete }]
let currentOrderIdx = -1;
const skuCache = new Map();     // tiktok_sku -> [{ barcode, product_name, is_set }]
let pendingRegistration = null; // { tiktokSku, collected: [barcode,...] } while registering a new SKU
let currentLabelDataUrl = null; // last rendered label image, used by the print modal

// ── Supabase (same project/anon key as the main app) ────────────
async function supabase(path, options = {}) {
  const sessionToken = localStorage.getItem('sb_token') || SUPABASE_KEY;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${sessionToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  if (!res.ok) throw new Error(await res.text());
  return res.status === 204 ? null : res.json();
}

function checkAuthGate() {
  const hasToken = !!localStorage.getItem('sb_token');
  document.getElementById('pk-auth-gate').style.display = hasToken ? 'none' : 'flex';
  document.getElementById('pk-app').style.display = hasToken ? 'block' : 'none';
  return hasToken;
}

// ── Toast / scan feedback ────────────────────────────────────
function showToast(msg, dur = 2500) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), dur);
}

function flashScanResult(ok) {
  const input = document.getElementById('pk-scan-input');
  input.classList.remove('pk-flash-ok', 'pk-flash-err');
  void input.offsetWidth; // restart the CSS animation
  input.classList.add(ok ? 'pk-flash-ok' : 'pk-flash-err');
  if (ok) showToast('✅ Escaneado correctamente');
}

function focusScanInput() {
  const input = document.getElementById('pk-scan-input');
  if (input) setTimeout(() => input.focus(), 50);
}

// ── PDF upload & parsing ─────────────────────────────────────
async function handleFileUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  const statusEl = document.getElementById('pk-upload-status');
  statusEl.textContent = 'Leyendo PDF...';

  try {
    const buf = await file.arrayBuffer();
    pdfDoc = await pdfjsLib.getDocument({ data: buf }).promise;
    const totalPages = pdfDoc.numPages;

    if (totalPages % 2 !== 0) {
      statusEl.textContent = `⚠️ El PDF tiene ${totalPages} páginas (número impar) — se esperan pares de etiqueta + packing slip. Revisa el archivo; se procesarán los pares completos que haya.`;
    }

    orders = [];
    for (let labelPage = 1; labelPage < totalPages; labelPage += 2) {
      const slipPage = labelPage + 1;
      const parsed = await parsePackingSlipPage(slipPage);
      orders.push({
        index: orders.length,
        labelPageNum: labelPage,
        slipPageNum: slipPage,
        orderId: parsed.orderId,
        tracking: parsed.tracking,
        rawText: parsed.rawText,
        lines: parsed.lines,
        complete: false
      });
    }

    statusEl.textContent = `✓ ${orders.length} orden${orders.length !== 1 ? 'es' : ''} detectada${orders.length !== 1 ? 's' : ''} en el PDF`;

    document.getElementById('pk-done-state').style.display = 'none';
    if (orders.length > 0) {
      document.getElementById('pk-order-area').style.display = 'block';
      await loadOrderIntoView(0);
    } else {
      document.getElementById('pk-order-area').style.display = 'none';
      showToast('⚠️ No se detectaron órdenes en este PDF');
    }
  } catch (err) {
    console.error(err);
    statusEl.textContent = '❌ Error leyendo el PDF: ' + (err.message || err);
  }
}

// Parses a TikTok Shop packing-slip page using each text fragment's real
// (x, y) position, not just the concatenated string.
//
// Why: pdf.js (like most PDF text extraction) returns fragments in the
// order they were drawn, not visual reading order. On an actual exported
// packing slip, that means every row's "Product Name" lines come out
// first, then every row's "SKU" lines, then every row's "Qty" — a
// column-major dump instead of row-by-row. A simple "SKU: ... Qty: ..."
// regex over that joined text pairs the wrong SKU with the wrong Qty (or
// finds nothing at all, since there's no "SKU:"/"Qty:" label at all — the
// labels are a one-time header row above the table).
//
// This was verified against a real TikTok Shop "Shipping label/Packing
// slip" export: each packing-slip page has a header row with "Product
// Name", "SKU", "Seller SKU" and "Qty" column labels, and each product row
// below it wraps across 2-4 lines per column (long names/SKUs), with the
// Qty value appearing once on the row's first line. The "SKU" column
// (not "Seller SKU", which this seller leaves blank) holds the real
// per-shade identifier, e.g. "RED VIOLET - Reflects" — that's what's used
// as tiktok_sku here.
//
// Algorithm: find the three column header items to get each column's X
// position, then for every text item below the header row (and above
// "Qty Total:"), bucket it into the nearest column by X, and into a row by
// Y — using each Qty-column item's Y as that row's anchor, since Qty never
// wraps across lines while Product Name/SKU do. Every other item in a
// column is assigned to the nearest row anchor at or above it.
async function parsePackingSlipPage(pageNum) {
  const page = await pdfDoc.getPage(pageNum);
  const content = await page.getTextContent();
  const items = content.items
    .filter(it => it.str && it.str.trim())
    .map(it => ({ str: it.str.trim(), x: it.transform[4], y: it.transform[5] }));

  const rawText = items.map(it => it.str).join(' ');
  const orderIdMatch = rawText.match(/Order\s*ID[:\s]+(\d+)/i);
  const trackingMatch = rawText.match(/Tracking\s*number[:\s]*([A-Za-z0-9]+)/i);

  // headerY is anchored only to these three — they share one text line.
  // The price header ("SKU Price" / "(Unit)") wraps onto its own, higher
  // line, so it's located separately below and kept out of the headerY/
  // table-top calculation; it's only here so price text doesn't get
  // misclassified into the Qty column (it sits close enough on the X axis
  // to fall inside the classifier's tolerance otherwise), corrupting both
  // the row count (duplicate rows) and the parsed Qty value.
  const headerLabels = { productName: 'Product Name', sku: 'SKU', qty: 'Qty' };
  const headerX = {};
  let headerY = -Infinity;
  items.forEach(it => {
    for (const [key, label] of Object.entries(headerLabels)) {
      if (it.str === label) { headerX[key] = it.x; headerY = Math.max(headerY, it.y); }
    }
  });
  const priceHeaderItem = items.find(it => it.str === 'SKU Price');
  if (priceHeaderItem) headerX.price = priceHeaderItem.x;

  // No recognizable table header on this page — can't locate the columns,
  // so return just the order-level fields with no line items rather than
  // guessing further.
  if (headerX.productName === undefined || headerX.sku === undefined || headerX.qty === undefined) {
    return { orderId: orderIdMatch ? orderIdMatch[1] : null, tracking: trackingMatch ? trackingMatch[1] : null, lines: [], rawText };
  }

  const totalMarker = items.find(it => /Qty Total/i.test(it.str));
  const tableBottomY = totalMarker ? totalMarker.y : -Infinity;
  const tableItems = items.filter(it => it.y < headerY - 1 && it.y > tableBottomY);

  const COL_TOLERANCE = 30; // points; the real columns are ~40-160pt apart
  function classifyColumn(x) {
    const dists = Object.entries(headerX).map(([key, hx]) => [key, Math.abs(x - hx)]);
    dists.sort((a, b) => a[1] - b[1]);
    return dists[0][1] <= COL_TOLERANCE ? dists[0][0] : null;
  }

  const rowAnchors = tableItems
    .filter(it => classifyColumn(it.x) === 'qty')
    .map(it => it.y)
    .sort((a, b) => b - a); // top to bottom

  function anchorFor(y) {
    let best = null;
    for (const a of rowAnchors) if (a >= y - 0.5 && (best === null || a < best)) best = a;
    return best;
  }

  const rows = new Map();
  rowAnchors.forEach(a => rows.set(a, { product: [], sku: [], qty: '' }));

  tableItems.forEach(it => {
    const col = classifyColumn(it.x);
    const anchor = anchorFor(it.y);
    if (!col || anchor === null || !rows.has(anchor)) return;
    const row = rows.get(anchor);
    if (col === 'productName') row.product.push(it.str);
    else if (col === 'sku') row.sku.push(it.str);
    else if (col === 'qty') row.qty += it.str;
  });

  const lines = rowAnchors
    .map(a => {
      const row = rows.get(a);
      const sku = row.sku.join(' ').replace(/\s+/g, ' ').trim();
      const productName = row.product.join(' ').replace(/\s+/g, ' ').trim();
      return { tiktok_sku: sku || productName, product_name_hint: productName, qty: parseInt(row.qty, 10) || 1 };
    })
    .filter(l => l.tiktok_sku);

  return {
    orderId: orderIdMatch ? orderIdMatch[1] : null,
    tracking: trackingMatch ? trackingMatch[1] : null,
    lines,
    rawText
  };
}

// ── SKU → barcode resolution ─────────────────────────────────
// Returns every barcode registered for a tiktok_sku — one entry for a plain
// product, several for a set (one tiktok_sku can map to multiple barcode
// rows, per the tiktok_skus(tiktok_sku, barcode) unique index). Checks the
// hardcoded demo list first, then Supabase, merging and caching the result.
async function resolveSku(tiktokSku) {
  if (skuCache.has(tiktokSku)) return skuCache.get(tiktokSku);

  const demoMatches = DEMO_BARCODES
    .filter(d => d.tiktok_sku === tiktokSku)
    .map(d => ({ barcode: d.barcode, product_name: d.product_name, is_set: d.is_set }));

  let dbMatches = [];
  try {
    const rows = await supabase(`tiktok_skus?tiktok_sku=eq.${encodeURIComponent(tiktokSku)}&select=*`);
    dbMatches = (rows || []).map(r => ({ barcode: r.barcode, product_name: r.product_name, is_set: r.is_set }));
  } catch (e) {
    console.error('resolveSku: error consultando tiktok_skus', e);
  }

  const merged = [...demoMatches];
  dbMatches.forEach(m => { if (!merged.some(x => x.barcode === m.barcode)) merged.push(m); });

  skuCache.set(tiktokSku, merged);
  return merged;
}

// ── Rendering the current order ──────────────────────────────
async function loadOrderIntoView(idx) {
  currentOrderIdx = idx;
  const order = orders[idx];
  if (!order) return;

  document.getElementById('pk-progress-label').textContent = `Orden ${idx + 1} de ${orders.length}`;
  document.getElementById('pk-debug-text').textContent = order.rawText || '(sin texto extraído)';

  for (const line of order.lines) {
    if (!line.components) {
      const resolved = await resolveSku(line.tiktok_sku);
      line.components = resolved.map(c => ({ ...c, scannedCount: 0 }));
    }
  }

  renderOrderHeader(order);
  renderOrderLines(order);
  checkForUnresolvedLine(order);
  focusScanInput();
}

function renderOrderHeader(order) {
  document.getElementById('pk-order-header').innerHTML = `
    <div style="margin-bottom:10px;">
      <div style="font-size:16px; font-weight:700;">Orden ${order.orderId || '(ID no detectado — revisa el texto extraído)'}</div>
      <div style="font-size:12px; color:var(--text-muted); margin-top:2px;">Tracking: ${order.tracking || '—'}</div>
    </div>`;
}

function renderOrderLines(order) {
  const container = document.getElementById('pk-order-lines');
  if (!order.lines.length) {
    container.innerHTML = `<div style="font-size:13px; color:#d97706;">⚠️ No se detectaron productos en esta orden — revisa el texto extraído abajo.</div>`;
    return;
  }
  container.innerHTML = order.lines.map(line => {
    const nameHint = line.product_name_hint && line.product_name_hint !== line.tiktok_sku
      ? `<div style="font-size:11px; color:var(--text-faint);">${escapeHtml(line.product_name_hint)}</div>` : '';
    if (!line.components || line.components.length === 0) {
      return `
      <div class="pk-order-line pk-line-missing">
        <div class="pk-line-sku">${escapeHtml(line.tiktok_sku)}${line.qty > 1 ? ` × ${line.qty}` : ''}</div>
        ${nameHint}
        <div style="font-size:12px; color:#d97706;">⚠️ SKU sin código de barras registrado — regístralo abajo</div>
      </div>`;
    }
    return `
    <div class="pk-order-line">
      <div class="pk-line-sku">${escapeHtml(line.tiktok_sku)}${line.qty > 1 ? ` × ${line.qty}` : ''}</div>
      ${nameHint}
      <div class="pk-components">
        ${line.components.map(c => {
          const done = c.scannedCount >= line.qty;
          const countLabel = line.qty > 1 ? ` (${c.scannedCount}/${line.qty})` : '';
          return `<span class="pk-chip ${done ? 'pk-chip-done' : ''}">${done ? '✅' : '⬜'} ${escapeHtml(c.product_name || c.barcode)}${countLabel}</span>`;
        }).join('')}
      </div>
    </div>`;
  }).join('');
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// ── New-SKU registration (SKU with no barcode on file yet) ──────
function checkForUnresolvedLine(order) {
  const panel = document.getElementById('pk-new-sku-panel');
  const missing = order.lines.find(l => !l.components || l.components.length === 0);
  if (!missing) {
    panel.style.display = 'none';
    pendingRegistration = null;
    return;
  }
  pendingRegistration = { tiktokSku: missing.tiktok_sku, productNameHint: missing.product_name_hint, collected: [] };
  renderRegistrationPanel();
}

function renderRegistrationPanel() {
  const panel = document.getElementById('pk-new-sku-panel');
  panel.style.display = 'block';
  const hint = pendingRegistration.productNameHint && pendingRegistration.productNameHint !== pendingRegistration.tiktokSku
    ? `<div style="font-size:11px; color:var(--text-faint); margin-bottom:4px;">${escapeHtml(pendingRegistration.productNameHint)}</div>` : '';
  panel.innerHTML = `
    <div style="font-size:13px; font-weight:600; margin-bottom:6px; color:#92400e;">⚠️ SKU nuevo — regístralo</div>
    <div style="font-size:12px; color:var(--text-muted); margin-bottom:8px; word-break:break-word;">"${escapeHtml(pendingRegistration.tiktokSku)}"</div>
    ${hint}
    <div style="font-size:12px; margin-bottom:10px;">
      Escanea el producto físico para asociarlo${pendingRegistration.collected.length ? ` (componente ${pendingRegistration.collected.length + 1}, si este SKU es un set)` : ''}.
    </div>
    ${pendingRegistration.collected.length > 0
      ? `<button class="submit-btn" style="width:auto; padding:8px 16px; font-size:13px;" onclick="finishRegistration()">Listo, era el último componente</button>`
      : ''}
  `;
}

async function handleRegistrationScan(code) {
  pendingRegistration.collected.push(code);
  try {
    await supabase('tiktok_skus', {
      method: 'POST',
      headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify({
        tiktok_sku: pendingRegistration.tiktokSku,
        barcode: code,
        product_name: null,
        is_set: pendingRegistration.collected.length > 1,
        set_parent_sku: pendingRegistration.collected.length > 1 ? pendingRegistration.tiktokSku : null
      })
    });
    skuCache.delete(pendingRegistration.tiktokSku); // force a fresh resolve once finished
    showToast('✓ Código registrado');
  } catch (e) {
    console.error(e);
    showToast('❌ Error al registrar el código (¿ya existe esa combinación SKU+código?)');
    pendingRegistration.collected.pop();
    focusScanInput();
    return;
  }
  renderRegistrationPanel();
  focusScanInput();
}

async function finishRegistration() {
  const order = orders[currentOrderIdx];
  const line = order.lines.find(l => l.tiktok_sku === pendingRegistration.tiktokSku);
  if (line) {
    const resolved = await resolveSku(pendingRegistration.tiktokSku);
    // Credit the barcode(s) just scanned during registration as already
    // picked — no need to make the picker scan them a second time.
    const justRegistered = new Set(pendingRegistration.collected);
    line.components = resolved.map(c => ({ ...c, scannedCount: justRegistered.has(c.barcode) ? 1 : 0 }));
  }
  pendingRegistration = null;
  document.getElementById('pk-new-sku-panel').style.display = 'none';
  renderOrderLines(order);
  checkForUnresolvedLine(order);
  if (!pendingRegistration && isOrderComplete(order)) {
    order.complete = true;
    await openPrintModal(order);
  }
  focusScanInput();
}

// ── Scanning ──────────────────────────────────────────────────
async function handleScan(code) {
  if (!code) return;

  if (pendingRegistration) {
    await handleRegistrationScan(code);
    return;
  }

  const order = orders[currentOrderIdx];
  if (!order) return;

  let matched = false;
  for (const line of order.lines) {
    if (!line.components) continue;
    const comp = line.components.find(c => c.barcode === code && c.scannedCount < line.qty);
    if (comp) {
      comp.scannedCount++;
      matched = true;
      break;
    }
  }

  if (!matched) {
    flashScanResult(false);
    showToast('❌ Código no pertenece a esta orden (o ya está completo)');
    focusScanInput();
    return;
  }

  flashScanResult(true);
  renderOrderLines(order);
  focusScanInput();

  if (isOrderComplete(order)) {
    order.complete = true;
    await openPrintModal(order);
  }
}

function isOrderComplete(order) {
  return order.lines.length > 0 && order.lines.every(l =>
    l.components && l.components.length > 0 && l.components.every(c => c.scannedCount >= l.qty)
  );
}

// ── Print modal (renders the odd "label" page for this order) ───
async function openPrintModal(order) {
  try {
    const page = await pdfDoc.getPage(order.labelPageNum);
    const viewport = page.getViewport({ scale: 3 }); // high scale so the barcode on the label stays scannable after printing
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

    currentLabelDataUrl = canvas.toDataURL('image/png');
    const preview = document.getElementById('pk-label-preview');
    preview.innerHTML = `<img src="${currentLabelDataUrl}" alt="Etiqueta de envío">`;
    document.getElementById('pk-print-modal').style.display = 'flex';
  } catch (e) {
    console.error('Error renderizando la etiqueta', e);
    showToast('❌ No se pudo generar la vista previa de la etiqueta');
  }
}

function printLabelAndAdvance() {
  const host = document.getElementById('print-host');
  host.innerHTML = currentLabelDataUrl ? `<img src="${currentLabelDataUrl}" alt="Etiqueta de envío">` : '';
  window.print();
  closePrintModalAndAdvance();
}

function advanceToNextOrder() {
  closePrintModalAndAdvance();
}

function skipToNextOrder() {
  closePrintModalAndAdvance();
}

function closePrintModalAndAdvance() {
  document.getElementById('pk-print-modal').style.display = 'none';
  pendingRegistration = null;
  setTimeout(() => {
    const nextIdx = currentOrderIdx + 1;
    if (nextIdx >= orders.length) {
      document.getElementById('pk-order-area').style.display = 'none';
      document.getElementById('pk-done-state').style.display = 'block';
    } else {
      loadOrderIntoView(nextIdx);
    }
  }, 250);
}

// ── Init ──────────────────────────────────────────────────────
function init() {
  if (!checkAuthGate()) return;

  const fileInput = document.getElementById('pk-file-input');
  if (fileInput) fileInput.addEventListener('change', handleFileUpload);

  const scanInput = document.getElementById('pk-scan-input');
  if (scanInput) {
    scanInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const code = scanInput.value.trim();
        scanInput.value = '';
        handleScan(code);
      }
    });
    // Barcode scanners type into whatever has focus — keep this field
    // focused so a picker never has to tap it between scans.
    scanInput.addEventListener('blur', () => setTimeout(focusScanInput, 100));
  }
}

document.addEventListener('DOMContentLoaded', init);
