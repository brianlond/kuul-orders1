// ── Supabase config ─────────────────────────────────────────
const SUPABASE_URL = 'https://qyejhtyryweesbsiwpxn.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5ZWpodHlyeXdlZXNic2l3cHhuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4MTg3MDIsImV4cCI6MjA5NDM5NDcwMn0.fKedoQ-VhAq2NFRp0WA_Ldbomqy9M5jrVY9fWb0SaIc';

async function dbInsert(order) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/orders`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify(order)
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function dbFetch() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/orders?select=*&order=created_at.desc`, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`
    }
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function dbDelete() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/orders?id=gte.0`, {
    method: 'DELETE',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`
    }
  });
  if (!res.ok) throw new Error(await res.text());
}

// ── Constants ────────────────────────────────────────────────
const SHIPPING = 9.99;

// ── Build product options ────────────────────────────────────
function buildOptions(selected) {
  return PRODUCTS.map(p =>
    `<option value="${p.barcode}" ${p.barcode === selected ? 'selected' : ''} data-price="${p.price}">
      [${p.code}] ${p.name} — $${p.price.toFixed(2)}
    </option>`
  ).join('');
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

function setLoading(btn, loading) {
  btn.disabled = loading;
  btn.textContent = loading ? 'Enviando...' : 'Enviar orden →';
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
        lines.push({ barcode: product.barcode, code: product.code, name: product.name, price: product.price, qty: q, subtotal: product.price * q });
        subtotal += product.price * q;
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
  setLoading(btn, true);

  try {
    await dbInsert({
      seller, client, business, phone, permit, address, email, notes,
      lines,
      subtotal,
      shipping: hasShipping ? shippingAmt : null,
      tax_rate: hasTax ? taxRate : null,
      tax_amount: hasTax ? taxAmt : null,
      total,
      status: 'Nueva'
    });
    resetForm();
    showToast('✓ Orden enviada correctamente');
    showTab('admin');
    await loadOrders();
  } catch (e) {
    showToast('❌ Error al enviar, intenta de nuevo');
    console.error(e);
  } finally {
    setLoading(btn, false);
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
  badge.style.display = '';
  badge.textContent = orders.length;

  list.innerHTML = orders.map(o => {
    const date = new Date(o.created_at).toLocaleString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    return `
    <div class="order-card">
      <div class="order-header">
        <div>
          <div class="order-name">${o.client}</div>
          <div class="order-business">${o.business}</div>
        </div>
        <span class="status-badge">${o.status}</span>
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
            <span>[${l.code}] ${l.name} × ${l.qty}</span>
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

// ── Load orders from Supabase ────────────────────────────────
async function loadOrders() {
  const list = document.getElementById('orders-list');
  list.innerHTML = `<div class="empty-state"><div class="empty-icon">⏳</div>Cargando órdenes...</div>`;
  try {
    const orders = await dbFetch();
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
    await dbDelete();
    showToast('✓ Órdenes eliminadas');
    await loadOrders();
  } catch (e) {
    showToast('❌ Error al eliminar');
    console.error(e);
  }
}

// ── Tab switching ────────────────────────────────────────────
function showTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  document.querySelectorAll('.tab')[name === 'vendedor' ? 0 : 1].classList.add('active');
  if (name === 'admin') loadOrders();
}

// ── Init ─────────────────────────────────────────────────────
addProductLine();
onPermitChange();
