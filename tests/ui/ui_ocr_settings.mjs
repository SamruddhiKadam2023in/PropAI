// Browser tests: the new OCR Settings page (/settings/ocr) - Owner and Manager can view/change it, Tenant
// never sees it. Restores the original ocr_config document afterward (it's a single shared document, not
// throwaway data).
import { chromium } from 'playwright-core'
import { execFileSync } from 'node:child_process'

const BASE = 'http://localhost:3000'
const API = 'http://localhost:8000'

const results = []
const check = (name, ok, detail = '') => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? `  [${String(detail).slice(0, 160)}]` : '')) }

function mongoEval(js) {
  return execFileSync('docker', ['exec', 'property_mongodb', 'mongosh', '-u', 'mongo', '-p', 'mongo123',
    '--authenticationDatabase', 'admin', 'property_management', '--quiet', '--eval', js], { encoding: 'utf8' }).trim()
}

async function login(email, password) {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
  return (await r.json()).access_token
}

async function newSession(browser, token) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
  if (token) await ctx.addInitScript((t) => localStorage.setItem('token', t), token)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)))
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text().slice(0, 160)) })
  return { ctx, page, errors }
}

const original = mongoEval('JSON.stringify(db.ocr_config.findOne({}, {_id: 0}))')   // 'null' if none exists yet; _id excluded (immutable, and irrelevant to restore)

const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true })
try {
  const ownerTok = await login('vikram@propai.in', 'PropAI@2024')
  const mgrTok = await login('rajesh@propai.in', 'PropAI@2024')
  const tenantTok = await login('amit@example.in', 'PropAI@2024')

  // ---- Owner: can see the nav link, open the page, change settings, and it persists ----
  {
    const { ctx, page, errors } = await newSession(browser, ownerTok)
    await page.goto(`${BASE}/owner`, { waitUntil: 'networkidle' })
    check('Owner sees "OCR Settings" in the sidebar', await page.getByRole('link', { name: 'OCR Settings' }).isVisible(), 'nav link missing')

    await page.getByRole('link', { name: 'OCR Settings' }).click()
    await page.waitForURL('**/settings/ocr')
    await page.getByTestId('ocr-engine').waitFor({ timeout: 10000 })

    await page.getByTestId('ocr-engine').selectOption('tesseract')
    await page.getByTestId('ocr-threshold').fill('0.80')
    check('Save is enabled once a value actually changed', await page.getByTestId('save-ocr-settings').isEnabled())
    await page.getByTestId('save-ocr-settings').click()
    await page.getByText('OCR settings saved').waitFor({ timeout: 10000 })
    check('a success toast appears after saving', true)

    await page.reload({ waitUntil: 'networkidle' })
    check('engine choice persisted after reload', await page.getByTestId('ocr-engine').inputValue() === 'tesseract', await page.getByTestId('ocr-engine').inputValue())
    check('threshold persisted after reload', await page.getByTestId('ocr-threshold').inputValue() === '0.8', await page.getByTestId('ocr-threshold').inputValue())
    check('"last changed by" shows the owner\'s email', (await page.getByTestId('ocr-settings-meta').innerText()).includes('vikram@propai.in'), await page.getByTestId('ocr-settings-meta').innerText())

    // ---- validation: an out-of-range threshold is refused client-side, no false success ----
    await page.getByTestId('ocr-threshold').fill('1.50')
    await page.getByTestId('save-ocr-settings').click()
    await page.getByTestId('ocr-settings-form-error').waitFor({ timeout: 5000 })
    check('an out-of-range threshold (1.50) is rejected with an inline error, not silently saved',
          (await page.getByTestId('ocr-settings-form-error').innerText()).length > 0)

    check('no console or page errors on the Owner session', errors.length === 0, errors.join(' ; '))
    await ctx.close()
  }

  // ---- Manager: can also see and use the same page ----
  {
    const { ctx, page, errors } = await newSession(browser, mgrTok)
    await page.goto(`${BASE}/manager`, { waitUntil: 'networkidle' })
    check('Manager sees "OCR Settings" in the sidebar', await page.getByRole('link', { name: 'OCR Settings' }).isVisible())

    await page.goto(`${BASE}/settings/ocr`, { waitUntil: 'networkidle' })
    await page.getByTestId('ocr-engine').waitFor({ timeout: 10000 })
    await page.getByTestId('ocr-engine').selectOption('auto')
    await page.getByTestId('save-ocr-settings').click()
    await page.getByText('OCR settings saved').waitFor({ timeout: 10000 })
    check('a Manager can change OCR settings and it saves', true)
    check('"last changed by" now shows the manager\'s email', (await page.getByTestId('ocr-settings-meta').innerText()).includes('rajesh@propai.in'), await page.getByTestId('ocr-settings-meta').innerText())

    check('no console or page errors on the Manager session', errors.length === 0, errors.join(' ; '))
    await ctx.close()
  }

  // ---- Tenant: never sees the link, and a direct hit on the URL redirects away ----
  {
    const { ctx, page, errors } = await newSession(browser, tenantTok)
    await page.goto(`${BASE}/tenant`, { waitUntil: 'networkidle' })
    check('Tenant does NOT see "OCR Settings" in the sidebar', await page.getByRole('link', { name: 'OCR Settings' }).count() === 0)

    await page.goto(`${BASE}/settings/ocr`, { waitUntil: 'networkidle' })
    check('a Tenant hitting the URL directly is redirected away, not shown the page', !page.url().includes('/settings/ocr'), page.url())

    check('no console or page errors on the Tenant session', errors.length === 0, errors.join(' ; '))
    await ctx.close()
  }
} finally {
  await browser.close()
  if (original && original !== 'null') {
    mongoEval(`db.ocr_config.updateOne({}, {$set: ${original}}, {upsert: true})`)
  } else {
    mongoEval('db.ocr_config.deleteMany({})')
  }
  const restored = mongoEval('JSON.stringify(db.ocr_config.findOne({}, {_id: 0}))')
  check('cleanup: ocr_config restored to its original state', restored === original, { restored, original })
}
console.log(`\n${results.filter(Boolean).length}/${results.length} UI checks passed`)
process.exit(results.every(Boolean) ? 0 : 1)
