// ต่อ Google Calendar + Drive ด้วย Service Account (ไม่ต้องทำ OAuth ไม่มีวันหมดอายุ)
//
// ตั้งค่าครั้งเดียว:
//   1. console.cloud.google.com > สร้าง Service Account > สร้าง key แบบ JSON
//   2. เปิดใช้ Google Calendar API กับ Google Drive API ในโปรเจคนั้น
//   3. เอา JSON ทั้งก้อนใส่ env GOOGLE_SERVICE_ACCOUNT
//   4. แชร์ "เฉพาะ" ปฏิทิน/โฟลเดอร์ที่อยากให้เลขาเห็น ให้อีเมลของ service account
//      (แชร์เท่าไหร่เห็นเท่านั้น — ไม่ได้เปิดบัญชี Google ทั้งใบให้)
//   5. ปฏิทินของตัวเองใช้ env GOOGLE_CALENDAR_ID = อีเมลที่ใช้เข้า Google
import crypto from 'crypto';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
];

export function serviceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    const sa = JSON.parse(raw);
    // ใส่ผ่านหน้าเว็บทีไร \n ในกุญแจกลายเป็นตัวอักษรสองตัวทุกที
    sa.private_key = sa.private_key?.replace(/\\n/g, '\n');
    return sa.client_email && sa.private_key ? sa : null;
  } catch {
    return null;
  }
}

export const hasGoogle = () => !!serviceAccount();

let cached = null; // access token อายุ 1 ชั่วโมง เก็บไว้ใช้ซ้ำในอินสแตนซ์เดียวกัน

async function token() {
  const sa = serviceAccount();
  if (!sa) return null;
  if (cached && cached.until > Date.now() + 60000) return cached.token;

  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: sa.client_email,
    scope: SCOPES.join(' '),
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  })}`;
  const signature = crypto.createSign('RSA-SHA256').update(body).sign(sa.private_key, 'base64url');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${body}.${signature}`,
    }),
  });
  if (!res.ok) throw new Error(`google auth ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const { access_token, expires_in } = await res.json();
  cached = { token: access_token, until: Date.now() + expires_in * 1000 };
  return access_token;
}

async function api(url) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${await token()}` } });
  if (!res.ok) throw new Error(`${new URL(url).pathname} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res;
}

// ── ปฏิทิน ────────────────────────────────────────────────────────────
export async function events({ days = 1, skip = 0 } = {}) {
  const id = process.env.GOOGLE_CALENDAR_ID;
  if (!hasGoogle() || !id) return null;

  const midnight = new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }) + 'T00:00:00+07:00');
  const from = new Date(+midnight + skip * 86400000);
  const to = new Date(+from + days * 86400000);

  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(id)}/events`);
  url.search = new URLSearchParams({
    timeMin: from.toISOString(),
    timeMax: to.toISOString(),
    singleEvents: 'true', // ให้ Google คลี่นัดที่เกิดซ้ำมาให้เลย (รวมนัดที่ยกเลิกเป็นครั้ง ๆ ด้วย)
    orderBy: 'startTime',
    maxResults: '50',
  });

  const { items = [] } = await (await api(url)).json();
  return items.map((e) => ({
    at: new Date(e.start.dateTime || `${e.start.date}T00:00:00+07:00`),
    end: new Date(e.end?.dateTime || `${e.end?.date || e.start.date}T00:00:00+07:00`),
    allDay: !e.start.dateTime,
    title: e.summary || '(ไม่มีชื่อ)',
    where: e.location || '',
  }));
}

// ── ไดรฟ์ ─────────────────────────────────────────────────────────────
// ค้นได้เฉพาะไฟล์/โฟลเดอร์ที่แชร์ให้ service account เท่านั้น
export async function driveSearch(text, limit = 10) {
  if (!hasGoogle()) return null;
  const safe = String(text || '').replace(/['\\]/g, ' ').trim();
  const url = new URL('https://www.googleapis.com/drive/v3/files');
  url.search = new URLSearchParams({
    q: `trashed = false${safe ? ` and (name contains '${safe}' or fullText contains '${safe}')` : ''}`,
    fields: 'files(id,name,mimeType,modifiedTime,webViewLink,size)',
    orderBy: 'modifiedTime desc',
    pageSize: String(limit),
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  });
  const { files = [] } = await (await api(url)).json();
  return files;
}

const EXPORT = {
  'application/vnd.google-apps.document': 'text/plain',
  'application/vnd.google-apps.spreadsheet': 'text/csv',
  'application/vnd.google-apps.presentation': 'text/plain',
};
const MAX_CHARS = 12000; // ponytail: ไฟล์ยาวกว่านี้ตัด — ยัดทั้งไฟล์เข้า AI ทีเดียวเปลืองเปล่า

export async function driveRead(fileId) {
  if (!hasGoogle()) return null;
  const meta = await (await api(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,size&supportsAllDrives=true`
  )).json();

  const exportAs = EXPORT[meta.mimeType];
  const url = exportAs
    ? `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(exportAs)}`
    : `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`;

  if (!exportAs && !/^(text\/|application\/json)/.test(meta.mimeType || ''))
    return { name: meta.name, text: null, note: `เปิดอ่านเป็นข้อความไม่ได้ (${meta.mimeType})` };

  const text = await (await api(url)).text();
  return {
    name: meta.name,
    text: text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n…(ตัด ไฟล์ยาวกว่านี้)` : text,
  };
}
