import crypto from 'crypto';

// LINE เซ็นทุก request ที่ส่งมา ถ้าไม่เช็ค = ใครก็ยิง webhook เราได้ = เผาเครดิต OpenRouter ทิ้ง
export function verifySignature(rawBody, signature, secret) {
  if (!signature || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function send(path, body) {
  const res = await fetch(`https://api.line.me/v2/bot/message/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
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
  const res = await fetch(`https://api.line.me/v2/bot/${path}`, {
    headers: { Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` },
  });
  if (!res.ok) return null;
  return (await res.json()).groupName || null;
}

// โหลดรูป/เสียงที่ผู้ใช้ส่งมา — LINE เก็บไฟล์ไว้ชั่วคราว ต้องดึงตอนได้ webhook เลย ไม่งั้นหาย
export async function getContent(messageId) {
  const res = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
    headers: { Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` },
  });
  if (!res.ok) throw new Error(`line content ${res.status}`);
  return Buffer.from(await res.arrayBuffer()).toString('base64');
}
