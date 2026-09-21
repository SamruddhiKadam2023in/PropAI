import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

const BASE = 'http://localhost:3000', API = 'http://localhost:8000'
const OUT = path.resolve('shots/responsive'); fs.mkdirSync(OUT, { recursive: true })
const USERS = { tenant: 'amit@example.in', owner: 'vikram@propai.in', manager: 'rajesh@propai.in' }
const ROUTES = {
  public: ['/login', '/register', '/verify-email'],
  tenant: ['/tenant', '/tenant/documents', '/tenant/payments', '/tenant/analytics', '/tenant/search', '/tenant/maintenance', '/messages', '/tenant/notifications'],
  owner: ['/owner', '/owner/properties', '/owner/applications', '/owner/documents', '/owner/analytics', '/owner/maintenance', '/owner/agreements'],
  manager: ['/manager', '/manager/users', '/manager/properties', '/manager/applications', '/manager/rent-collection', '/manager/agreements', '/manager/analytics'],
}
const SIZES = { 'phone-320': { width: 320, height: 640 }, 'phone-390': { width: 390, height: 844 }, 'tablet-768': { width: 768, height: 1024 }, 'laptop-1280': { width: 1280, height: 800 } }
const tokens = {}
for (const [k, e] of Object.entries(USERS)) {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: e, password: 'PropAI@2024' }) })
  tokens[k] = (await r.json()).access_token
}
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true })

const probe = () => {
  const vw = document.documentElement.clientWidth
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0' }
  const desc = (el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.split(/\s+/).slice(0, 2).join('.') : ''}`.slice(0, 60)
  const inScroller = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if ((o === 'auto' || o === 'scroll') && p.scrollWidth > p.clientWidth) return true; if (p === document.body) break } return false }
  const out = { pageOverflow: document.documentElement.scrollWidth - vw, sticksOut: [], clipped: [], smallTargets: [], tinyText: 0, scrollers: 0 }
  for (const el of document.body.querySelectorAll('*')) {
    if (!vis(el)) continue
    const r = el.getBoundingClientRect(), s = getComputedStyle(el)
    // 1. content that pokes past the right edge of the screen and can't be reached by scrolling inside a scroller
    if (r.right > vw + 1 && !inScroller(el) && s.position !== 'fixed' && r.width < vw * 3) out.sticksOut.push(`${desc(el)} right=${Math.round(r.right)}`)
    // 2. text cut off (overflow hidden/ellipsis with more content than box)
    if ((s.overflow === 'hidden' || s.overflowX === 'hidden' || s.textOverflow === 'ellipsis') && el.scrollWidth > el.clientWidth + 2 && el.innerText && el.innerText.trim() && el.children.length < 4) {
      // ellipsis on purpose with a title/aria is acceptable only if it has title
      if (!el.title) out.clipped.push(`${desc(el)} "${el.innerText.trim().slice(0, 30)}" ${el.scrollWidth}>${el.clientWidth}`)
    }
    // 3. tap targets under 32px on the short side (WCAG 2.2 min 24, comfortable 44)
    if (['A', 'BUTTON', 'SELECT', 'INPUT', 'TEXTAREA'].includes(el.tagName) && el.type !== 'hidden' && el.type !== 'radio' && el.type !== 'checkbox' && (r.height < 32 || (r.width < 32 && el.innerText?.trim().length < 2))) out.smallTargets.push(`${desc(el)} ${Math.round(r.width)}x${Math.round(r.height)} "${(el.innerText || el.ariaLabel || '').trim().slice(0, 20)}"`)
    if (el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && parseFloat(s.fontSize) < 11) out.tinyText++
    if ((s.overflowX === 'auto' || s.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 2) out.scrollers++
  }
  return out
}

const report = []
for (const [group, routes] of Object.entries(ROUTES)) {
  for (const route of routes) {
    for (const [sname, viewport] of Object.entries(SIZES)) {
      const ctx = await browser.newContext({ viewport, hasTouch: sname.startsWith('phone'), isMobile: sname.startsWith('phone') })
      if (group !== 'public') await ctx.addInitScript((t) => localStorage.setItem('token', t), tokens[group])
      const page = await ctx.newPage()
      await page.goto(BASE + route, { waitUntil: 'networkidle' })
      await page.waitForTimeout(700)
      const r = await page.evaluate(probe)
      report.push({ group, route, size: sname, ...r })
      if (sname === 'phone-390' || sname === 'phone-320') await page.screenshot({ path: `${OUT}/${group}${route.replace(/\//g, '_')}-${sname}.png`, fullPage: false })
      await ctx.close()
    }
  }
}
await browser.close()
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1))

const bad = (r) => r.pageOverflow > 1 || r.sticksOut.length || r.clipped.length
console.log(`pages x sizes audited: ${report.length}`)
for (const size of Object.keys(SIZES)) {
  const rs = report.filter((r) => r.size === size)
  console.log(`\n### ${size}: ${rs.filter((r) => !bad(r)).length}/${rs.length} pages with no overflow/cut-off text | small tap targets on ${rs.filter((r) => r.smallTargets.length).length} pages | tiny text on ${rs.filter((r) => r.tinyText).length} pages`)
  for (const r of rs.filter(bad)) console.log(`  ✗ ${r.group}${r.route}: pageOverflow=${r.pageOverflow} sticksOut=${JSON.stringify(r.sticksOut.slice(0, 3))} clipped=${JSON.stringify(r.clipped.slice(0, 3))}`)
}
console.log('\nMost common small tap targets on phones:')
const tally = {}
for (const r of report.filter((x) => x.size === 'phone-390')) for (const t of r.smallTargets) { const k = t.replace(/ right=.*/, ''); tally[k] = (tally[k] || 0) + 1 }
for (const [k, n] of Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`  ${n}x ${k}`)
