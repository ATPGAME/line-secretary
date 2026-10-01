// ตารางนัดทั้งปี — ใช้ร่วมกันทั้งหน้า /calendar (ผ่าน /api/events) · เลขาใน LINE · งานเตือนใน jobs.js
import { q } from './db.js';
import { dueDate } from './tasks.js';

export const KINDS = ['งาน', 'ส่วนตัว', 'วันหยุด'];
const clean = (s, max = 200) => (s == null ? null : String(s).trim().slice(0, max) || null);
// "9:00" "09.30" "9" → "09:00" · ว่าง = ทั้งวัน
function hhmm(s) {
  if (s == null || String(s).trim() === '') return null;
  const m = String(s).trim().match(/^(\d{1,2})(?:[:.](\d{2}))?$/);
  if (!m || Number(m[1]) > 23 || Number(m[2] || 0) > 59) throw new Error(`เวลา "${s}" ไม่ถูกต้อง — ใช้แบบ 09:00`);
  return `${m[1].padStart(2, '0')}:${m[2] || '00'}`;
}

export async function listEvents(from, to) {
  const { rows } = await q(
    `select id::int as id, title, date::text as date, time, kind, note
       from events where date between $1 and $2
      order by date, time nulls first, id`,
    [from, to]
  );
  return rows;
}

export async function addEvent(e, source = 'web') {
  const title = clean(e.title);
  if (!title) throw new Error('ต้องมีชื่อนัด');
  const date = dueDate(e.date);
  if (!date) throw new Error('ต้องมีวันที่');
  const { rows: [row] } = await q(
    `insert into events (title, date, time, kind, note, source) values ($1,$2,$3,$4,$5,$6)
     returning id::int as id, title, date::text as date, time`,
    [title, date, hhmm(e.time), KINDS.includes(e.kind) ? e.kind : 'งาน', clean(e.note, 1000), source]
  );
  return row;
}

export async function updateEvent(id, p) {
  const set = [];
  const vals = [];
  const put = (col, val) => {
    vals.push(val);
    set.push(`${col} = $${vals.length}`);
  };
  if (clean(p.title)) put('title', clean(p.title));
  if (p.date) put('date', dueDate(p.date));
  if ('time' in p) put('time', hhmm(p.time));
  if (KINDS.includes(p.kind)) put('kind', p.kind);
  if ('note' in p) put('note', clean(p.note, 1000));
  if (!set.length) throw new Error('ไม่มีอะไรให้แก้');
  vals.push(Number(id));
  const { rows: [row] } = await q(
    `update events set ${set.join(', ')} where id = $${vals.length} returning id::int as id, title, date::text as date, time`,
    vals
  );
  if (!row) throw new Error(`ไม่เจอนัด #${id}`);
  return row;
}

export async function deleteEvent(id) {
  const { rowCount } = await q('delete from events where id = $1', [Number(id)]);
  if (!rowCount) throw new Error(`ไม่เจอนัด #${id}`);
}

// ข้อความรายการนัด (ใช้ใน LINE) — "09:00 ไปพิโลก" / "ทั้งวัน · วันปิยมหาราช"
export const eventLine = (e) => `${e.kind === 'วันหยุด' ? '🎌 ' : ''}${e.time || 'ทั้งวัน'} · ${e.title}`;
