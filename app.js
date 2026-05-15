// ── Supabase config ─────────────────────────────────────────
const SUPABASE_URL = 'https://qyejhtyryweesbsiwpxn.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5ZWpodHlyeXdlZXNic2l3cHhuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4MTg3MDIsImV4cCI6MjA5NDM5NDcwMn0.fKedoQ-VhAq2NFRp0WA_Ldbomqy9M5jrVY9fWb0SaIc';

// ── Admin credentials ────────────────────────────────────────
const ADMIN_USER = 'mariapelos';
const ADMIN_PASS = 'snaPPletapaTio1?';

// ── Constants ────────────────────────────────────────────────
const SHIPPING = 9.99;
const STATUSES = ['Nueva', 'En proceso', 'Lista', 'Entregada'];

// ── State ────────────────────────────────────────────────────
let isAdmin = false;
let PRODUCTS = [];

// ── Supabase helpers ─────────────────────────────────────────
async function supabase(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  if (!res.ok) throw new Error(await res.text());
  return res.status === 204 ? null : res.json();
}

async function dbFetchProducts() {
  const prods = await supabase('products?select=*&active=eq.true');
  return prods.sort((a, b) => {
    if (a.brand !== b.brand) return a.brand.localeCompare(b.brand);
    const aCode = parseFloat(a.color_code) || 999;
    const bCode = parseFloat(b.color_code) || 999;
    if (aCode !== bCode) return aCode - bCode;
    return a.name.localeCompare(b.name);
  });
}

async function dbInsertOrder(order) {
  return supabase('orders', {
    method: 'POST',
    headers: { 'Prefer': 'return=representation' },
    body: JSON.stringify(order)
  });
}

async function dbFetchOrders() {
  return supabase('orders?select=*&order=created_at.desc');
}

async function dbUpdateStatus(id, status) {
  return supabase(`orders?id=eq.${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status })
  });
}

async function dbDeleteAll() {
  return supabase('orders?id=gte.0', { method: 'DELETE' });
}

// ── Build product options ────────────────────────────────────
function buildOptions(selected) {
  return PRODUCTS.map(p => {
    const code = p.color_code ? `[${p.color_code}] ` : '';
    return `<option value="${p.barcode}" ${p.barcode === selected ? 'selected' : ''} data-price="${p.price}">${p.brand} ${code}${p.name} — $${parseFloat(p.price).toFixed(2)}</option>`;
  }).join('');
}

// ── Add a product line ───────────────────────────────────────
let lineCount = 0;
function addProductLine(barcode = '', qty = 1) {
  lineCount++;
  const id = lineCount;
  const container = document.getElementById('product-lines');
  const div = document.createElement('div');
  div.className = 'product-row';
  div.id = 'line-' + id;
  div.innerHTML = `
    <select id="sel-${id}" onchange="recalcTotal()">${buildOptions(barcode)}</select>
    <input type="number" id="qty-${id}" value="${qty}" min="1" max="999" step="1" oninput="recalcTotal()">
    <button class="remove-btn" onclick="removeLine(${id})" aria-label="Eliminar">×</button>
  `;
  container.appendChild(div);
  recalcTotal();
}

function removeLine(id) {
  const el = document.getElementById('line-' + id);
  if (el) el.remove();
  recalcTotal();
}

// ── Permit change ────────────────────────────────────────────
function onPermitChange() {
  const permit = document.getElementById('permit').value.trim();
  const note = document.getElementById('permit-note');
  const taxToggle = document.getElementById('tax-toggle');
  const taxRow = document.getElementById('tax-toggle-row');
  if (permit.length > 0) {
    note.textContent = '✓ Cliente exento de tax';
    note.style.color = 'var(--success)';
    taxToggle.checked = false;
    taxRow.style.opacity = '0.4';
    taxRow.style.pointerEvents = 'none';
  } else {
    note.textContent = 'Sin permit — verifica si aplica tax';
    note.style.color = 'var(--warning)';
    taxRow.style.opacity = '1';
    taxRow.style.pointerEvents = 'auto';
  }
  recalcTotal();
}

// ── Recalculate totals ───────────────────────────────────────
function recalcTotal() {
  let subtotal = 0;
  document.querySelectorAll('.product-row').forEach(row => {
    const sel = row.querySelector('select');
    const qty = row.querySelector('input[type=number]');
    if (sel && qty) {
      const price = parseFloat(sel.selectedOptions[0]?.dataset?.price || 0);
      subtotal += price * (parseInt(qty.value) || 0);
    }
  });
  const hasShipping = document.getElementById('shipping-toggle').checked;
  const hasTax = document.getElementById('tax-toggle').checked;
  const taxRate = parseFloat(document.getElementById('tax-rate').value) || 0;
  const shippingAmt = hasShipping ? SHIPPING : 0;
  const taxAmt = hasTax ? subtotal * (taxRate / 100) : 0;
  const total = subtotal + shippingAmt + taxAmt;

  document.getElementById('sum-products').textContent = '$' + subtotal.toFixed(2);
  document.getElementById('sum-shipping-row').style.display = hasShipping ? 'flex' : 'none';
  document.getElementById('sum-tax-row').style.display = hasTax ? 'flex' : 'none';
  document.getElementById('sum-tax-label').textContent = 'Tax (' + taxRate.toFixed(2) + '%)';
  document.getElementById('sum-tax-amount').textContent = '$' + taxAmt.toFixed(2);
  document.getElementById('order-total').textContent = '$' + total.toFixed(2);
  document.getElementById('tax-rate-row').style.display = hasTax ? 'block' : 'none';
}

// ── Helpers ──────────────────────────────────────────────────
function getVal(id) { return document.getElementById(id)?.value?.trim() || ''; }

function showToast(msg, dur = 2800) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), dur);
}

// ── Admin login ──────────────────────────────────────────────
function showLoginModal() {
  document.getElementById('login-modal').style.display = 'flex';
  document.getElementById('login-user').value = '';
  document.getElementById('login-pass').value = '';
  document.getElementById('login-error').textContent = '';
  setTimeout(() => document.getElementById('login-user').focus(), 100);
}

function hideLoginModal() {
  document.getElementById('login-modal').style.display = 'none';
}

function doLogin() {
  const user = document.getElementById('login-user').value.trim();
  const pass = document.getElementById('login-pass').value;
  if (user === ADMIN_USER && pass === ADMIN_PASS) {
    isAdmin = true;
    hideLoginModal();
    showAdminView();
  } else {
    document.getElementById('login-error').textContent = 'Usuario o contraseña incorrectos';
  }
}

function doLogout() {
  isAdmin = false;
  showTab('vendedor');
}

document.addEventListener('keydown', e => {
  if (document.getElementById('login-modal').style.display === 'flex' && e.key === 'Enter') doLogin();
});

// ── Show admin view ──────────────────────────────────────────
function showAdminView() {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.getElementById('tab-admin').classList.add('active');
  document.getElementById('tab-admin-btn').classList.add('active');
  document.getElementById('logout-btn').style.display = 'inline-block';
  loadOrders();
}

// ── Submit order ─────────────────────────────────────────────
async function submitOrder() {
  const seller   = getVal('seller-name');
  const client   = getVal('client-name');
  const business = getVal('business-name');
  const phone    = getVal('phone');
  const permit   = getVal('permit');
  const address  = getVal('address');
  const email    = getVal('email');
  const notes    = getVal('notes');

  if (!seller)   { showToast('⚠️ Agrega tu nombre de vendedor'); return; }
  if (!client)   { showToast('⚠️ Nombre del cliente requerido'); return; }
  if (!business) { showToast('⚠️ Nombre del negocio requerido'); return; }
  if (!phone)    { showToast('⚠️ Teléfono requerido'); return; }
  if (!address)  { showToast('⚠️ Dirección requerida'); return; }

  const lines = [];
  let subtotal = 0;
  document.querySelectorAll('.product-row').forEach(row => {
    const sel = row.querySelector('select');
    const qty = row.querySelector('input[type=number]');
    if (sel && qty) {
      const product = PRODUCTS.find(p => p.barcode === sel.value);
      const q = parseInt(qty.value) || 0;
      if (product && q > 0) {
        const lineSubtotal = parseFloat(product.price) * q;
        lines.push({
          barcode: product.barcode,
          brand: product.brand,
          code: product.color_code || '—',
          name: product.name,
          price: parseFloat(product.price),
          qty: q,
          subtotal: lineSubtotal
        });
        subtotal += lineSubtotal;
      }
    }
  });

  if (lines.length === 0) { showToast('⚠️ Agrega al menos un producto'); return; }

  const hasShipping = document.getElementById('shipping-toggle').checked;
  const hasTax      = document.getElementById('tax-toggle').checked;
  const taxRate     = parseFloat(document.getElementById('tax-rate').value) || 0;
  const shippingAmt = hasShipping ? SHIPPING : 0;
  const taxAmt      = hasTax ? subtotal * (taxRate / 100) : 0;
  const total       = subtotal + shippingAmt + taxAmt;

  const btn = document.querySelector('.submit-btn');
  btn.disabled = true;
  btn.textContent = 'Enviando...';

  try {
    await dbInsertOrder({
      seller, client, business, phone, permit, address, email, notes,
      lines, subtotal,
      shipping: hasShipping ? shippingAmt : null,
      tax_rate: hasTax ? taxRate : null,
      tax_amount: hasTax ? taxAmt : null,
      total, status: 'Nueva'
    });
    resetForm();
    showToast('✓ Orden enviada correctamente');
  } catch (e) {
    showToast('❌ Error al enviar, intenta de nuevo');
    console.error(e);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Enviar orden →';
  }
}

// ── Reset form ───────────────────────────────────────────────
function resetForm() {
  ['seller-name','client-name','business-name','phone','permit','address','email','notes']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('product-lines').innerHTML = '';
  document.getElementById('permit-note').textContent = '';
  document.getElementById('tax-toggle').checked = false;
  document.getElementById('shipping-toggle').checked = true;
  document.getElementById('tax-toggle-row').style.opacity = '1';
  document.getElementById('tax-toggle-row').style.pointerEvents = 'auto';
  lineCount = 0;
  recalcTotal();
  addProductLine();
}

// ── Status badge class ───────────────────────────────────────
function statusClass(status) {
  if (status === 'Nueva')      return 'badge-nueva';
  if (status === 'En proceso') return 'badge-proceso';
  if (status === 'Lista')      return 'badge-lista';
  if (status === 'Entregada')  return 'badge-entregada';
  return '';
}

// ── Update status ────────────────────────────────────────────
async function updateStatus(id, status) {
  try {
    await dbUpdateStatus(id, status);
    await loadOrders();
  } catch(e) {
    showToast('❌ Error al actualizar estado');
    console.error(e);
  }
}

// ── Render orders ────────────────────────────────────────────
function renderOrders(orders) {
  const list       = document.getElementById('orders-list');
  const badge      = document.getElementById('badge-count');
  const countLabel = document.getElementById('order-count-label');
  countLabel.textContent = orders.length + ' orden' + (orders.length !== 1 ? 'es' : '');

  if (orders.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div>No hay órdenes todavía</div>`;
    badge.style.display = 'none';
    return;
  }

  window._orders = orders;
  const nuevas = orders.filter(o => o.status === 'Nueva').length;
  badge.style.display = nuevas > 0 ? '' : 'none';
  badge.textContent = nuevas;

  list.innerHTML = orders.map(o => {
    const date = new Date(o.created_at).toLocaleString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const statusOptions = STATUSES.map(s =>
      `<option value="${s}" ${o.status === s ? 'selected' : ''}>${s}</option>`
    ).join('');
    return `
    <div class="order-card">
      <div class="order-header">
        <div>
          <div class="order-name">${o.client}</div>
          <div class="order-business">${o.business}</div>
        </div>
        <div style="display:flex; gap:8px; align-items:center;">
        <button onclick="printOrder(${o.id})" style="font-size:12px; padding:4px 10px; border:1px solid var(--border); border-radius:var(--radius); background:none; cursor:pointer; color:var(--text-muted); font-family:inherit;" title="Imprimir orden">🖨️</button>
        <select class="status-select ${statusClass(o.status)}" onchange="updateStatus(${o.id}, this.value)">
          ${statusOptions}
        </select>
        </div>
      </div>
      <div class="order-meta">🕐 ${date} · 👤 ${o.seller} · 📞 ${o.phone}</div>
      <div class="order-meta">
        📍 ${o.address}
        ${o.permit ? ` · Permit: ${o.permit}` : ' · <span class="warn">Sin seller permit</span>'}
        ${o.email ? ` · ✉️ ${o.email}` : ''}
      </div>
      ${o.notes ? `<div class="order-meta" style="font-style:italic;">"${o.notes}"</div>` : ''}
      <div class="order-products">
        ${o.lines.map(l => `
          <div class="order-product-line">
            <span>${l.brand} [${l.code}] ${l.name} × ${l.qty}</span>
            <span>$${l.subtotal.toFixed(2)}</span>
          </div>
        `).join('')}
        <div class="order-subtotals">
          <div class="order-summary-line"><span>Subtotal</span><span>$${parseFloat(o.subtotal).toFixed(2)}</span></div>
          ${o.shipping !== null && o.shipping !== undefined ? `<div class="order-summary-line"><span>Envío</span><span>$${parseFloat(o.shipping).toFixed(2)}</span></div>` : ''}
          ${o.tax_rate ? `<div class="order-summary-line"><span>Tax (${parseFloat(o.tax_rate).toFixed(2)}%)</span><span>$${parseFloat(o.tax_amount).toFixed(2)}</span></div>` : ''}
          <div class="order-total-line"><span>Total</span><span>$${parseFloat(o.total).toFixed(2)}</span></div>
        </div>
      </div>
    </div>
  `}).join('');
}

// ── Load orders ──────────────────────────────────────────────
async function loadOrders() {
  const list = document.getElementById('orders-list');
  list.innerHTML = `<div class="empty-state"><div class="empty-icon">⏳</div>Cargando órdenes...</div>`;
  try {
    const orders = await dbFetchOrders();
    renderOrders(orders);
  } catch (e) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">❌</div>Error cargando órdenes</div>`;
    console.error(e);
  }
}

// ── Clear all orders ─────────────────────────────────────────
async function clearOrders() {
  if (!confirm('¿Eliminar todas las órdenes? Esta acción no se puede deshacer.')) return;
  try {
    await dbDeleteAll();
    showToast('✓ Órdenes eliminadas');
    await loadOrders();
  } catch (e) {
    showToast('❌ Error al eliminar');
    console.error(e);
  }
}

// ── Tab switching ────────────────────────────────────────────
function showTab(name) {
  if (name === 'admin' && !isAdmin) { showLoginModal(); return; }
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  document.getElementById('tab-' + name + '-btn').classList.add('active');
  if (name === 'admin') {
    document.getElementById('logout-btn').style.display = 'inline-block';
    loadOrders();
  } else {
    document.getElementById('logout-btn').style.display = 'none';
  }
}

// ── Init — load products from Supabase then boot the form ────
async function init() {
  const productLines = document.getElementById('product-lines');
  productLines.innerHTML = `<div style="font-size:13px; color:var(--text-muted); padding:8px 0;">Cargando productos...</div>`;

  try {
    PRODUCTS = await dbFetchProducts();
  } catch(e) {
    productLines.innerHTML = `<div style="font-size:13px; color:var(--danger);">Error cargando productos</div>`;
    console.error(e);
    return;
  }

  productLines.innerHTML = '';
  addProductLine();
  onPermitChange();
}

init();

// ── Scanner ──────────────────────────────────────────────────
let scannerStream = null;
let scannerInterval = null;
let scannedBarcode = null;

async function openScanner() {
  document.getElementById('scanner-modal').style.display = 'flex';
  document.getElementById('scanner-status').textContent = 'Iniciando cámara...';
  try {
    scannerStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const video = document.getElementById('scanner-video');
    video.srcObject = scannerStream;
    await video.play();
    document.getElementById('scanner-status').textContent = 'Apunta al código de barras...';
    startDecoding(video);
  } catch(e) {
    document.getElementById('scanner-status').textContent = '❌ No se pudo acceder a la cámara. Verifica los permisos.';
  }
}

function startDecoding(video) {
  if (!window.BarcodeDetector) {
    document.getElementById('scanner-status').textContent = 'Este navegador no soporta escaneo. Usa Chrome en Android o Safari en iPhone.';
    return;
  }
  const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39'] });
  scannerInterval = setInterval(async () => {
    try {
      const barcodes = await detector.detect(video);
      if (barcodes.length > 0) {
        const code = barcodes[0].rawValue;
        clearInterval(scannerInterval);
        closeScanner();
        handleScannedCode(code);
      }
    } catch(e) {}
  }, 300);
}

function closeScanner() {
  if (scannerStream) {
    scannerStream.getTracks().forEach(t => t.stop());
    scannerStream = null;
  }
  if (scannerInterval) {
    clearInterval(scannerInterval);
    scannerInterval = null;
  }
  document.getElementById('scanner-modal').style.display = 'none';
}

function handleScannedCode(barcode) {
  const product = PRODUCTS.find(p => p.barcode === barcode);
  if (!product) {
    showToast('⚠️ Producto no encontrado: ' + barcode);
    return;
  }
  scannedBarcode = barcode;
  const code = product.color_code ? `[${product.color_code}] ` : '';
  document.getElementById('qty-modal-title').textContent = 'Producto encontrado';
  document.getElementById('qty-modal-product').textContent = `${product.brand} ${code}${product.name} — $${parseFloat(product.price).toFixed(2)}`;
  document.getElementById('qty-modal-input').value = 1;
  document.getElementById('qty-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('qty-modal-input').focus(), 100);
}

function confirmScanQty() {
  const qty = parseInt(document.getElementById('qty-modal-input').value) || 1;
  closeQtyModal();
  if (scannedBarcode) {
    addProductLine(scannedBarcode, qty);
    scannedBarcode = null;
    showToast('✓ Producto agregado');
  }
}

function closeQtyModal() {
  document.getElementById('qty-modal').style.display = 'none';
  scannedBarcode = null;
}

document.addEventListener('keydown', e => {
  if (document.getElementById('qty-modal').style.display === 'flex' && e.key === 'Enter') confirmScanQty();
});

// ── Print order ──────────────────────────────────────────────
function printOrder(id) {
  const order = window._orders ? window._orders.find(o => o.id === id) : null;
  if (!order) return;
  const date = new Date(order.created_at).toLocaleString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Orden #${order.id}</title>
  <style>
    body { font-family: Arial, sans-serif; font-size: 13px; max-width: 400px; margin: 20px auto; color: #111; }
    h1 { font-size: 18px; margin-bottom: 4px; }
    .meta { color: #666; font-size: 12px; margin-bottom: 16px; }
    .section { margin-bottom: 12px; }
    .section-title { font-weight: bold; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #888; margin-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
    td { padding: 4px 0; vertical-align: top; }
    td:last-child { text-align: right; white-space: nowrap; }
    .divider { border: none; border-top: 1px solid #ddd; margin: 10px 0; }
    .total { font-weight: bold; font-size: 15px; }
    .footer { margin-top: 24px; font-size: 11px; color: #999; text-align: center; }
    @media print { button { display: none; } }
  </style></head><body>
  <h1>Kuul Orders</h1>
  <div class="meta">Orden #${order.id} · ${date}</div>
  <hr class="divider">
  <div class="section">
    <div class="section-title">Cliente</div>
    <div>${order.client}</div>
    <div>${order.business}</div>
    <div>${order.phone}</div>
    <div>${order.address}</div>
    ${order.permit ? `<div>Permit: ${order.permit}</div>` : ''}
    ${order.email ? `<div>${order.email}</div>` : ''}
  </div>
  <div class="section">
    <div class="section-title">Vendedor</div>
    <div>${order.seller}</div>
  </div>
  <hr class="divider">
  <div class="section">
    <div class="section-title">Productos</div>
    <table>
      ${order.lines.map(l => `<tr><td>${l.brand} [${l.code}] ${l.name} × ${l.qty}</td><td>$${l.subtotal.toFixed(2)}</td></tr>`).join('')}
    </table>
  </div>
  <hr class="divider">
  <table>
    <tr><td>Subtotal</td><td>$${parseFloat(order.subtotal).toFixed(2)}</td></tr>
    ${order.shipping ? `<tr><td>Envío</td><td>$${parseFloat(order.shipping).toFixed(2)}</td></tr>` : ''}
    ${order.tax_rate ? `<tr><td>Tax (${parseFloat(order.tax_rate).toFixed(2)}%)</td><td>$${parseFloat(order.tax_amount).toFixed(2)}</td></tr>` : ''}
    <tr class="total"><td>Total</td><td>$${parseFloat(order.total).toFixed(2)}</td></tr>
  </table>
  ${order.notes ? `<hr class="divider"><div class="section"><div class="section-title">Notas</div><div>${order.notes}</div></div>` : ''}
  <div class="footer">Gracias por su compra</div>
  <br><button onclick="window.print()">🖨️ Imprimir</button>
  </body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 500);
}
