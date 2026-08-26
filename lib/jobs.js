// งานที่ต้องทำเป็นรอบ — ใช้ร่วมกันทั้ง Railway worker และ Vercel cron
import { q } from './db.js';
import { summarize, extractOrders } from './brain.js';
import { push, groupTitle } from './line.js';

const MAX_PER_REPORT = 500; // ponytail: กันกลุ่มที่ระเบิดข้อความไม่ให้ยิง token ทีเดียวเป็นแสน
const QUESTION = /\?|ไหม|มั้ย|หรือเปล่า|รึเปล่า|เท่าไ|กี่|เมื่อไ|ยังไง|อย่างไร|ขอถาม|สอบถาม/;

const hourBangkok = () =>
  Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok', hour: '2-digit', hour12: false }));

// force = ไม่สนใจว่าถึงชั่วโมงรายงานหรือยัง (โหมด Vercel cron ที่รันได้วันละครั้ง)
export async function report({ force = false } = {}) {
  // ไม่บังคับว่าต้องมี report_to — ยังไม่ตั้ง OWNER_USER_ID ก็ยังอยากให้สรุปขึ้น dashboard
  const { rows: groups } = force
    ? await q(`select * from watched where active`)
    : await q(
        `select * from watched
          where active and $1 = any(report_hours)
            and (last_report_at is null or last_report_at < now() - interval '2 hours')`,
        [hourBangkok()]
      );

  let sent = 0;
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

      // กลุ่มเก่าที่ยังไม่มีชื่อ (เชิญเข้ามาก่อนเวอร์ชันนี้) — เติมให้ตอนสรุปรอบแรก
      let title = g.title;
      if (!title) {
        title = await groupTitle('group', g.source_id);
        if (title) await q('update watched set title = $2 where source_id = $1', [g.source_id, title]);
      }

      const summary = await summarize(title, rows);
      const period = { start: rows[0].ts, end: rows.at(-1).ts };
      const orderLine = g.track_orders ? await saveOrders(g.source_id, rows) : '';

      // ลง dashboard ก่อน แล้วค่อย push — push มีโควตา (ฟรี 300/เดือน) ถ้าพลาดสรุปต้องไม่หาย
      await q('insert into reports (source_id, period_start, period_end, summary) values ($1,$2,$3,$4)', [
        g.source_id, period.start, period.end, summary,
      ]);

      if (g.report_to) {
        await push(
          g.report_to,
          `📋 สรุปกลุ่ม ${title || g.source_id.slice(0, 8)} (${rows.length} ข้อความ)\n\n${summary}${orderLine}`
        );
      }
      // mark เฉพาะช่วงที่สรุปไปแล้ว — ข้อความที่เข้ามาระหว่างสรุปจะไปโผล่รอบหน้า
      await q(
        `update messages set processed_at = now()
          where source_id = $1 and processed_at is null and ts <= $2`,
        [g.source_id, period.end]
      );
      await q('update watched set last_report_at = now() where source_id = $1', [g.source_id]);
      sent++;
    } catch (err) {
      console.error(`report failed ${g.source_id}:`, err.message);
    }
  }
  return sent;
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
export async function checkSla() {
  const { rows } = await q(
    `select distinct on (w.source_id)
            w.source_id, w.title, w.report_to, w.sla_minutes,
            m.line_message_id, m.text, m.ts
       from watched w join messages m on m.source_id = w.source_id
      where w.active and w.report_to is not null and w.sla_minutes > 0 and m.text is not null
      order by w.source_id, m.ts desc`
  );

  let sent = 0;
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
    sent++;
  }
  return sent;
}

export async function runJobs(opts = {}) {
  const reported = await report(opts);
  const alerted = await checkSla();
  return { reported, alerted };
}
