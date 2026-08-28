import crypto from 'crypto';
import { q } from './db.js';

// LINE เซ็นทุก request ที่ส่งมา ถ้าไม่เช็ค = ใครก็ยิง webhook เราได้ = เผาเครดิต OpenRouter ทิ้ง
export function verifySignature(rawBody, signature, secret) {
  if (!signature || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// token ของ LINE มีอายุ 30 วัน หมดแล้วบอทเงียบสนิททั้งที่ทุกอย่างอื่นปกติ
// ตั้ง LINE_CHANNEL_ID ไว้ = ระบบออกใหม่เองก่อนหมด ไม่ต้องมาต่อด้วยมือตลอดชีพ
let cached = null; // เก็บในหน่วยความจำของ instance ด้วย จะได้ไม่ถาม DB ทุกข้อความ

export async function accessToken() {
  const fallback = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const id = process.env.LINE_CHANNEL_ID;
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!id || !secret) return fallback; // ไม่ได้ตั้ง = ใช้ token ตายตัวใน env เหมือนเดิม

  const safe = Date.now() + 2 * 86400000; // เหลือไม่ถึง 2 วัน = ออกใหม่เลย ไม่รอให้หมดจริง
  if (cached && cached.until > safe) return cached.token;

  try {
    const { rows: [row] } = await q(`select value, expires_at from secrets where name = 'line_token'`);
    if (row && +new Date(row.expires_at) > safe) {
      cached = { token: row.value, until: +new Date(row.expires_at) };
      return cached.token;
    }

    const res = await fetch('https://api.line.me/v2/oauth/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret }),
    });
    if (!res.ok) throw new Error(`ออก token ไม่ผ่าน ${res.status}`);

    const { access_token, expires_in } = await res.json();
    const until = Date.now() + expires_in * 1000;
    // token เก่ายังใช้ได้จนหมดอายุ (LINE ให้มีพร้อมกันได้ 30 ตัว) — ออกใหม่ไม่ทำให้บอทสะดุด
    await q(
      `insert into secrets (name, value, expires_at, updated_at) values ('line_token',$1,$2,now())
       on conflict (name) do update set value = $1, expires_at = $2, updated_at = now()`,
      [access_token, new Date(until)]
    );
    cached = { token: access_token, until };
    console.log(`ออก LINE token ใหม่ อายุ ${Math.round(expires_in / 86400)} วัน`);
    return access_token;
  } catch (err) {
    console.error('ต่ออายุ token ไม่สำเร็จ:', err.message);
    return fallback; // ต่อไม่ได้ก็ใช้ตัวเดิมไปก่อน ดีกว่าเงียบไปเลย
  }
}

const bearer = async () => ({ Authorization: `Bearer ${await accessToken()}` });

async function send(path, body) {
  const res = await fetch(`https://api.line.me/v2/bot/message/${path}`, {
    method: 'POST',
    headers: { ...(await bearer()), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) console.error(`LINE ${path} failed:`, res.status, await res.text());
  return res.ok;
}

// ตอบกลับ — ฟรี ไม่นับโควตา แต่ใช้ได้ครั้งเดียวภายใน ~1 นาทีหลังได้ replyToken
export const reply = (replyToken, text) =>
  send('reply', { replyToken, messages: [{ type: 'text', text: text.slice(0, 5000) }] }); // LINE จำกัด 5000 ตัวอักษร

// ส่งเอง — นับโควตา (ฟรี 300/เดือน) ใช้ตอน worker รายงาน
export const push = (to, text) =>
  send('push', { to, messages: [{ type: 'text', text: text.slice(0, 5000) }] });

// กฎว่าจะตอบใคร — ตอบเฉพาะเจ้าของ เว้นแต่ยังไม่ตั้ง OWNER_USER_ID (ตอนติดตั้ง) หรือเปิด REPLY_TO_ALL=1
export const mayReply = (userId, env = process.env) =>
  !env.OWNER_USER_ID || env.REPLY_TO_ALL === '1' || userId === env.OWNER_USER_ID;

// ชื่อกลุ่มจริงจาก LINE — เอาไว้โชว์บน dashboard/รายงาน แทนไอดีดิบ
export async function groupTitle(sourceType, sourceId) {
  const path = sourceType === 'group' ? `group/${sourceId}/summary` : null;
  if (!path) return null;
  const res = await fetch(`https://api.line.me/v2/bot/${path}`, { headers: await bearer() });
  if (!res.ok) return null;
  return (await res.json()).groupName || null;
}

// โหลดรูป/เสียงที่ผู้ใช้ส่งมา — LINE เก็บไฟล์ไว้ชั่วคราว ต้องดึงตอนได้ webhook เลย ไม่งั้นหาย
export async function getContent(messageId) {
  const res = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
    headers: await bearer(),
  });
  if (!res.ok) throw new Error(`line content ${res.status}`);
  return Buffer.from(await res.arrayBuffer()).toString('base64');
}

const lineGet = async (url) => {
  const res = await fetch(url, { headers: await bearer() });
  return res.ok ? res.json() : null;
};

// ชื่อคนในกลุ่ม — เอาไว้ใส่หน้าข้อความตอนสรุป ("เอ ถามราคา" ดีกว่า "มีคนถามราคา")
// คนที่ออกจากกลุ่มไปแล้วจะได้ null — ปกติ ไม่ต้องแก้อะไร
export async function memberName(sourceType, sourceId, userId) {
  if (!userId) return null;
  const path =
    sourceType === 'group' ? `group/${sourceId}/member/${userId}`
    : sourceType === 'room' ? `room/${sourceId}/member/${userId}`
    : `profile/${userId}`;
  return (await lineGet(`https://api.line.me/v2/bot/${path}`))?.displayName || null;
}

// โควตา push ที่เหลือเดือนนี้ — แผนฟรีให้ 300 ข้อความ หมดแล้วบอทจะเงียบจนขึ้นเดือนใหม่
export async function pushQuotaLeft() {
  const [quota, used] = await Promise.all([
    lineGet('https://api.line.me/v2/bot/message/quota'),
    lineGet('https://api.line.me/v2/bot/message/quota/consumption'),
  ]);
  if (!quota) return null;
  if (quota.type === 'none') return Infinity; // แผนที่ไม่จำกัด
  return (quota.value ?? 0) - (used?.totalUsage ?? 0);
}

// token เหลืออีกกี่วันถึงหมดอายุ — ออกแบบ client_credentials ได้ 30 วัน ต้องต่ออายุก่อนบอทตาย
export async function tokenDaysLeft() {
  const token = await accessToken();
  if (!token) return null;
  // ต้องเป็น POST + form (GET ตอบ "method not supported" · ส่งดิบ ๆ ตอบ "invalid format" เพราะ token มี + / =)
  const res = await fetch('https://api.line.me/v2/oauth/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ access_token: token }),
  });
  if (!res.ok) return null;
  const { expires_in } = await res.json();
  return expires_in == null ? null : Math.floor(expires_in / 86400);
}
