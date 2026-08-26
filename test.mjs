// เช็คส่วนที่พังแล้วเจ็บ: ลายเซ็น LINE, ตรรกะ to-do, ตัวจับคำถาม — `npm test`
// (ไม่ต่อเน็ต ไม่ต้องมีฐานข้อมูล)
import assert from 'node:assert';
import crypto from 'node:crypto';
import { verifySignature } from './lib/line.js';
import { applyTool, toCE, dueTime } from './lib/brain.js';
import { digestText } from './lib/jobs.js';

const secret = 'test-secret';
const body = JSON.stringify({ events: [] });
const sig = crypto.createHmac('sha256', secret).update(body).digest('base64');

assert.equal(verifySignature(body, sig, secret), true, 'ลายเซ็นถูกต้องต้องผ่าน');
assert.equal(verifySignature(body + 'x', sig, secret), false, 'body ถูกแก้ต้องไม่ผ่าน');
assert.equal(verifySignature(body, sig, 'wrong'), false, 'secret ผิดต้องไม่ผ่าน');
assert.equal(verifySignature(body, null, secret), false, 'ไม่มีลายเซ็นต้องไม่ผ่าน');
assert.equal(verifySignature(body, 'sn', secret), false, 'ลายเซ็นสั้นผิดความยาวต้องไม่พัง');

const s = { chat: [], notes: [], todos: [] };
await applyTool(s, 'save_note', { text: 'wifi 12345678' });
assert.equal(s.notes[0].text, 'wifi 12345678');
assert.equal(s.notes[0].id, 1, 'โน้ตต้องมีเลขให้อ้างตอนสั่งลบ');

// ── ลืมโน้ต: ลบผิดอันแล้วกู้ไม่ได้ ตรรกะตรงนี้เลยต้องแน่น
{
  const n = { chat: [], notes: [], todos: [] };
  await applyTool(n, 'save_note', { text: 'รหัส wifi บ้าน 1111' });
  await applyTool(n, 'save_note', { text: 'รหัส wifi ออฟฟิศ 2222' });
  await applyTool(n, 'save_note', { text: 'เลขบัญชี 3333' });

  assert.match(await applyTool(n, 'forget_note', { q: 'wifi' }), /ระบุให้ชัด/, 'ตรงหลายอันต้องถามกลับ ไม่ใช่เดาลบ');
  assert.equal(n.notes.length, 3, 'ถามกลับแล้วต้องยังไม่ลบอะไร');

  assert.match(await applyTool(n, 'forget_note', { q: 'บัญชี' }), /ลืม/);
  assert.equal(n.notes.length, 2);

  assert.match(await applyTool(n, 'forget_note', { id: 1 }), /บ้าน 1111/, 'ลบด้วยเลขต้องได้อันที่ถูก');
  assert.deepEqual(n.notes.map((x) => x.id), [2]);

  assert.match(await applyTool(n, 'forget_note', { id: 1 }), /ไม่เจอ/, 'ลบซ้ำต้องบอกว่าไม่เจอ');
  assert.match(await applyTool(n, 'forget_note', {}), /อันไหน/, 'ไม่บอกว่าจะลบอะไรต้องถามกลับ');

  await applyTool(n, 'save_note', { text: 'ของใหม่' });
  assert.equal(n.notes.at(-1).id, 3, 'เลขต้องไม่วนกลับไปชนของที่ลบไปแล้ว');
}

await applyTool(s, 'add_todo', { text: 'ส่งงานลูกค้า', due: '2026-08-01 10:00' });
await applyTool(s, 'add_todo', { text: 'จ่ายบิล' });
assert.deepEqual(s.todos.map((t) => t.id), [1, 2], 'id ต้องไม่ซ้ำ');

assert.match(await applyTool(s, 'done_todo', { id: '1' }), /ปิดงาน #1/, 'id เป็น string ก็ต้องปิดได้');
assert.equal(s.todos[0].done, true);
assert.match(await applyTool(s, 'done_todo', { id: 1 }), /ไม่เจอ/, 'ปิดซ้ำต้องบอกว่าไม่เจอ');
assert.match(await applyTool(s, 'done_todo', { id: 99 }), /ไม่เจอ/);

// ปิดงานแล้วเพิ่มใหม่ id ต้องไม่ย้อนกลับไปชนของเดิม
await applyTool(s, 'add_todo', { text: 'งานใหม่' });
assert.equal(s.todos.at(-1).id, 3);

// สรุปกลุ่มต้องไม่ทำงานในแชทส่วนตัว (จะไปดึงข้อความของคนอื่นไม่ได้)
assert.match(await applyTool(s, 'summarize_group', {}, { sourceType: 'user' }), /เฉพาะ/);

// ตัวจับคำถามของ SLA watcher — ต้องเจอคำถามไทยที่ไม่มีเครื่องหมาย ?
const QUESTION = /\?|ไหม|มั้ย|หรือเปล่า|รึเปล่า|เท่าไ|กี่|เมื่อไ|ยังไง|อย่างไร|ขอถาม|สอบถาม/;
for (const t of ['ราคาเท่าไหร่', 'ของถึงเมื่อไหร่', 'มีสีดำไหม', 'ส่งกี่วัน', 'ทำยังไงต่อ', 'ok?']) {
  assert.ok(QUESTION.test(t), `ต้องจับได้ว่าเป็นคำถาม: ${t}`);
}
for (const t of ['รับทราบครับ', 'โอนแล้วนะ', 'ขอบคุณมาก']) {
  assert.ok(!QUESTION.test(t), `ไม่ใช่คำถาม: ${t}`);
}

// สลิปไทยเป็น พ.ศ. — ถ้าไม่แปลง รายจ่ายจะไปโผล่อีก 543 ปีข้างหน้า แล้วยอดเดือนนี้จะไม่นับ
assert.equal(toCE('2569-07-29 14:32'), '2026-07-29 14:32', 'พ.ศ. ต้องถูกแปลงเป็น ค.ศ.');
assert.equal(toCE('2026-07-29 14:32'), '2026-07-29 14:32', 'ค.ศ. ต้องไม่ถูกแตะ');
assert.equal(toCE('2027-01-01'), '2027-01-01', 'ปีหน้าต้องไม่ถูกลบ 543');
assert.equal(toCE(null), null);
assert.equal(toCE('เมื่อวาน'), 'เมื่อวาน', 'อ่านไม่ออกก็ปล่อยผ่าน ไม่พัง');

// ── กฎ: ตอบเฉพาะเจ้าของ
{
  const { mayReply } = await import('./lib/line.js');
  const OWNER = 'Uowner';
  assert(mayReply(OWNER, { OWNER_USER_ID: OWNER }), 'เจ้าของต้องได้คำตอบ');
  assert(!mayReply('Ustranger', { OWNER_USER_ID: OWNER }), 'คนอื่นต้องไม่ได้คำตอบ');
  assert(mayReply('Ustranger', {}), 'ยังไม่ตั้ง OWNER_USER_ID (ตอนติดตั้ง) = ตอบได้');
  assert(mayReply('Ustranger', { OWNER_USER_ID: OWNER, REPLY_TO_ALL: '1' }), 'REPLY_TO_ALL=1 = ตอบทุกคน');
}

// ── กำหนดส่ง: AI จดมาเป็นเวลาไทย แต่เซิร์ฟเวอร์เดินเป็น UTC — พลาดตรงนี้คือเตือนช้า 7 ชั่วโมง
assert.equal(dueTime('2026-08-27 10:00').toISOString(), '2026-08-27T03:00:00.000Z', '10 โมงไทย = 03:00 UTC');
assert.equal(dueTime('2026-08-27').toISOString(), '2026-08-27T02:00:00.000Z', 'บอกแค่วัน = เตือน 9 โมงเช้าไทย');
assert.equal(dueTime('2026-08-27T10:00+07:00').toISOString(), '2026-08-27T03:00:00.000Z', 'มีเขตเวลามาแล้วห้ามบวกซ้ำ');
assert.equal(dueTime('พรุ่งนี้'), null, 'อ่านไม่ออกต้องไม่พัง');
assert.equal(dueTime(null), null);
assert.equal(dueTime(''), null);

// ── รายงานรวมใบเดียว: LINE ตัดที่ 5000 ตัวอักษร ต้องตัดเองและบอกว่าเหลืออีกกี่กลุ่ม
{
  const many = Array.from({ length: 20 }, (_, i) => `📋 กลุ่ม ${i}\n${'x'.repeat(400)}`);
  const text = digestText(many, 'https://x.test/dashboard');
  assert.ok(text.length <= 5000, `ยาวเกินที่ LINE รับได้: ${text.length}`);
  assert.match(text, /อีก \d+ กลุ่ม อ่านบนกระดาน/, 'ตัดแล้วต้องบอก ไม่ใช่หายเงียบ');
  assert.ok(text.includes('https://x.test/dashboard'), 'ต้องแปะลิงก์กระดานไว้ท้าย');

  const one = digestText(['📋 กลุ่มเดียว\nสรุปสั้น ๆ'], '');
  assert.ok(one.includes('สรุปสั้น ๆ') && !one.includes('อีก'), 'กลุ่มเดียวต้องไม่มีคำว่าตัด');
  assert.ok(!one.includes('undefined'), 'ไม่มีลิงก์ก็ต้องไม่โผล่ undefined');
}

// ── ปฏิทิน: เวลาไทย/ทั้งวัน/นัดซ้ำ — พลาดเรื่องเขตเวลาแล้วนัดจะเลื่อนไป 7 ชั่วโมง
{
  const { parseIcs, agendaText } = await import('./lib/calendar.js');
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'DTSTART;TZID=Asia/Bangkok:20260827T100000',
    'DTEND;TZID=Asia/Bangkok:20260827T113000',
    'SUMMARY:ประชุมทีม',
    'LOCATION:ออฟฟิศ',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'DTSTART;VALUE=DATE:20260828',
    'DTEND;VALUE=DATE:20260829',
    'SUMMARY:หยุด\\, ยาว',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'DTSTART;TZID=Asia/Bangkok:20260803T090000',
    'RRULE:FREQ=WEEKLY;BYDAY=MO',
    'SUMMARY:สรุปยอดรายสัปดาห์',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  const week = parseIcs(ics, new Date('2026-08-26T00:00:00+07:00'), new Date('2026-09-02T00:00:00+07:00'));
  assert.equal(week.length, 3, 'ต้องได้ 3 นัดในสัปดาห์นั้น');
  assert.equal(week[0].at.toISOString(), '2026-08-27T03:00:00.000Z', '10 โมงไทย = 03:00 UTC');
  assert.equal(week[0].where, 'ออฟฟิศ');
  assert.equal(week[1].allDay, true, 'VALUE=DATE ต้องเป็นนัดทั้งวัน');
  assert.equal(week[1].title, 'หยุด, ยาว', 'ต้องถอด \\, ให้เป็นจุลภาค');
  assert.equal(
    week[2].at.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }), '2026-08-31',
    'นัดทุกวันจันทร์ต้องคลี่มาโผล่วันจันทร์ถัดไป'
  );

  // นอกช่วงที่ถามต้องไม่โผล่
  assert.equal(parseIcs(ics, new Date('2026-09-05T00:00:00+07:00'), new Date('2026-09-06T00:00:00+07:00')).length, 0);
  assert.match(agendaText([], 'วันนี้'), /ไม่มีนัด/);
  assert.match(agendaText(null), /ยังไม่ได้ต่อปฏิทิน/);
  assert.match(agendaText(week, 'อาทิตย์นี้'), /ประชุมทีม @ ออฟฟิศ/);
}

// ── รายงานเช้าแปะตารางนัดไว้หัวได้
{
  const one = digestText(['📋 กลุ่มเดียว\nสรุป'], '', '\n\n📅 วันนี้ 1 นัด\n• 27 ส.ค. 10:00 ประชุมทีม');
  assert.ok(one.includes('📅 วันนี้ 1 นัด'), 'ตารางนัดต้องอยู่ในรายงาน');
  assert.ok(one.indexOf('📅') < one.indexOf('📋'), 'ตารางนัดต้องมาก่อนสรุปกลุ่ม');
}

console.log('✅ ผ่านหมด');
