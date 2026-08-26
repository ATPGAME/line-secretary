// ปุ่มลัดใต้แป้นพิมพ์ใน LINE (rich menu) — สร้างรูป + อัปโหลด + ตั้งเป็นค่าเริ่มต้น ในคำสั่งเดียว
//   node scripts/rich-menu.mjs              → สร้าง/อัปเดตปุ่ม
//   node scripts/rich-menu.mjs --image a.png → ใช้รูปของตัวเอง (2500x843)
//   node scripts/rich-menu.mjs --off        → เอาปุ่มออกให้หมด
//
// รูปวาดด้วย HTML แล้วให้ Chrome ถ่ายเป็น PNG (ไม่ต้องลง lib อะไรเพิ่ม)
// ไม่มี Chrome ก็ทำรูปเองแล้วส่ง --image มาได้
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

for (const line of fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
if (!TOKEN) throw new Error('ไม่มี LINE_CHANNEL_ACCESS_TOKEN ใน .env.local');

const DASH =
  process.env.DASHBOARD_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`) ||
  '';
const dashLink = DASH
  ? `${DASH.replace(/\/$/, '')}/dashboard${process.env.DASHBOARD_PUBLIC === '1' || !process.env.DASHBOARD_KEY ? '' : `?key=${process.env.DASHBOARD_KEY}`}`
  : '';

// 4 ปุ่มเรียงแถวเดียว — กว้าง 2500 สูง 843 คือขนาดเตี้ยที่ LINE รองรับ (ไม่บังจอเยอะ)
const W = 2500;
const H = 843;
const BUTTONS = [
  { icon: '📊', label: 'สรุปวันนี้', sub: 'กลุ่มไหนคุยอะไร', text: 'เลขา สรุปวันนี้ให้หน่อย' },
  { icon: '📝', label: 'งานค้าง', sub: 'ที่ยังไม่ได้ทำ', text: 'มีงานอะไรค้างอยู่บ้าง' },
  { icon: '💸', label: 'รายจ่าย', sub: 'เดือนนี้ใช้ไปเท่าไหร่', text: 'เดือนนี้ใช้เงินไปเท่าไหร่' },
  { icon: '📈', label: 'กระดาน', sub: 'เปิดหน้าสรุป', uri: dashLink },
].filter((b) => b.text || b.uri); // ไม่มี URL กระดานก็ตัดปุ่มนั้นทิ้ง

const api = async (path, opts = {}) => {
  const res = await fetch(`https://api.line.me/v2/bot/${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(opts.headers || {}) },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`LINE ${path} → ${res.status} ${body}`);
  return body ? JSON.parse(body) : {};
};

// ── ลบของเก่าทิ้งก่อนเสมอ ไม่งั้นเมนูค้างสะสมจนเต็มโควตา (1000 อัน)
const { richmenus = [] } = await api('richmenu/list');
for (const m of richmenus) await api(`richmenu/${m.richMenuId}`, { method: 'DELETE' });
if (richmenus.length) console.log(`🧹 ลบเมนูเก่า ${richmenus.length} อัน`);

if (process.argv.includes('--off')) {
  console.log('✅ เอาปุ่มออกหมดแล้ว');
  process.exit(0);
}

// ── รูป
const given = process.argv[process.argv.indexOf('--image') + 1];
const imagePath = process.argv.includes('--image') ? given : render();
console.log(`🖼  รูป: ${imagePath}`);

function render() {
  const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (!fs.existsSync(CHROME)) {
    console.error('❌ ไม่เจอ Chrome — ทำรูปขนาด 2500x843 เองแล้วสั่ง: node scripts/rich-menu.mjs --image รูป.png');
    process.exit(1);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'richmenu-'));
  const html = path.join(dir, 'menu.html');
  fs.writeFileSync(html, page());
  execFileSync(CHROME, [
    '--headless', '--disable-gpu', '--hide-scrollbars',
    `--screenshot=${path.join(dir, 'menu.png')}`,
    `--window-size=${W},${H}`,
    `file://${html}`,
  ], { stdio: 'ignore' });
  return path.join(dir, 'menu.png');
}

// ── สร้างเมนู → อัปโหลดรูป → ตั้งเป็นค่าเริ่มต้นของทุกคน
const width = Math.floor(W / BUTTONS.length);
const { richMenuId } = await api('richmenu', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    size: { width: W, height: H },
    selected: true,
    name: `${process.env.BOT_NAME || 'เลขา'} ปุ่มลัด`,
    chatBarText: 'เมนูลัด',
    areas: BUTTONS.map((b, i) => ({
      bounds: { x: i * width, y: 0, width, height: H },
      action: b.uri ? { type: 'uri', label: b.label, uri: b.uri } : { type: 'message', label: b.label, text: b.text },
    })),
  }),
});

const res = await fetch(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'image/png' },
  body: fs.readFileSync(imagePath),
});
if (!res.ok) throw new Error(`อัปโหลดรูปไม่ผ่าน ${res.status} ${await res.text()}`);

await api(`user/all/richmenu/${richMenuId}`, { method: 'POST' });
console.log(`✅ ตั้งปุ่มลัดแล้ว (${BUTTONS.map((b) => b.label).join(' · ')})`);
console.log('   เปิดแชทกับ OA ใหม่อีกรอบถ้ายังไม่เห็นปุ่ม (LINE แคชไว้สักครู่)');

// ── หน้าตาของปุ่ม (ม่วง-ขาว ให้เข้ากับกระดาน)
function page() {
  const cells = BUTTONS.map(
    (b) => `<div class="cell"><div class="icon">${b.icon}</div><div class="label">${b.label}</div><div class="sub">${b.sub}</div></div>`
  ).join('');
  return `<!doctype html><meta charset="utf-8">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{width:${W}px;height:${H}px;display:grid;grid-template-columns:repeat(${BUTTONS.length},1fr);
    font-family:"Noto Sans Thai","Helvetica Neue",sans-serif;background:#fff}
  .cell{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;
    background:linear-gradient(160deg,#F6F3FF,#EDE9FE);border-right:3px solid #fff;color:#5B21B6}
  .cell:last-child{border-right:0;background:linear-gradient(160deg,#7C3AED,#5B21B6);color:#fff}
  .icon{font-size:170px;line-height:1}
  .label{font-size:76px;font-weight:800;letter-spacing:-1px}
  .sub{font-size:44px;opacity:.62}
</style>${cells}`;
}
