// Generates the three SAMPLE bills used by the OCR tests (tests/assets/bills/*.png). Every name, number, address line and date on
// them is invented: no real person or customer appears anywhere. Each carries a "SAMPLE - TEST DATA" stamp.
//
//   cd tests && node assets/make_bills.mjs          (needs Edge or Chrome; on Windows the Nirmala UI font draws the Marathi)
//
// Afterwards refresh the saved readings the unit tests use:  see tests/README.md ("Sample bills").
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'bills')
fs.mkdirSync(OUT, { recursive: true })
const STAMP = '<div class="stamp">SAMPLE - TEST DATA</div>'
const CSS = `
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,'Nirmala UI',sans-serif;color:#222;background:#fbfbf8;position:relative}
  .stamp{position:absolute;right:8px;bottom:6px;font-size:9px;color:#888;letter-spacing:1px}
  table{border-collapse:collapse}
  td{vertical-align:top}
`

// ── 1. Marathi + English electricity bill (MSEDCL layout) ───────────────────────────────────────────────────────────
const msedcl = `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}
  .logo{color:#c0392b;font-weight:bold;font-size:30px}
  .box{border:1px solid #999;padding:4px 8px}
  .pink{background:#f6d5d5;border:1px solid #c99}
  .row{display:flex;justify-content:space-between;gap:10px;padding:3px 0;font-size:13px}
  .small{font-size:9.5px}
  .blue{background:#dfe9f3}
  .ad{background:#4b2e83;color:#fff;padding:14px;margin:10px 0;border:3px solid #e33}
  .ad b{font-size:30px}
</style></head><body style="width:587px;height:831px;padding:10px 14px">
  <div style="display:flex;justify-content:space-between;align-items:flex-start">
    <div><div class="logo">महावितरण</div><div class="small">महाराष्ट्र राज्य वीज वितरण कंपनी मर्यादित</div><div class="small">CIN: U00000MH0000SGC000000</div></div>
    <div class="box" style="width:230px;text-align:center;font-size:13px">वीज पुरवठा देयक<br><span class="small">BILL OF SUPPLY FOR THE MONTH OF : मार्च-2024</span></div>
    <div class="small">File No: 1-1/500-M</div>
  </div>
  <div style="display:flex;gap:12px;margin-top:8px">
    <div style="flex:1;font-size:11px;line-height:1.5">
      <div>BILL NO.(GGN):000000123456789</div>
      <div>ग्राहक क्रमांक: <b>000012345678</b> &nbsp; मोबाईल/ईमेल</div>
      <div style="margin-top:6px"><b>SUNIL RAMCHANDRA KULKARNI &amp; SUMAN SUNIL KULKARNI</b></div>
      <div>FLAT NO-401, SAI KRUPA APARTMENTS, PLOT 17 SECTOR 5, AIROLI, NAVI MUMBAI, 400708</div>
    </div>
    <div class="pink" style="width:200px;padding:4px 8px">
      <div class="row"><span>देयक दिनांक</span><b>: 12-03-2024</b></div>
      <div class="row"><span>देयक रक्कम</span><b>: 2,480.00</b></div>
      <div class="row"><span>देय दिनांक</span><b>: 28-03-2024</b></div>
      <div class="row"><span>या तारखेनंतर भरल्यास</span><b>2,510.00</b></div>
    </div>
  </div>
  <div style="display:flex;gap:12px;margin-top:10px;font-size:10.5px">
    <table style="flex:1;line-height:1.6">
      <tr><td>बिलिंग युनिट</td><td>: 4641/AIROLI S/DN./THANE DIVISION</td></tr>
      <tr><td>दर संकेत **</td><td>: 92/LT I Res 3-Phase</td></tr>
      <tr><td>पोल क्रमांक</td><td>: 00001111</td></tr>
      <tr><td>मीटर क्रमांक</td><td>: 06500000033</td></tr>
    </table>
    <table style="width:220px;line-height:1.6">
      <tr><td>मंजूर भार</td><td>: 5.00 KW</td></tr>
      <tr><td>सुरक्षा ठेव जमा</td><td>: 3000.00</td></tr>
      <tr><td>चालू रीडिंग दिनांक</td><td>: 06-03-2024</td></tr>
      <tr><td>मागील रीडिंग दिनांक</td><td>: 06-02-2024</td></tr>
    </table>
  </div>
  <table style="width:100%;margin-top:10px;font-size:11px;text-align:center;border:1px solid #aaa" border="1">
    <tr class="blue"><td>चालू रीडिंग</td><td>मागील रीडिंग</td><td>गुणक</td><td>युनिट</td><td>एकूण वापर</td></tr>
    <tr><td>2810</td><td>2620</td><td>1.00</td><td>190</td><td>190</td></tr>
  </table>
  <div class="small" style="margin-top:8px;line-height:1.5">Meter Status: Normal<br>Tariff: LT I Residential. Fixed charge, energy charge, wheeling charge, electricity duty and tax on sale are included in the bill. Pay online at www.example-discom.test</div>
  <div class="ad"><span style="font-size:14px">Pay - Scratch - Win Rewards</span><br><b>UP TO ₹500</b> on your MSEDCL bill payment<br><span class="small">Update the app to get scratch cards. Offer applicable only for bills paid before the due date.</span></div>
  <div style="border-top:1px dashed #666;padding-top:6px;font-size:11px;line-height:1.7">
    <div class="row"><span>बिलिंग युनिट: 4641</span><span>ग्राहक क्रमांक 000012345678</span><span>Rs. 2,480.00</span></div>
    <div class="row"><span>अंतिम तारीख 28-03-2024</span><span>या तारखेपर्यंत भरल्यास</span><span>28-03-2024 &nbsp; Rs. 2,480.00</span></div>
    <div class="row"><span></span><span>या तारखेनंतर भरल्यास</span><span>29-03-2024 &nbsp; Rs. 2,510.00</span></div>
  </div>
  ${STAMP}
</body></html>`

// ── 2. Marathi + English water bill, DUPLICATE (MCGM layout) ────────────────────────────────────────────────────────
const mcgm = `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}
  .blue{background:#bfe0ea;border:1px solid #8ab}
  .pk{background:#efc9b6;border:1px solid #c98}
  .cell{border:1px solid #999;padding:3px 6px;font-size:10.5px}
  .r{display:flex;justify-content:space-between;padding:2px 0;font-size:12.5px}
</style></head><body style="width:688px;height:778px;padding:10px 12px">
  <div style="display:flex;justify-content:space-between;align-items:flex-start">
    <div style="font-size:11px">SAC:999111</div>
    <div style="text-align:center"><div style="font-size:20px;font-weight:bold">बृहन्मुंबई महानगरपालिका</div><div style="font-size:11px">- जल आकार देयक -</div></div>
    <div style="text-align:right"><div style="font-size:16px;font-weight:bold">DUPLICATE BILL</div><div style="font-size:9px">GSTIN:27AAAAA0000A1Z0</div></div>
  </div>
  <div style="display:flex;gap:8px;margin-top:8px">
    <div style="flex:1">
      <div class="cell" style="line-height:1.5"><b>जलजोडणी धारकाचे नाव आणि पत्ता :-</b><br><b>SHRI A B DESHMUKH</b><br>SAMPLE TRADERS PVT LTD, PLOT 12<br>STATION ROAD, GOVANDI, MUMBAI-400088</div>
      <div style="display:flex;gap:6px;margin-top:6px">
        <div class="cell" style="flex:1">विभाग (Ward)<br><b>M/East-ward</b></div>
        <div class="cell" style="flex:1">जलजोडणी क्र. (CCN)<br><b>MEB1111111</b></div>
      </div>
      <div style="display:flex;gap:6px;margin-top:6px">
        <div class="cell" style="flex:1">पुस्तक / पृष्ठ क्र. (Binder/Folio)<br><b>M 201 / 305</b></div>
        <div class="cell" style="flex:1">देयक क्रमांक (Bill No.)<br><b>2424TST0000001</b></div>
      </div>
      <div class="cell" style="margin-top:6px">जलजोडणी आकार (Connection Size MM): <b>15</b> &nbsp;&nbsp; दर (Rate Per KL): <b>59.42</b></div>
    </div>
    <div style="width:270px">
      <div class="blue" style="padding:4px 8px"><div class="r"><span>देयक कालावधी<br><small>(Bill Period)</small></span><b>09-02-2024 to 10-03-2024</b></div></div>
      <div class="blue" style="padding:4px 8px;margin-top:4px"><div class="r"><span>देय दिनांक<br><small>(Due Date)</small></span><b>10-04-2024</b></div></div>
      <div class="blue" style="padding:4px 8px;margin-top:4px"><div class="r"><span>देयक दिनांक<br><small>(Bill Date)</small></span><b>11-03-2024</b></div></div>
      <div class="blue" style="padding:4px 8px;margin-top:4px"><div class="r"><span>चालू देयक रक्कम<br><small>(Current Bill Amount)</small></span><b>1420</b></div></div>
      <div style="margin-top:8px;font-size:10.5px;line-height:1.7">Bill Process Date - &nbsp; <b>3/11/24 3:37 PM</b><br>Available Security Deposit &nbsp; ₹ 0</div>
    </div>
  </div>
  <div style="display:flex;gap:8px;margin-top:10px">
    <div class="pk cell" style="flex:1;line-height:1.7">मागील रीडिंग (Previous) 09-02-2024 &nbsp; <b>3780</b><br>चालू रीडिंग (Current) 10-03-2024 &nbsp; <b>3792</b><br>दिवस (Days) 29 &nbsp; वापर (Consumption KL) <b>12</b></div>
    <div style="width:270px">
      <div class="blue" style="padding:3px 8px"><div class="r"><span>जलआकार (Water Charges)</span><b>800</b></div></div>
      <div class="blue" style="padding:3px 8px;margin-top:3px"><div class="r"><span>मलनिःसारण आकार (Sewerage Charges 70%)</span><b>560</b></div></div>
      <div class="blue" style="padding:3px 8px;margin-top:3px"><div class="r"><span>मीटर भाडे (Meter Rent)</span><b>60</b></div></div>
      <div class="blue" style="padding:3px 8px;margin-top:3px"><div class="r"><span>मागील थकबाकी (Previous Outstanding)</span><b>0</b></div></div>
      <div class="blue" style="padding:3px 8px;margin-top:3px"><div class="r"><b>एकूण देय रक्कम (Total Payable Amount)</b><b>1420</b></div></div>
    </div>
  </div>
  <div class="cell" style="margin-top:14px;font-size:10px;line-height:1.5">महत्वाच्या सूचना: पाणी जपून वापरा. Please pay before the due date to avoid interest. Pay online through the corporation's portal or at any collection centre.</div>
  <div style="margin-top:14px;border-top:1px solid #444;padding-top:6px;font-size:10px;line-height:1.55">
    नाव व दुरुस्तीचा पत्ता :- &nbsp; MEB1111111 &nbsp; M 201 / 305<br>SHRI A B DESHMUKH<br>SAMPLE TRADERS PVT LTD, PLOT 12, STATION ROAD, GOVANDI, MUMBAI-400088
  </div>
  <div class="cell" style="margin-top:12px;font-size:10px;line-height:1.6"><b>पत्रव्यवहार पत्ता :-</b> Asst. Engineer (Water Works) M/East Ward, Municipal Office Building, Deonar, Mumbai 400043.<br>दूरध्वनी क्र. 022-00000000 &nbsp; ई-मेल आयडी: aeeeast@example.test</div>
  ${STAMP}
</body></html>`

// ── 3. Low-resolution English electricity bill (BSES layout): drawn on a full page, then shrunk until the small print is unreadable ──
const bses = `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}
  .o{background:#f4a23a;padding:6px 10px}
  .cell{border:1px solid #777;padding:4px 8px;font-size:15px}
</style></head><body style="width:1240px;height:1631px;padding:24px 40px;background:#fdfdfb">
  <div style="display:flex;justify-content:space-between;align-items:flex-start">
    <div style="font-size:70px;font-weight:900;color:#d3401d;letter-spacing:6px">BSES</div>
    <div style="text-align:center"><div style="font-size:36px;font-weight:bold">BSES Rajdhani Power Limited</div><div style="font-size:34px;margin-top:6px">Electricity Bill</div></div>
    <div class="o" style="font-size:14px;width:200px">Due Date<br><b style="font-size:15px">29-05-2024</b></div>
  </div>
  <div style="display:flex;gap:30px;margin-top:22px;font-size:15px;line-height:1.7">
    <div style="flex:1"><b>MR RAKESH SHARMA</b><br>H NO 24, GALI 3, SAMPLE NAGAR, DELHI - 110092<br>Consumer: 100000000 &nbsp; Meter: 12345678<br>Sanctioned Load 5.00 kW &nbsp; Tariff Domestic</div>
    <div style="flex:1">Bill Date 14-05-2024<br>CA No. 100000001<br>Bill Basis: Actual<br>Cycle No. 24</div>
  </div>
  <div class="cell" style="margin-top:24px;font-size:22px;background:#f4a23a"><b>Customer Care Centre</b> &nbsp; 19123 &nbsp; 39 99 99 99</div>
  <table style="width:100%;margin-top:22px;font-size:15px" border="1" cellpadding="6">
    <tr><td>Meter No</td><td>Type</td><td>Previous Reading</td><td>Current Reading</td><td>Multiplier</td><td>Units</td></tr>
    <tr><td>12345678</td><td>KWH</td><td>33010.00</td><td>33400.00</td><td>1.00</td><td>390</td></tr>
  </table>
  <div style="margin-top:26px;font-size:15px;line-height:1.7"><b>Billing Details</b><br>Energy Charges 2210.00 &nbsp; Fixed Charges 400.00 &nbsp; PPAC 120.00 &nbsp; Electricity Tax 92.00 &nbsp; Pension Trust Surcharge 44.00</div>
  <div style="margin-top:26px;font-size:15px"><b>Past Dues / Refunds / Subsidy</b> &nbsp; Arrears 0.00 &nbsp; Late Payment Surcharge 0.00 &nbsp; Total Payable Amount 2866.00</div>
  <div style="margin-top:200px;display:flex;justify-content:flex-end"><div class="o" style="width:330px;font-size:17px"><b>Bill Amount Payable</b><br><b style="font-size:24px">₹ 2,866.00</b></div></div>
  <div class="cell" style="margin-top:60px;font-size:14px;line-height:1.6">Security Deposit with DISCOM 3000.00. Interest accrued on security deposit adjusted in this bill. Late payment surcharge at 1.5% per month. For enquiries visit the company website.</div>
  <div style="position:absolute;left:0;right:0;bottom:40px;padding:0 40px;font-size:14px;line-height:1.7"><b>IMPORTANT MESSAGE</b> Please keep your mobile number and email updated to receive your bill and payment reminders.</div>
  ${STAMP.replace('9px', '14px')}
</body></html>`

const BILLS = [
  { file: 'msedcl_airoli.png', html: msedcl, css: [587, 831], scale: 2, blur: 0.15, noise: 2, jpeg: 0.9, tilt: 0 },
  { file: 'mcgm_water.png', html: mcgm, css: [688, 778], scale: 2, blur: 0.15, noise: 2, jpeg: 0.9, tilt: 0 },
  { file: 'bses_delhi.png', html: bses, css: [1240, 1631], scale: 1, blur: 0.5, noise: 6, jpeg: 0.6, tilt: 0, shrinkTo: [447, 586] },
]

const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true })
for (const b of BILLS) {
  const ctx = await browser.newContext({ viewport: { width: b.css[0], height: b.css[1] }, deviceScaleFactor: b.scale })
  const page = await ctx.newPage()
  await page.setContent(b.html, { waitUntil: 'load' })
  const shot = (await page.screenshot({ type: 'png' })).toString('base64')
  const [w, h] = b.shrinkTo || b.css
  // a photographed / scanned look: resample, soften, add sensor noise, JPEG round-trip
  const dataUrl = await page.evaluate(async ([src, w, h, blur, noise, jpeg, tilt]) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + src; await img.decode()
    const c = document.createElement('canvas'); c.width = w; c.height = h
    const g = c.getContext('2d'); g.fillStyle = '#fbfbf8'; g.fillRect(0, 0, w, h)
    g.filter = `blur(${blur}px)`; g.translate(w / 2, h / 2); g.rotate((tilt * Math.PI) / 180); g.drawImage(img, -w / 2, -h / 2, w, h)
    g.setTransform(1, 0, 0, 1, 0, 0); g.filter = 'none'
    const d = g.getImageData(0, 0, w, h)
    let s = 12345; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5)   // fixed seed: same picture every run
    for (let i = 0; i < d.data.length; i += 4) { const n = rnd() * noise * 2; d.data[i] += n; d.data[i + 1] += n; d.data[i + 2] += n }
    g.putImageData(d, 0, 0)
    const j = new Image(); j.src = c.toDataURL('image/jpeg', jpeg); await j.decode()
    const c2 = document.createElement('canvas'); c2.width = w; c2.height = h; c2.getContext('2d').drawImage(j, 0, 0)
    return c2.toDataURL('image/png')
  }, [shot, w, h, b.blur, b.noise, b.jpeg, b.tilt])
  fs.writeFileSync(path.join(OUT, b.file), Buffer.from(dataUrl.split(',')[1], 'base64'))
  console.log(`wrote ${b.file}  ${w}x${h}`)
  await ctx.close()
}
await browser.close()
