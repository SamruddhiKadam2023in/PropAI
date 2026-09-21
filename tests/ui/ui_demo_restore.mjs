import { chromium } from 'playwright-core'
import path from 'node:path'
import fs from 'node:fs'
const BASE = 'http://localhost:3000'
const OUT = path.resolve('shots/demo-restore'); fs.mkdirSync(OUT, { recursive: true })
const results = []
const check = (name, ok, detail = '') => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== '' ? `  [${String(detail).slice(0, 150)}]` : '')) }
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true })

for (const [sname, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }], ['small', { width: 320, height: 640 }]]) {
  const ctx = await browser.newContext({ viewport }); const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.location().url || '')) errs.push(m.text()) })
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  const text = await page.evaluate(() => document.body.innerText)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
  check(`${sname}: panel visible with Manager / Owner / Tenant and the password line, no overflow, no errors`,
    /QUICK DEMO LOGIN/i.test(text) && /rajesh@propai\.in/.test(text) && /vikram@propai\.in/.test(text) && /amit@example\.in/.test(text) && /PropAI@2024/.test(text) && !overflow && errs.length === 0, `overflow=${overflow} errs=${errs.length}`)
  check(`${sname}: "by MES Pillai CoE" still removed`, !/Pillai/.test(text))
  await page.screenshot({ path: `${OUT}/login-${sname}.png`, fullPage: true })
  await ctx.close()
}

for (const [role, email, route] of [['Manager', 'rajesh@propai.in', '/manager'], ['Owner', 'vikram@propai.in', '/owner'], ['Tenant', 'amit@example.in', '/tenant']]) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const page = await ctx.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.locator('button', { hasText: email }).click()
  check(`click "${role}" fills the email and password`, (await page.inputValue('input[type=email]')) === email && (await page.inputValue('input[type=password]')) === 'PropAI@2024')
  await page.locator('button[type=submit]').click()
  await page.waitForURL(`**${route}`, { timeout: 15000 }).then(() => check(`${role} quick login signs in and lands on ${route}`, true), () => check(`${role} quick login signs in`, false))
  await ctx.close()
}
await browser.close()
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`)
process.exit(results.every(Boolean) ? 0 : 1)
