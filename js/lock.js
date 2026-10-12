// App lock: 4-digit PIN, optionally Face ID / Touch ID through the phone's passkey support (WebAuthn).
// This is a privacy lock for the screen — the data itself is not encrypted.
import { state, saveSettings, eraseEverything } from './store.js';
import { sheet, toast, confirmSheet } from './ui.js';
import { esc } from './util.js';

const LOCK_AFTER_MS = 60 * 1000; // re-lock after a minute in the background
let hiddenAt = 0;
let locked = false;

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));

async function hashPin(pin, salt) {
  const data = new TextEncoder().encode(`${salt}:${pin}`);
  return b64(await crypto.subtle.digest('SHA-256', data));
}

export const lockEnabled = () => !!state.settings.lockPinHash;
export const biometricsAvailable = async () => {
  try { return !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); } catch { return false; }
};

async function verifyBiometric() {
  const id = state.settings.lockCredId;
  if (!id) return false;
  try {
    const cred = await navigator.credentials.get({ publicKey: { challenge: rand(32), allowCredentials: [{ type: 'public-key', id: unb64(id) }], userVerification: 'required', timeout: 60000 } });
    return !!cred;
  } catch { return false; }
}

async function registerBiometric() {
  const cred = await navigator.credentials.create({
    publicKey: {
      rp: { name: 'Spend Tracker' },
      user: { id: rand(16), name: 'spend-tracker', displayName: 'Spend Tracker' },
      challenge: rand(32),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60000,
    },
  });
  return b64(cred.rawId);
}

// ---------- lock screen ----------
export function showLock() {
  if (!lockEnabled() || locked) return;
  locked = true;
  document.getElementById('view').style.visibility = 'hidden';
  const root = document.createElement('div');
  root.id = 'lock';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'App locked');
  let pin = '';
  const hasBio = !!state.settings.lockCredId;
  root.innerHTML = `<h1>Spend Tracker is locked</h1><p class="muted">Enter your PIN${hasBio ? ' or use Face ID' : ''}</p>
    <div class="pin-dots" aria-hidden="true">${'<i></i>'.repeat(4)}</div>
    <div class="pin-pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button type="button" data-n="${n}">${n}</button>`).join('')}
      <button type="button" class="ghost" data-bio ${hasBio ? '' : 'style="visibility:hidden"'}>Face ID</button><button type="button" data-n="0">0</button><button type="button" class="ghost" data-del aria-label="Delete">⌫</button></div>
    <button type="button" class="link-btn mt16" data-forgot>Forgot PIN?</button>`;
  document.body.appendChild(root);
  const dots = root.querySelectorAll('.pin-dots i');
  const paint = () => dots.forEach((d, i) => d.classList.toggle('on', i < pin.length));
  const unlock = () => { locked = false; root.remove(); document.getElementById('view').style.visibility = ''; };
  root.querySelectorAll('[data-n]').forEach((b) => b.addEventListener('click', async () => {
    if (pin.length >= 4) return;
    pin += b.dataset.n; paint();
    if (pin.length === 4) {
      if (await hashPin(pin, state.settings.lockSalt) === state.settings.lockPinHash) unlock();
      else { const d = root.querySelector('.pin-dots'); d.classList.add('shake'); setTimeout(() => { d.classList.remove('shake'); pin = ''; paint(); }, 380); }
    }
  }));
  root.querySelector('[data-del]').addEventListener('click', () => { pin = pin.slice(0, -1); paint(); });
  root.querySelector('[data-bio]').addEventListener('click', async () => { if (await verifyBiometric()) unlock(); else toast('Face ID didn’t work — use your PIN'); });
  root.querySelector('[data-forgot]').addEventListener('click', async () => {
    const ok = await confirmSheet({ title: 'Forgot your PIN?', body: 'The only way back in is to erase all data in this app on this phone. You can then restore from your last backup file.', ok: 'Erase and start again', danger: true, typeToConfirm: 'ERASE' });
    if (ok) { await eraseEverything(); unlock(); location.hash = '#/welcome'; }
  });
}

export function installLock() {
  document.addEventListener('visibilitychange', () => {
    if (!lockEnabled()) return;
    if (document.hidden) { hiddenAt = Date.now(); document.getElementById('view').style.visibility = 'hidden'; }
    else if (Date.now() - hiddenAt > LOCK_AFTER_MS) showLock();
    else if (!locked) document.getElementById('view').style.visibility = '';
  });
  if (lockEnabled()) showLock();
}

// ---------- settings ----------
function pinEntrySheet(title, body) {
  return new Promise((resolve) => {
    let done = false;
    sheet(`<h2 class="sheet-title">${esc(title)}</h2>${body ? `<p class="sheet-body">${esc(body)}</p>` : ''}
      <form><label class="field"><span>4-digit PIN</span><input name="pin" type="password" inputmode="numeric" pattern="\\d{4}" maxlength="4" autocomplete="off" autofocus></label>
      <div class="sheet-actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn btn-primary">OK</button></div></form>`, {
      onMount(panel, close) {
        panel.closest('#sheet').querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => { if (!done) { done = true; resolve(null); } }));
        panel.querySelector('form').addEventListener('submit', (e) => {
          e.preventDefault();
          const v = e.target.pin.value.trim();
          if (!/^\d{4}$/.test(v)) { toast('Enter exactly 4 digits'); return; }
          done = true; close(); resolve(v);
        });
      },
    });
  });
}

export async function setupLock() {
  const a = await pinEntrySheet('Set a PIN', 'You’ll need it to open the app. If you forget it, the only way back in is erasing the app’s data — keep backups.');
  if (!a) return;
  const b = await pinEntrySheet('Enter the PIN again');
  if (!b) return;
  if (a !== b) { toast('PINs didn’t match — try again'); return; }
  const salt = b64(rand(16));
  await saveSettings({ lockSalt: salt, lockPinHash: await hashPin(a, salt), lockCredId: null });
  toast('App lock is on');
  if (await biometricsAvailable()) {
    if (await confirmSheet({ title: 'Also unlock with Face ID?', body: 'Uses your phone’s Face ID or Touch ID. Your PIN still works too.', ok: 'Use Face ID' })) await enableBiometric();
  }
}

export async function enableBiometric() {
  try {
    const id = await registerBiometric();
    await saveSettings({ lockCredId: id });
    toast('Face ID unlock is on');
  } catch (e) {
    toast(e?.name === 'NotAllowedError' ? 'Face ID setup was cancelled' : 'Face ID isn’t available here');
  }
}

export async function disableLock() {
  const pin = await pinEntrySheet('Turn off app lock', 'Enter your current PIN.');
  if (!pin) return;
  if (await hashPin(pin, state.settings.lockSalt) !== state.settings.lockPinHash) { toast('Wrong PIN'); return; }
  await saveSettings({ lockPinHash: null, lockSalt: null, lockCredId: null });
  toast('App lock is off');
}
