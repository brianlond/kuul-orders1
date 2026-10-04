// ── Packing station — TikTok Shop ───────────────────────────────
// Standalone page (packing.html), the second half of the picking.html
// workflow. A picker finishes an order in picking.html, which saves it to
// tiktok_picked_orders and prints that order's packing-slip page — which
// already carries a scannable Code 128 barcode for the Order ID on real
// TikTok Shop exports — as a physical tag that travels with the picked
// items to wherever this page is running (the computer next to the label
// printer, which may be a different station/device entirely).
//
// Scanning that tag's barcode here looks the order up by Order ID and
// prints its shipping label immediately — no click, not even to acknowledge
// the scan — then marks it packed. See handleScan() below.
//
// Reuses the main app's Supabase project and the same localStorage session
// token ('sb_token') so a logged-in admin doesn't have to log in twice.

const SUPABASE_URL = 'https://qyejhtyryweesbsiwpxn.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5ZWpodHlyeXdlZXNic2l3cHhuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4MTg3MDIsImV4cCI6MjA5NDM5NDcwMn0.fKedoQ-VhAq2NFRp0WA_Ldbomqy9M5jrVY9fWb0SaIc';

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
  // Empty-body responses (e.g. Prefer: return=minimal) aren't always
  // exactly status 204 — read as text and only parse if there's something
  // there, instead of assuming any non-204 response has a JSON body.
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// Supabase/PostgREST error bodies are JSON like
// {"code":"42P01","message":"relation \"public.tiktok_picked_orders\" does not exist"}
// — pull out something readable instead of showing raw JSON.
function describeSupabaseError(e) {
  try {
    const parsed = JSON.parse(e.message);
    if (parsed.code === '42P01') return 'la tabla "tiktok_picked_orders" no existe todavía en Supabase — hay que crearla primero.';
    if (parsed.code === 'PGRST301' || /jwt expired/i.test(parsed.message || '')) {
      return 'tu sesión expiró — cierra sesión y vuelve a iniciar sesión en Kuul Orders, luego recarga esta página.';
    }
    if (parsed.message) return parsed.message;
  } catch (_) { /* not JSON — fall through to the raw message below */ }
  return (e && e.message) || String(e);
}

function checkAuthGate() {
  const hasToken = !!localStorage.getItem('sb_token');
  document.getElementById('pk-auth-gate').style.display = hasToken ? 'none' : 'flex';
  document.getElementById('pk-app').style.display = hasToken ? 'block' : 'none';
  return hasToken;
}

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
}

function focusScanInput() {
  const input = document.getElementById('pk-scan-input');
  if (input) setTimeout(() => input.focus(), 50);
}

function dataUrlToBlob(dataUrl) {
  const [header, base64] = dataUrl.split(',');
  const mime = (header.match(/data:(.*?);base64/) || [])[1] || 'application/octet-stream';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

// order.label_image (set by picking.js's completeOrderAndAdvance) is a
// single-page PDF cut out of the original TikTok Shop export, not an
// image — printing it by loading it into a hidden iframe and calling
// print() on that iframe's own window triggers Chrome's native PDF print
// path, the same one used when a PDF is opened directly and printed by
// hand. That's what actually fixed the thermal printer jamming partway
// through on a canvas-rendered bitmap of the same page. Resolves true/false
// so callers can tell whether printing actually happened before treating
// the order as handled (e.g. marking it packed) — silently resolving
// either way here previously let an order get marked packed_at even when
// nothing printed.
function printDataUrl(dataUrl) {
  if (!dataUrl) return Promise.resolve(false);
  return new Promise(resolve => {
    const blobUrl = URL.createObjectURL(dataUrlToBlob(dataUrl));
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed; left:-10000px; top:0; width:4in; height:6in; border:none;';

    const cleanup = () => setTimeout(() => { iframe.remove(); URL.revokeObjectURL(blobUrl); }, 1000);

    iframe.onload = () => {
      // Give the PDF viewer a moment to actually paint before printing —
      // the same timing issue the old rendered-image version had.
      setTimeout(() => {
        try {
          iframe.contentWindow.focus();
          iframe.contentWindow.print();
          resolve(true);
        } catch (e) {
          console.error('Error al imprimir el PDF', e);
          resolve(false);
        } finally {
          cleanup();
        }
      }, 300);
    };
    iframe.onerror = () => { resolve(false); cleanup(); };

    document.body.appendChild(iframe);
    iframe.src = blobUrl;
  });
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function setLastAction(ok, msg) {
  const el = document.getElementById('pk-last-action');
  el.className = 'pk-last-action ' + (ok ? 'ok' : 'err');
  el.textContent = msg;
}

// ── Queue of orders picked but not yet packed ────────────────────
async function loadQueue() {
  const list = document.getElementById('pk-queue-list');
  list.innerHTML = `<div class="empty-state"><div class="empty-icon">⏳</div>Cargando...</div>`;
  try {
    const rows = await supabase('tiktok_picked_orders?packed_at=is.null&select=*&order=picked_at.asc');
    renderQueue(rows || []);
  } catch (e) {
    console.error(e);
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">❌</div>Error cargando la cola: ${escapeHtml(describeSupabaseError(e))}</div>`;
  }
}

function renderQueue(rows) {
  const list = document.getElementById('pk-queue-list');
  if (!rows.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">🎉</div>No hay órdenes pendientes de empacar</div>`;
    return;
  }
  list.innerHTML = rows.map(r => {
    const units = (r.lines || []).reduce((s, l) => s + (l.qty || 0), 0);
    const picked = r.picked_at ? new Date(r.picked_at).toLocaleString('es-MX', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    return `
    <div class="pk-queue-item">
      <div>
        <div class="pk-queue-order">Orden ${escapeHtml(r.order_id)}</div>
        <div class="pk-queue-meta">Tracking: ${escapeHtml(r.tracking || '—')} · Recogida: ${picked}</div>
      </div>
      <span class="pk-queue-count">${units} ud.</span>
    </div>`;
  }).join('');
}

// ── Scanning ──────────────────────────────────────────────────
async function handleScan(code) {
  if (!code) return;

  try {
    const matches = await supabase(`tiktok_picked_orders?order_id=eq.${encodeURIComponent(code)}&packed_at=is.null&select=*`);
    const order = matches && matches[0];

    if (!order) {
      // Distinguish "never existed/not picked yet" from "already packed" —
      // same lookup without the packed_at filter.
      let already = null;
      try {
        const all = await supabase(`tiktok_picked_orders?order_id=eq.${encodeURIComponent(code)}&select=order_id,packed_at`);
        already = all && all[0];
      } catch (_) { /* best-effort context only */ }

      flashScanResult(false);
      const msg = already
        ? `❌ La orden ${code} ya fue empacada antes`
        : `❌ No se encontró ninguna orden pendiente con el código ${code}`;
      setLastAction(false, msg);
      showToast(msg, 4000);
      focusScanInput();
      return;
    }

    flashScanResult(true);

    // Print immediately — no click, not even to acknowledge the scan.
    const printed = await printDataUrl(order.label_image);
    if (!printed) {
      const msg = `⚠️ La orden ${order.order_id} se encontró, pero no se pudo imprimir la etiqueta (PDF no disponible) — no se marcó como empacada, puedes volver a escanearla.`;
      setLastAction(false, msg);
      showToast(msg, 6000);
      focusScanInput();
      return;
    }

    await supabase(`tiktok_picked_orders?order_id=eq.${encodeURIComponent(order.order_id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ packed_at: new Date().toISOString() })
    });

    setLastAction(true, `✓ Etiqueta impresa para la orden ${order.order_id}`);
    showToast('✓ Etiqueta impresa');
    loadQueue();
  } catch (e) {
    console.error(e);
    flashScanResult(false);
    const msg = '❌ Error: ' + describeSupabaseError(e);
    setLastAction(false, msg);
    showToast(msg, 5000);
  }
  focusScanInput();
}

// ── Init ──────────────────────────────────────────────────────
function init() {
  if (!checkAuthGate()) return;

  loadQueue();

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
    // focused so the packer never has to tap it between scans.
    scanInput.addEventListener('blur', () => setTimeout(focusScanInput, 100));
  }
  focusScanInput();
}

document.addEventListener('DOMContentLoaded', init);
