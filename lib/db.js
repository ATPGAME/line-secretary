import pg from 'pg';

// Neon สร้างจาก Vercel > Storage — ตัวแปรถูกใส่ให้อัตโนมัติ (ชื่อไหนก็ได้ใน 2 ชื่อนี้)
// เอาค่าเดียวกันไปใส่ Railway ด้วยมือ (ตัวที่มี -pooler)
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: true, // Neon บังคับ SSL
  max: 3, // ponytail: serverless เปิด connection ได้จำกัด ถ้าเจอ too many connections ให้เช็คว่าใช้ URL -pooler แล้วจริง
});

export const q = (sql, params) => pool.query(sql, params);

const EMPTY = { chat: [], notes: [], todos: [] };

export async function load(sourceId) {
  const { rows } = await q('select data from state where source_id = $1', [sourceId]);
  const state = { ...EMPTY, ...(rows[0]?.data || {}) };
  // โน้ตที่จดไว้ก่อนมีระบบเลข — เติมเลขให้ จะได้สั่ง "ลืมโน้ต 2" ได้
  state.notes.forEach((n, i) => (n.id ??= i + 1));
  return state;
}

export async function save(sourceId, data) {
  await q(
    `insert into state (source_id, data, updated_at) values ($1, $2, now())
     on conflict (source_id) do update set data = $2, updated_at = now()`,
    [sourceId, JSON.stringify(data)]
  );
}

// เก็บข้อความดิบ — คืน id ของแถวใหม่ หรือ null ถ้า LINE ส่งซ้ำ
export async function ingest(m) {
  const { rows } = await q(
    `insert into messages (line_message_id, source_type, source_id, user_id, kind, text, ts)
     values ($1,$2,$3,$4,$5,$6,$7) on conflict (line_message_id) do nothing returning id`,
    [m.lineMessageId, m.sourceType, m.sourceId, m.userId, m.kind, m.text, m.ts]
  );
  return rows[0]?.id ?? null;
}
