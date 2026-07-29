// สมอง — รันบน Railway ตลอดเวลา: ตื่นทุก 10 นาที
//   1) ถึงรอบรายงานของกลุ่มไหน → สรุป (+ สกัดออเดอร์ถ้าเปิดไว้) → push
//   2) ลูกค้าถามแล้วไม่มีใครตอบเกินเวลา → เตือน
// Railway > Settings > Start Command:  node worker/index.js
import { q } from '../lib/db.js';
import { summarize, extractOrders } from '../lib/brain.js';
import { push } from '../lib/line.js';

const EVERY = 10 * 60 * 1000;
const MAX_PER_REPORT = 500; // ponytail: กันกลุ่มที่ระเบิดข้อความไม่ให้ยิง token ทีเดียวเป็นแสน
const QUESTION = /\?|ไหม|มั้ย|หรือเปล่า|รึเปล่า|เท่าไ|กี่|เมื่อไ|ยังไง|อย่างไร|ขอถาม|สอบถาม/;

const hourBangkok = () =>
  Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok', hour: '2-digit', hour12: false }));

async function report() {
  const { rows: groups } = await q(
    `select * from watched
      where active and report_to is not null and $1 = any(report_hours)
        and (last_report_at is null or last_report_at < now() - interval '2 hours')`,
    [hourBangkok()]
  );

  for (const g of groups) {
    try {
      const { rows } = await q(
        `select id, text, ts from messages
          where source_id = $1 and processed_at is null and text is not null
          order by ts limit $2`,
        [g.source_id, MAX_PER_REPORT]
      );

      // ไม่มีอะไรใหม่ก็ไม่ต้องกวน (และไม่เปลืองโควตา push)
      if (rows.length === 0) {
        await q('update watched set last_report_at = now() where source_id = $1', [g.source_id]);
        continue;
      }

      const summary = await summarize(g.title, rows);
      const period = { start: rows[0].ts, end: rows.at(-1).ts };
      const orderLine = g.track_orders ? await saveOrders(g.source_id, rows) : '';

      await push(
        g.report_to,
        `📋 สรุปกลุ่ม ${g.title || g.source_id.slice(0, 8)} (${rows.length} ข้อความ)\n\n${summary}${orderLine}`
      );

      await q('insert into reports (source_id, period_start, period_end, summary) values ($1,$2,$3,$4)', [
        g.source_id, period.start, period.end, summary,
      ]);
      // mark เฉพาะช่วงที่สรุปไปแล้ว — ข้อความที่เข้ามาระหว่างสรุปจะไปโผล่รอบหน้า
      await q(
        `update messages set processed_at = now()
          where source_id = $1 and processed_at is null and ts <= $2`,
        [g.source_id, period.end]
      );
      await q('update watched set last_report_at = now() where source_id = $1', [g.source_id]);
      console.log(`reported ${g.source_id} (${rows.length} msgs)`);
    } catch (err) {
      console.error(`report failed ${g.source_id}:`, err.message);
    }
  }
}

async function saveOrders(sourceId, rows) {
  const found = await extractOrders(rows);
  let total = 0;
  for (const o of found) {
    const src = rows[o.i];
    if (!src) continue;
    total += Number(o.amount) || 0;
    await q(
      `insert into orders (source_id, customer, items, amount, ordered_at, source_message_id)
       values ($1,$2,$3,$4,$5,$6) on conflict (source_message_id) do nothing`,
      [sourceId, o.customer || null, JSON.stringify(o.items || []), o.amount || null, src.ts, src.id]
    );
  }
  if (!found.length) return '';
  return `\n\n🧾 ออเดอร์ ${found.length} รายการ${total ? ` · รวม ${total.toLocaleString('th-TH')} บาท` : ''}`;
}

// ลูกค้าถามค้างไว้ — ข้อความล่าสุดของกลุ่มเป็นคำถาม และไม่มีใครพิมพ์ต่อเกินเวลาที่ตั้งไว้
// ponytail: ดูแค่ข้อความล่าสุดพอ ถ้าจะแยกว่าใครเป็นทีมงาน ต้องเก็บรายชื่อ staff ต่อกลุ่มเพิ่ม
async function checkSla() {
  const { rows } = await q(
    `select distinct on (w.source_id)
            w.source_id, w.title, w.report_to, w.sla_minutes,
            m.line_message_id, m.text, m.ts
       from watched w join messages m on m.source_id = w.source_id
      where w.active and w.report_to is not null and w.sla_minutes > 0 and m.text is not null
      order by w.source_id, m.ts desc`
  );

  for (const r of rows) {
    const waited = (Date.now() - new Date(r.ts)) / 60000;
    if (waited < r.sla_minutes || waited > 24 * 60) continue; // เก่าเกินวันแล้วช่างมัน
    if (!QUESTION.test(r.text)) continue;

    const { rowCount } = await q(
      `insert into alerts (source_id, kind, ref) values ($1,'sla',$2) on conflict do nothing`,
      [r.source_id, r.line_message_id]
    );
    if (!rowCount) continue; // เตือนไปแล้ว

    await push(
      r.report_to,
      `⏰ กลุ่ม ${r.title || r.source_id.slice(0, 8)} มีคำถามค้าง ${Math.round(waited)} นาที ยังไม่มีใครตอบ\n\n"${r.text.slice(0, 300)}"`
    );
  }
}

async function tick() {
  try {
    await report();
    await checkSla();
  } catch (err) {
    console.error('tick failed:', err.message);
  }
}

console.log('worker started · ตื่นทุก 10 นาที');
await tick();
setInterval(tick, EVERY);
