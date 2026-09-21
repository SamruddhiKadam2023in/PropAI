// A Marathi + English bill, read for real, shows its address / due date / period on the document card (desktop light, phone dark).
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const BASE = 'http://localhost:3000'
const API = 'http://localhost:8000'
const BILLS = path.resolve('../assets/bills')
const OUT = 'shots/ocr'
fs.mkdirSync(OUT, { recursive: true })
const EMAIL = 'ocrui_tenant@example.com', PW = 'OcrUi-Pass-1'

const results = []
const check = (name, ok, detail = '') => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? `  [${detail}]` : '')) }
const post = (url, body, tok) => fetch(API + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: JSON.stringify(body) })
const psql = (sql) => execFileSync('docker', ['exec', '-i', 'property_postgres', 'psql', '-U', 'postgres', '-d', 'property_management', '-At'], { input: sql, encoding: 'utf8' })

const mgr = (await (await post('/auth/login', { email: 'rajesh@propai.in', password: 'PropAI@2024' })).json()).access_token
const made = await post('/auth/users', { email: EMAIL, full_name: 'OCR UI', password: PW, role: 'tenant' }, mgr)
if (made.status !== 201) { console.log('FAIL could not create the throwaway tenant', made.status); process.exit(1) }
const tok = (await (await post('/auth/login', { email: EMAIL, password: PW })).json()).access_token
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true })

try {
  const ids = []
  for (const f of ['msedcl_airoli.png', 'mcgm_water.png']) {
    const fd = new FormData()
    fd.append('file', new Blob([fs.readFileSync(path.join(BILLS, f))], { type: 'image/png' }), f)
    const r = await fetch(`${API}/documents/upload`, { method: 'POST', headers: { Authorization: `Bearer ${tok}` }, body: fd })
    ids.push((await r.json()).id)
  }
  for (let i = 0; i < 60; i++) {
    const docs = await Promise.all(ids.map(async (id) => (await fetch(`${API}/documents/${id}`, { headers: { Authorization: `Bearer ${tok}` } })).json()))
    if (docs.every((d) => !['pending', 'processing'].includes(d.status))) break
    await new Promise((r) => setTimeout(r, 2000))
  }

  for (const [label, viewport, scheme] of [['desktop-light', { width: 1280, height: 1400 }, 'light'], ['phone-dark', { width: 390, height: 900 }, 'dark']]) {
    const ctx = await browser.newContext({ viewport, colorScheme: scheme })
    await ctx.addInitScript(([t, k, s]) => { localStorage.setItem('token', k); localStorage.setItem('propai-theme', s) }, [scheme, tok, scheme])
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)))
    page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text().slice(0, 160)) })
    await page.goto(`${BASE}/tenant/documents`, { waitUntil: 'networkidle' })
    await page.waitForSelector('[data-testid="doc-address"]', { timeout: 15000 }).catch(() => {})
    const addr = await page.locator('[data-testid="doc-address"]').allInnerTexts()
    const text = addr.join(' | ')
    check(`${label}: both bills show an Address block`, addr.length === 2, addr.length)
    check(`${label}: Airoli bill address, Navi Mumbai / Maharashtra / PIN badges`, /KRUPA/i.test(text) && /Airoli/.test(text) && /Navi Mumbai/.test(text) && /400708/.test(text), text.slice(0, 160))
    check(`${label}: Mumbai water bill address and PIN 400088`, /Govandi/.test(text) && /400088/.test(text), text.slice(-120))
    const body = await page.innerText('body')
    check(`${label}: due date and billing period shown`, /28\/03\/2024/.test(body) && /09\/02\/2024 to 10\/03\/2024/.test(body))
    check(`${label}: duplicate bill note shown once`, (await page.locator('[data-testid="doc-duplicate"]').count()) === 1)
    check(`${label}: no undefined/NaN text`, !/undefined|NaN/.test(body))
    check(`${label}: no sideways scrolling`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
    check(`${label}: no console or page errors`, errors.length === 0, errors.join(' ; '))
    await page.screenshot({ path: `${OUT}/${label}.png`, fullPage: true })
    await ctx.close()
  }
} finally {
  await browser.close()
  psql(`delete from documents where user_id in (select id from users where email='${EMAIL}'); delete from users where email='${EMAIL}';`)
  check('cleanup: throwaway tenant and documents removed', psql(`select count(*) from users where email='${EMAIL}'`).trim() === '0')
}
console.log(`\n${results.filter(Boolean).length}/${results.length} UI checks passed`)
process.exit(results.every(Boolean) ? 0 : 1)
