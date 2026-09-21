import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

const LABEL = process.argv[2] || 'run'
const BASE = process.env.BASE || 'http://localhost:3000'
const OUT = path.join(process.cwd(), 'shots', LABEL)
fs.mkdirSync(OUT, { recursive: true })

const months = ['2025-01','2025-02','2025-03','2025-04','2025-05','2025-06','2025-07','2025-08','2025-09','2025-10','2025-11','2025-12']
const series = (base, amp) => months.map((_, i) => Math.round(base + Math.sin(i / 2) * amp))
const user = { id: 5, email: 'amit@example.in', full_name: 'Amit Kumar', phone: '9870111111', role: 'tenant', is_active: true, created_at: '2025-01-01T00:00:00Z' }
const property = { id: 1, title: 'Antriksh Heights — 2BHK', address: 'A-304, Antriksh Heights, Andheri West', city: 'Mumbai', state: 'Maharashtra', pincode: '400053', property_type: 'apartment', bedrooms: 2, bathrooms: 2, area_sqft: 950, rent_amount: 48000, description: 'Spacious 2BHK', amenities: '["Gym","Pool"]', is_available: false, owner_id: 2, tenant_id: 5, created_at: '2025-01-01T00:00:00Z' }
const analytics = {
  expense_trends: {
    electricity: { values: series(2200, 700), direction: 'increasing' },
    water: { values: series(330, 30), direction: 'stable' },
    gas: { values: series(800, 150), direction: 'decreasing' },
    internet: { values: series(999, 0), direction: 'stable' },
    maintenance: { values: series(2000, 500), direction: 'increasing' },
  },
  forecast_next_month: { electricity: 2400, water: 320, gas: 700, internet: 999, maintenance: 2200 },
  current_living_cost: { month: '2025-12', rent: 48000, electricity: 2050, water: 310, gas: 1010, internet: 999, maintenance: 3000, other: 0, total: 7369 },
  payment_history: months.map((m, i) => ({ id: 100 + i, amount: 48000, month: m, status: i === 11 ? 'pending' : 'completed', payment_date: m + '-01' })).reverse(),
  summary: { avg_monthly_cost: 7100, max_monthly_cost: 9200, min_monthly_cost: 5800, months_tracked: 12 },
}
const market = {
  deviation: { tenant_rent: 48000, market_rent: 44500, deviation: 3500, deviation_percent: 7.9, is_above_market: true, status: 'above_market' },
  similar_properties: [
    { title: 'Powai Lake View 3BHK', city: 'Mumbai', bedrooms: 3, area_sqft: 1600, rent_amount: 85000 },
    { title: 'Malad East 1BHK', city: 'Mumbai', bedrooms: 1, area_sqft: 580, rent_amount: 26000 },
    { title: 'Bandra West 2BHK', city: 'Mumbai', bedrooms: 2, area_sqft: 950, rent_amount: 65000 },
  ],
}
const payments = months.map((m, i) => ({ id: 100 + i, amount: 48000, payment_date: m + '-01T09:00:00Z', status: i === 11 ? 'pending' : 'completed', month: m, notes: 'Monthly rent — UPI payment', tenant_id: 5, property_id: 1, created_at: m + '-01T09:00:00Z' })).reverse()
const documents = [
  { id: 1, filename: 'electricity_bill_dec.pdf', file_url: 'uploads/x.pdf', document_type: 'electricity_bill', status: 'completed', confidence_score: 0.82, uploaded_at: '2025-12-05T10:00:00Z', user_id: 5, extracted_data: { amount: 2050 } },
  { id: 2, filename: 'water_bill_dec.png', file_url: 'uploads/y.png', document_type: 'water_bill', status: 'flagged', confidence_score: 0.51, uploaded_at: '2025-12-06T10:00:00Z', user_id: 5, extracted_data: {} },
]
const maintenance = [
  { id: 'a1', title: 'Leaking tap in bathroom', description: 'Kitchen tap drips constantly', urgency: 'high', status: 'open', property_title: property.title, created_at: '2025-12-01T10:00:00' },
  { id: 'a2', title: 'AC not cooling', description: 'Bedroom AC', urgency: 'medium', status: 'in_progress', property_title: property.title, created_at: '2025-11-20T10:00:00' },
  { id: 'a3', title: 'Broken door handle', description: '', urgency: 'low', status: 'resolved', property_title: property.title, created_at: '2025-10-11T10:00:00' },
]
const notifs = [
  { id: 'n1', type: 'approved', title: 'Application Approved!', message: "Congratulations! Your application for 'Antriksh Heights' has been approved.", read: false, created_at: '2025-12-05T10:00:00' },
  { id: 'n2', type: 'ocr_complete', title: 'Document Processed', message: 'Your Electricity Bill was processed successfully (confidence: 82%).', read: true, created_at: '2025-12-04T10:00:00' },
  { id: 'n3', type: 'rent_due', title: 'Rent Due Reminder', message: 'Your rent of ₹48,000/mo is due.', read: false, created_at: '2025-12-01T10:00:00' },
]
const listing = (id, i) => ({ id, title: `Sample Listing ${i}`, address: `Flat ${i}, Some Society, Bandra West`, city: 'Mumbai', state: 'Maharashtra', property_type: 'apartment', bedrooms: 1 + (i % 3), bathrooms: 1 + (i % 3), area_sqft: 600 + i * 100, rent_amount: 20000 + i * 9000, description: 'Modern flat close to metro and shopping.', amenities: 'Parking, Gym, Swimming Pool, 24x7 Security, Lift', security_deposit: 80000, is_available: true })
const searchResults = [1, 2, 3, 4, 5, 6].map((i) => listing(i, i))
const listings = [1, 2, 3, 4, 5, 6].map((i) => listing('ext_mumbai_' + i, i))
const applications = [
  { property_id: 6, property_title: 'Bandra West 2BHK', property_address: '301 Turner Road', property_city: 'Mumbai', rent_amount: 65000, status: 'pending', applied_at: '2025-12-01T10:00:00' },
  { property_id: 7, property_title: 'Powai Lake View 3BHK', property_address: 'B-12 Hiranandani', property_city: 'Mumbai', rent_amount: 85000, status: 'approved', applied_at: '2025-11-01T10:00:00', id: 'x1' },
  { property_id: null, property_title: 'Kothrud 2BHK', property_address: 'Paud Road', property_city: 'Pune', rent_amount: 28000, status: 'rejected', applied_at: '2025-10-01T10:00:00' },
]
const contacts = [{ id: 2, name: 'Vikram Mehta', role: 'owner', email: 'vikram@propai.in' }, { id: 1, name: 'Rajesh Sharma', role: 'manager', email: 'rajesh@propai.in' }]
const messages = [
  { id: 'm1', from_id: 5, from_name: 'Amit Kumar', to_id: 2, subject: 'Property Query', body: 'Hello, the kitchen tap is leaking.', read: true, created_at: '2025-12-01T10:00:00' },
  { id: 'm2', from_id: 2, from_name: 'Vikram Mehta', to_id: 5, subject: 'Re: leak', body: 'Sure, I will send a plumber tomorrow.', read: true, created_at: '2025-12-01T11:00:00' },
]

const routes = [
  [/\/auth\/me/, user], [/\/notifications\/$/, notifs], [/\/notifications\/unread-count/, { count: 2 }],
  [/\/analytics\/dashboard\//, analytics], [/\/analytics\/market-comparison\//, market],
  [/\/financial\/payments/, payments], [/\/documents\//, documents], [/\/maintenance\//, maintenance],
  [/\/properties\/search/, searchResults], [/\/properties\/listings/, listings],
  [/\/properties\/my-applications/, applications], [/\/properties\/$/, [property]],
  [/\/messages\/contacts/, contacts], [/\/messages\/unread-count/, { count: 0 }], [/\/messages\/$/, messages],
]

const PAGES = [
  ['overview', '/tenant'], ['documents', '/tenant/documents'], ['payments', '/tenant/payments'],
  ['analytics', '/tenant/analytics'], ['search', '/tenant/search'], ['maintenance', '/tenant/maintenance'],
  ['messages', '/messages'],
]

// ── contrast audit executed inside the page ────────────────────────────────
const auditFn = () => {
  const parse = (s) => {
    const m = s.match(/rgba?\(([^)]+)\)/)
    if (!m) return null
    const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number)
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }
  }
  const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 })
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05) }
  const bgOf = (el) => {
    const stack = []
    let n = el
    while (n && n.nodeType === 1) {
      const cs = getComputedStyle(n)
      const c = parse(cs.backgroundColor)
      if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break }
      if (cs.backgroundImage && cs.backgroundImage.includes('gradient')) {
        const cols = [...cs.backgroundImage.matchAll(/rgba?\([^)]+\)/g)].map((m) => parse(m[0])).filter(Boolean)
        if (cols.length) { stack.push(cols.reduce((a, b) => (lum(a) > lum(b) ? a : b))); break }
      }
      n = n.parentElement
    }
    let bg = { r: 255, g: 255, b: 255, a: 1 }
    for (let i = stack.length - 1; i >= 0; i--) bg = over(stack[i], bg)
    return bg
  }
  const out = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  let t
  while ((t = walker.nextNode())) {
    const txt = t.textContent.trim()
    if (!txt) continue
    const el = t.parentElement
    if (!el || el.closest('svg, script, style')) continue
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue
    const fg = parse(cs.color)
    if (!fg) continue
    const bg = bgOf(el)
    const eff = over(fg, bg)
    const size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight) >= 700
    const large = size >= 24 || (size >= 18.66 && bold)
    const cr = ratio(eff, bg)
    if (cr < (large ? 3 : 4.5)) out.push({ ratio: +cr.toFixed(2), text: txt.slice(0, 40), cls: (el.className || '').toString().slice(0, 70), size })
  }
  return out
}

const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true })
const summary = {}
for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1500 }, colorScheme: theme })
  await ctx.addInitScript(([t]) => { localStorage.setItem('propai-theme', t); localStorage.setItem('token', 'fake') }, [theme])
  const page = await ctx.newPage()
  const logs = []
  const unmocked = new Set()
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text().slice(0, 200)}`) })
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message.slice(0, 200)}`))
  await page.route('http://localhost:8000/**', (route) => {
    const url = new URL(route.request().url())
    const method = route.request().method()
    if (method !== 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
    const hit = routes.find(([re]) => re.test(url.pathname + (url.pathname.endsWith('/') || url.search ? '' : '')))
    if (hit) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(hit[1]) })
    unmocked.add(url.pathname)
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })
  // verification-only: make the (pre-existing, out-of-scope) broken "Enquire Now" button open the modal
  await page.route('**/src/pages/tenant/PropertySearch.jsx*', async (route) => {
    const res = await route.fetch()
    let body = await res.text()
    body = body.replace(/const \[enquiryProp, (setEnquiryProp2?)\] = useState\(null\);?/, (m, s) => m + ` window.__setEnq = ${s};`)
    body = body.replace(/onClick: \(\) => setEnquiryProp\(prop\)/, 'onClick: () => window.__setEnq(prop)')
    await route.fulfill({ response: res, body })
  })

  for (const [name, url] of PAGES) {
    await page.goto(BASE + url, { waitUntil: 'networkidle' })
    await page.waitForTimeout(700)
    await page.screenshot({ path: path.join(OUT, `${theme}-${name}.png`) })
    const fails = await page.evaluate(auditFn)
    summary[`${theme}/${name}`] = { contrastFails: fails.length, worst: fails.sort((a, b) => a.ratio - b.ratio).slice(0, 6) }
  }

  // extra states
  await page.goto(BASE + '/tenant', { waitUntil: 'networkidle' })
  await page.locator('button', { hasText: 'Notifications' }).first().click()
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(OUT, `${theme}-notification-dropdown.png`) })
  let f = await page.evaluate(auditFn); summary[`${theme}/notification-dropdown`] = { contrastFails: f.length, worst: f.slice(0, 6) }

  await page.goto(BASE + '/tenant/search', { waitUntil: 'networkidle' })
  await page.getByText('PropAI Listings', { exact: false }).first().click()
  await page.locator('form button[type=submit]').first().click()
  await page.waitForTimeout(600)
  await page.getByText('Enquire Now').first().click()
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(OUT, `${theme}-enquiry-modal.png`) })
  f = await page.evaluate(auditFn); summary[`${theme}/enquiry-modal`] = { contrastFails: f.length, worst: f.sort((a, b) => a.ratio - b.ratio).slice(0, 6) }

  await page.goto(BASE + '/tenant/search', { waitUntil: 'networkidle' })
  await page.getByText('My Applications').first().click()
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(OUT, `${theme}-applications-tab.png`) })
  f = await page.evaluate(auditFn); summary[`${theme}/applications-tab`] = { contrastFails: f.length, worst: f.sort((a, b) => a.ratio - b.ratio).slice(0, 6) }

  // mobile sidebar
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(BASE + '/tenant', { waitUntil: 'networkidle' })
  await page.locator('button:has(svg.lucide-menu)').first().click()
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(OUT, `${theme}-mobile-sidebar.png`) })

  summary[`${theme}/CONSOLE`] = [...new Set(logs)]
  summary[`${theme}/UNMOCKED`] = [...unmocked]
  await ctx.close()
}
await browser.close()
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2))
let total = 0
for (const [k, v] of Object.entries(summary)) {
  if (v && typeof v.contrastFails === 'number') { total += v.contrastFails; console.log(k.padEnd(34), 'contrast fails:', v.contrastFails) }
}
console.log('TOTAL contrast fails:', total)
for (const k of Object.keys(summary).filter((k) => k.endsWith('CONSOLE') || k.endsWith('UNMOCKED'))) console.log(k, JSON.stringify(summary[k]))
