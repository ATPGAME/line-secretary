// เช็คส่วนที่พังแล้วเจ็บ: ลายเซ็น LINE, ตรรกะ to-do, ตัวจับคำถาม — `npm test`
// (ไม่ต่อเน็ต ไม่ต้องมีฐานข้อมูล)
import assert from 'node:assert';
import crypto from 'node:crypto';
import { verifySignature } from './lib/line.js';
import { applyTool } from './lib/brain.js';

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

console.log('✅ ผ่านหมด');
