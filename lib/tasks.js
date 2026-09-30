// บอร์ดงาน — ใช้ร่วมกันทั้งหน้า /board (ผ่าน /api/tasks) และเลขาใน LINE (board_add / board_update)
import { q } from './db.js';

export const STATUSES = ['todo', 'doing', 'waiting', 'done'];
export const STATUS_TH = { todo: 'ต้องทำ', doing: 'กำลังทำ', waiting: 'รอคนอื่น', done: 'เสร็จแล้ว' };
export const PRIORITIES = ['สูง', 'กลาง', 'ต่ำ'];

const clean = (s, max = 500) => (s == null ? null : String(s).trim().slice(0, max) || null);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(Date.parse(s));
// วันส่ง: ว่าง = ไม่กำหนด · ปี พ.ศ. แปลงให้ · ปีหลุดช่วง (พิมพ์ผิด เช่น 2562) ไม่รับ แล้วบอกเหตุผลกลับไป
// เคยเจอจริง: พิมพ์ปี 2562 ในช่องวันที่ → บอร์ดขึ้น "เหลือ 195771 วัน"
function dueDate(s) {
  if (s == null || String(s).trim() === '') return null;
  let d = String(s).trim().slice(0, 10);
  let y = Number(d.slice(0, 4));
  if (y > 2400) d = `${(y -= 543)}${d.slice(4)}`;
  const now = new Date().getFullYear();
  if (!isDate(d) || y < now - 1 || y > now + 5) throw new Error(`วันส่ง "${s}" ไม่ถูกต้อง — ใช้ปี ค.ศ. เช่น ${now}-10-01`);
  return d;
}
const checklist = (list) =>
  (Array.isArray(list) ? list : [])
    .map((c) => (typeof c === 'string' ? { text: c, done: false } : { text: clean(c?.text, 200), done: !!c?.done }))
    .filter((c) => c.text)
    .slice(0, 30);

export async function listTasks({ includeDoneDays = 14 } = {}) {
  const { rows } = await q(
    `select id::int as id, title, detail, status, priority, team, due::text as due, checklist, source,
            created_at, updated_at, done_at
       from tasks
      where status <> 'done' or done_at > now() - ($1 || ' days')::interval
      order by case priority when 'สูง' then 0 when 'กลาง' then 1 else 2 end, due nulls last, id`,
    [includeDoneDays]
  );
  return rows;
}

export async function addTask(t, source = 'board') {
  const title = clean(t.title, 200);
  if (!title) throw new Error('ต้องมีชื่องาน');
  const { rows: [row] } = await q(
    `insert into tasks (title, detail, status, priority, team, due, checklist, source)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning id::int as id, title`,
    [
      title,
      clean(t.detail, 2000),
      STATUSES.includes(t.status) ? t.status : 'todo',
      PRIORITIES.includes(t.priority) ? t.priority : 'กลาง',
      clean(t.team, 60),
      dueDate(t.due),
      JSON.stringify(checklist(t.checklist)),
      source,
    ]
  );
  return row;
}

// แก้เฉพาะช่องที่ส่งมา · status=done จด done_at ให้ (ย้ายกลับก็ล้าง)
export async function updateTask(id, patch) {
  const set = [];
  const vals = [];
  const put = (col, val) => {
    vals.push(val);
    set.push(`${col} = $${vals.length}`);
  };
  if ('title' in patch && clean(patch.title, 200)) put('title', clean(patch.title, 200));
  if ('detail' in patch) put('detail', clean(patch.detail, 2000));
  if ('team' in patch) put('team', clean(patch.team, 60));
  if ('due' in patch) put('due', dueDate(patch.due));
  if (PRIORITIES.includes(patch.priority)) put('priority', patch.priority);
  if ('checklist' in patch) put('checklist', JSON.stringify(checklist(patch.checklist)));
  if (STATUSES.includes(patch.status)) {
    put('status', patch.status);
    set.push(patch.status === 'done' ? 'done_at = coalesce(done_at, now())' : 'done_at = null');
  }
  if (!set.length) throw new Error('ไม่มีอะไรให้แก้');
  vals.push(Number(id));
  const { rows: [row] } = await q(
    `update tasks set ${set.join(', ')}, updated_at = now() where id = $${vals.length} returning id::int as id, title, status`,
    vals
  );
  if (!row) throw new Error(`ไม่เจองาน #${id}`);
  return row;
}

export async function deleteTask(id) {
  const { rowCount } = await q('delete from tasks where id = $1', [Number(id)]);
  if (!rowCount) throw new Error(`ไม่เจองาน #${id}`);
}
