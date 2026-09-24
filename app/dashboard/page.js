import { q } from '@/lib/db';
import { bkkDate, addDays, thaiWeekday } from '@/lib/brain';

export const dynamic = 'force-dynamic';

// กระดานของ Manager — แต่ละกลุ่มต้องการอะไรตอนนี้ · แผนงาน 7 วัน · ปฏิทินนัด Meet · สรุปรายชั่วโมง
// ข้อมูลมาจาก group_insights (AI วิเคราะห์ทุกรอบเก็บรายชั่วโมง) + reports (สรุปรายชั่วโมง)
export default async function Dashboard({ searchParams }) {
  const { key, demo } = await searchParams;
  // ponytail: key เส้นเดียวพอสำหรับข้อมูลงาน — ถ้าจะเก็บข้อมูลสุขภาพ/การเงิน ต้องเปลี่ยนเป็น login จริง (ดู DESIGN.md)
  const locked = process.env.DASHBOARD_PUBLIC !== '1' && key !== process.env.DASHBOARD_KEY;
  if (locked) {
    return (
      <main className="gate">
        <style>{CSS}</style>
        <div className="card gate-card">
          <h1>ต้องมีกุญแจก่อนครับ</h1>
          <p>เติม <code>?key=...</code> ท้าย URL ให้ตรงกับ <code>DASHBOARD_KEY</code></p>
        </div>
      </main>
    );
  }

  const data = demo
    ? DEMO
    : Object.fromEntries(
        await Promise.all(Object.entries(QUERIES).map(async ([k, sql]) => [k, (await q(sql)).rows]))
      );
  const { groups, reports, alerts, states } = data;

  const today = bkkDate();
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const lastDay = days.at(-1);

  // ── รวมทุกกลุ่มเป็นรายการเดียว
  const needs = groups.flatMap((g) =>
    (g.insight?.needs || []).map((n) => ({ ...n, group: g.title, overdue: n.plan_date < today }))
  );
  needs.sort((a, b) => PRI[a.priority] - PRI[b.priority] || isExec(b.from) - isExec(a.from) || a.plan_date.localeCompare(b.plan_date));
  const meetings = groups
    .flatMap((g) => (g.insight?.meetings || []).map((m) => ({ ...m, group: g.title })))
    .filter((m) => m.date >= today && m.date <= lastDay)
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  // งานที่สั่งเลขาในแชทส่วนตัว (มีกำหนด) — ลงแผนด้วย
  const todos = states.flatMap(({ data: s }) =>
    (s.todos || []).filter((t) => !t.done && t.due).map((t) => {
      const [d, time = '09:00'] = String(t.due).split(' ');
      return { what: t.text, plan_date: d < today ? today : d, plan_slot: slotOf(time), overdue: d < today, todo: true };
    })
  );

  // ── แผน 7 วัน: วัน × ช่วงเวลา (งานเลยกำหนดยกมาไว้วันนี้)
  const plan = {};
  const put = (d, slot, item) => ((plan[`${d}|${slot}`] ||= []).push(item));
  for (const n of [...needs, ...todos]) put(n.overdue ? today : n.plan_date, n.plan_slot, { kind: n.todo ? 'todo' : 'need', ...n });
  for (const m of meetings) put(m.date, slotOf(m.time), { kind: 'meet', ...m });

  const high = needs.filter((n) => n.priority === 'สูง').length;
  const latest = groups.map((g) => g.insight_at).filter(Boolean).sort().at(-1);
  const now = fmtTime(new Date());

  return (
    <main className="wrap">
      <style>{CSS}</style>
      <meta httpEquiv="refresh" content="900" />
      {demo && <div className="demo">👀 โหมดตัวอย่าง — ข้อมูลสมมุติ · ตัด <code>&demo=1</code> ออกเพื่อดูของจริง</div>}

      <header className="hero">
        <div>
          <p className="eyebrow">{process.env.BOT_NAME || 'เลขาของเกม'} · กระดาน Manager</p>
          <h1>ตอนนี้แต่ละกลุ่มต้องการอะไร</h1>
          <p className="sub">
            เปิดดู {now} น. · AI วิเคราะห์ล่าสุด {latest ? `${fmtTime(new Date(latest))} น.` : '—'} · อัปเดตเองทุกชั่วโมง
          </p>
        </div>
        <div className="kpis">
          <Kpi n={high} label="เรื่องสำคัญสูง" tone={high ? 'hot' : ''} />
          <Kpi n={needs.length} label="สิ่งที่ต้องทำ" />
          <Kpi n={meetings.length} label="นัด Meet 7 วัน" />
          <Kpi n={groups.length} label="กลุ่มที่เฝ้า" />
        </div>
      </header>

      {!!alerts.length && (
        <section className="card alert-strip">
          <h2>🚨 เรื่องที่ต้องรู้ทันที (24 ชม.)</h2>
          {alerts.map((a, i) => (
            <p key={i}>
              <b>{a.at}</b> · {a.title || 'ระบบ'} — {a.kind === 'sla' ? 'มีคำถามค้างไม่มีคนตอบ' : a.kind === 'keyword' ? 'เจอคำต้องจับตา' : 'ระบบ'}
              {a.text ? `: “${a.text.slice(0, 120)}”` : a.detail ? `: ${a.detail.slice(0, 120)}` : ''}
            </p>
          ))}
        </section>
      )}

      {/* ── 1. ต้องทำตอนนี้ */}
      <Section title="ต้องทำตอนนี้" hint="เรียงตามความสำคัญ · เรื่องที่ผู้บริหารขอขึ้นก่อน" count={needs.length}>
        {needs.length ? (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr><th>สำคัญ</th><th>ต้องทำอะไร</th><th>กลุ่ม</th><th>ใครขอ → ใครทำ</th><th>ลงมือ</th><th>สถานะ</th></tr>
              </thead>
              <tbody>
                {needs.map((n, i) => (
                  <tr key={i}>
                    <td><span className={`pri p${PRI[n.priority]}`}>{n.priority}</span></td>
                    <td className="what">{n.what}{n.why && <small>{n.why}</small>}</td>
                    <td className="nowrap">{n.group}</td>
                    <td className="nowrap">
                      {n.from}{isExec(n.from) && <span className="exec">ผู้บริหาร</span>} → {n.owner || '—'}
                    </td>
                    <td className="nowrap">
                      {n.overdue ? <span className="late">เลยกำหนด</span> : dayLabel(n.plan_date, today)} · {n.plan_slot}
                    </td>
                    <td className="nowrap"><span className="state">{n.state}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty text="ไม่มีงานค้างจากทุกกลุ่ม 🎉" />}
      </Section>

      {/* ── 2. แต่ละกลุ่ม */}
      <Section title="แต่ละกลุ่มตอนนี้" hint="สภาพกลุ่ม · หัวข้อที่คุย · สรุปรอบล่าสุด" count={groups.length}>
        <div className="groups">
          {groups.map((g) => {
            const gi = g.insight || {};
            const open = (gi.needs || []).length;
            return (
              <article key={g.source_id} className="card group">
                <div className="group-head">
                  <h3>{g.title || g.source_id.slice(0, 10)}</h3>
                  <span className={`dot ${Number(g.msgs_24h) ? 'live' : ''}`}>{Number(g.msgs_24h) || 0} ข้อความ/24ชม.</span>
                </div>
                <p className="status">{gi.status || 'ยังไม่มีบทสนทนาให้วิเคราะห์'}</p>
                <div className="meta">
                  {open ? <span className="tag hot">ต้องทำ {open}</span> : <span className="tag ok">ไม่มีงานค้าง</span>}
                  {g.last_at && <span className="tag">ล่าสุด {g.last_at}</span>}
                </div>
                {!!gi.topics?.length && (
                  <ul className="topics">
                    {gi.topics.map((t, i) => (
                      <li key={i}><b>{t.title}</b>{t.detail && <span> — {t.detail}</span>}</li>
                    ))}
                  </ul>
                )}
                {g.last_summary && (
                  <details>
                    <summary>สรุปรอบล่าสุด {g.last_summary_at} น.</summary>
                    <p className="pre">{g.last_summary}</p>
                  </details>
                )}
              </article>
            );
          })}
        </div>
      </Section>

      {/* ── 3. แผน 7 วัน */}
      <Section title="ตารางวางแผน 7 วัน" hint="AI จัดวันให้ตามความสำคัญ · 🔴 สูง 🟡 กลาง ⚪ ต่ำ · 📅 นัด Meet · ☑️ งานที่สั่งเลขา">
        <div className="table-wrap">
          <table className="tbl plan">
            <thead><tr><th>วัน</th>{SLOTS.map((s) => <th key={s}>{s}</th>)}</tr></thead>
            <tbody>
              {days.map((d) => (
                <tr key={d} className={isWeekend(d) ? 'weekend' : ''}>
                  <td className="nowrap day">{dayLabel(d, today)}<small>{short(d)}</small></td>
                  {SLOTS.map((s) => (
                    <td key={s}>
                      {(plan[`${d}|${s}`] || []).map((it, i) => (
                        <div key={i} className={`chip ${it.kind} p${PRI[it.priority] ?? 1}`}>
                          {it.kind === 'meet' ? `📅 ${it.time} ${it.title}` : `${it.kind === 'todo' ? '☑️' : PRI_ICON[it.priority]} ${it.what}`}
                          {it.group && <small>{it.group}</small>}
                        </div>
                      ))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* ── 4. ปฏิทิน Meet */}
      <Section title="ปฏิทินนัด Meet" hint="“นัดแล้ว” = ตกลงกันในแชท · “เสนอ” = เลขาแนะนำให้คุยสด · กดเพิ่มลง Google Calendar แล้วใส่ Google Meet ได้" count={meetings.length}>
        <div className="cal">
          {days.map((d) => {
            const list = meetings.filter((m) => m.date === d);
            return (
              <div key={d} className={`cal-day ${d === today ? 'today' : ''} ${isWeekend(d) ? 'weekend' : ''}`}>
                <div className="cal-head">{thaiWeekday(d).replace('วัน', '')}<small>{short(d)}</small></div>
                {list.length ? list.map((m, i) => (
                  <div key={i} className={`meet ${m.confirmed ? 'yes' : ''}`}>
                    <div className="meet-time">{m.time} · {m.minutes} นาที</div>
                    <b>{m.title}</b>
                    {!!m.with?.length && <small>กับ {m.with.join(', ')}</small>}
                    {m.why && <small className="why">{m.why}</small>}
                    <div className="meet-foot">
                      <span className={`tag ${m.confirmed ? 'ok' : ''}`}>{m.confirmed ? 'นัดแล้ว' : 'เสนอ'}</span>
                      <a href={gcal(m)} target="_blank" rel="noreferrer">+ Google Calendar</a>
                    </div>
                  </div>
                )) : <p className="none">—</p>}
              </div>
            );
          })}
        </div>
      </Section>

      {/* ── 5. สรุปรายชั่วโมง */}
      <Section title="สรุปรายชั่วโมง (24 ชม.)" hint="สรุปทุกกลุ่มที่มีข้อความใหม่ในแต่ละรอบ" count={reports.length}>
        {reports.length ? (
          <ol className="timeline">
            {reports.map((r, i) => (
              <li key={i}>
                <span className="t">{r.at}</span>
                <details>
                  <summary><b>{r.title}</b> · {r.msgs} ข้อความ</summary>
                  <p className="pre">{r.summary}</p>
                </details>
              </li>
            ))}
          </ol>
        ) : <Empty text="ยังไม่มีรอบสรุปใน 24 ชม." />}
      </Section>

      <footer>ข้อมูลสดจากฐานข้อมูลทุกครั้งที่เปิด · หน้านี้รีเฟรชเองทุก 15 นาที</footer>
    </main>
  );
}

// ── ส่วนประกอบเล็ก ๆ
const Section = ({ title, hint, count, children }) => (
  <section className="section">
    <div className="section-head">
      <h2>{title}{count != null && <span className="count">{count}</span>}</h2>
      {hint && <p>{hint}</p>}
    </div>
    {children}
  </section>
);
const Kpi = ({ n, label, tone = '' }) => (
  <div className={`kpi ${tone}`}><b>{n}</b><span>{label}</span></div>
);
const Empty = ({ text }) => <p className="empty card">{text}</p>;

// ── ตัวช่วย
const SLOTS = ['เช้า', 'บ่าย', 'เย็น'];
const PRI = { สูง: 0, กลาง: 1, ต่ำ: 2 };
const PRI_ICON = { สูง: '🔴', กลาง: '🟡', ต่ำ: '⚪' };
const EXEC = /^n$/i; // N = ผู้บริหาร (ดู ORG ใน lib/persona.js)
const isExec = (name) => (EXEC.test(String(name || '').trim()) ? 1 : 0);
const slotOf = (t) => (t < '12:00' ? 'เช้า' : t < '16:00' ? 'บ่าย' : 'เย็น');
const short = (d) => `${Number(d.slice(8))}/${Number(d.slice(5, 7))}`;
const isWeekend = (d) => [0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay());
const dayLabel = (d, today) =>
  d === today ? 'วันนี้' : d === addDays(today, 1) ? 'พรุ่งนี้' : `${thaiWeekday(d).replace('วัน', '')} ${short(d)}`;
const fmtTime = (t) =>
  t.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// ลิงก์เปิดหน้าสร้างนัดใน Google Calendar (ใส่ Google Meet ต่อได้ในหน้านั้น)
function gcal(m) {
  const start = new Date(`${m.date}T${m.time}:00+07:00`);
  const end = new Date(start.getTime() + m.minutes * 60e3);
  const z = (t) => t.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: m.title,
    dates: `${z(start)}/${z(end)}`,
    details: [m.why, m.with?.length ? `ผู้เข้าร่วม: ${m.with.join(', ')}` : '', `จากกลุ่ม: ${m.group}`].filter(Boolean).join('\n'),
    ctz: 'Asia/Bangkok',
  });
  return `https://calendar.google.com/calendar/render?${p}`;
}

const QUERIES = {
  groups: `select w.source_id, w.title, i.data as insight, i.updated_at as insight_at,
                  (select count(*) from messages m where m.source_id = w.source_id and m.ts > now() - interval '24 hours') as msgs_24h,
                  (select to_char(max(m.ts) at time zone 'Asia/Bangkok', 'DD/MM HH24:MI') from messages m where m.source_id = w.source_id) as last_at,
                  r.summary as last_summary, to_char(r.created_at at time zone 'Asia/Bangkok', 'DD/MM HH24:MI') as last_summary_at
             from watched w
             left join group_insights i using (source_id)
             left join lateral (select summary, created_at from reports r where r.source_id = w.source_id order by created_at desc limit 1) r on true
            where w.active
            order by jsonb_array_length(coalesce(i.data->'needs', '[]')) desc, w.title`,
  reports: `select w.title, r.summary, to_char(r.created_at at time zone 'Asia/Bangkok', 'HH24:MI') as at,
                   (select count(*) from messages m where m.source_id = r.source_id and m.ts between r.period_start and r.period_end) as msgs
              from reports r left join watched w using (source_id)
             where r.created_at > now() - interval '24 hours'
             order by r.created_at desc limit 60`,
  alerts: `select a.kind, w.title, m.text, a.detail, to_char(a.created_at at time zone 'Asia/Bangkok', 'HH24:MI') as at
             from alerts a
             left join watched w using (source_id)
             left join messages m on m.line_message_id = a.ref
            where a.created_at > now() - interval '24 hours' and a.kind in ('sla', 'keyword', 'system')
            order by a.created_at desc limit 10`,
  states: `select data from state where source_id like 'U%'`,
};

// &demo=1 — ดูหน้าตาเต็ม ๆ โดยไม่แตะฐานข้อมูล
const D = bkkDate();
const DEMO = {
  groups: [
    {
      source_id: 'Cdemo1', title: 'FOR ASSISTANT', msgs_24h: 12, last_at: '24/09 10:12', insight_at: new Date().toISOString(),
      last_summary: 'N สั่งตามลูกค้า 2 เคสเรื่องขายพ่วง และให้เปลี่ยนรูปโปรโมท\nต้องทำ: ตามลูกค้า · เปลี่ยนรูป', last_summary_at: '24/09 10:05',
      insight: {
        status: 'N รอความคืบหน้าเรื่องขายพ่วง 2 เคส ทีมรอรูปโปรใหม่',
        needs: [
          { what: 'ตามลูกค้า 2 เคสเรื่องรับคู่/ขายพ่วง', from: 'N', owner: 'คุณเกม', priority: 'สูง', why: 'ผู้บริหารสั่งตรง', plan_date: D, plan_slot: 'เช้า', state: 'รอทำ' },
          { what: 'เปลี่ยนรูปโปรโมทสินค้าตามที่ N สั่ง', from: 'N', owner: 'ทีมกราฟิก', priority: 'สูง', why: '', plan_date: addDays(D, 1), plan_slot: 'บ่าย', state: 'กำลังทำ' },
        ],
        topics: [{ title: 'คอมเมนต์โพสต์โปรเก่า', detail: 'ตกลงลบโพสต์แล้ว' }],
        meetings: [{ title: 'อัปเดตแผนขายพ่วง Q4', why: 'N ต้องการเห็นภาพรวม', with: ['N', 'คุณเกม'], date: addDays(D, 1), time: '14:00', minutes: 30, confirmed: false }],
      },
    },
    {
      source_id: 'Cdemo2', title: 'DATA MARKETING', msgs_24h: 3, last_at: '24/09 09:40', insight_at: new Date().toISOString(),
      insight: {
        status: 'ฝุ่นทดสอบระบบบนเครื่องตัวเอง ยังไม่ขึ้นเซิร์ฟเวอร์กลาง',
        needs: [{ what: 'นัดฝุ่นขึ้นระบบทดสอบให้ทีมเข้าถึง', from: 'N', owner: 'ฝุ่น', priority: 'กลาง', why: '', plan_date: addDays(D, 2), plan_slot: 'เช้า', state: 'รอคำตอบ' }],
        topics: [{ title: 'ทดสอบระบบ', detail: 'รันบน Local Host' }],
        meetings: [],
      },
    },
  ],
  reports: [{ title: 'FOR ASSISTANT', summary: 'N สั่งตามลูกค้า 2 เคส', at: '10:05', msgs: 8 }],
  alerts: [],
  states: [],
};

const CSS = `
:root{--bg:#f6f5fb;--card:#fff;--ink:#1d1b2b;--mute:#6b6880;--line:#e7e4f0;--brand:#6d4aff;--brand-soft:#efeaff;
--hot:#e5484d;--hot-soft:#fdecec;--warn:#b7791f;--warn-soft:#fff5dc;--ok:#1f9d63;--ok-soft:#e5f6ee;--meet:#2563eb;--meet-soft:#e8efff}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#121119;--card:#1b1a24;--ink:#ecebf5;--mute:#a09db5;--line:#2c2a3a;
--brand:#9b86ff;--brand-soft:#2a2342;--hot:#ff6b6f;--hot-soft:#3a1e22;--warn:#f0b64a;--warn-soft:#352b17;--ok:#4cc38a;--ok-soft:#173026;--meet:#7aa2ff;--meet-soft:#1c2744}}
*{box-sizing:border-box}
body{background:var(--bg);color:var(--ink);font-family:'Noto Sans Thai',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:1180px;margin:0 auto;padding:24px 16px 48px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px}
h1,h2,h3{margin:0}
.hero{display:flex;flex-wrap:wrap;gap:20px;justify-content:space-between;align-items:flex-end;margin-bottom:20px}
.eyebrow{margin:0 0 4px;color:var(--brand);font-weight:700;font-size:13px;letter-spacing:.02em}
.hero h1{font-size:clamp(22px,3.4vw,30px);font-weight:800}
.sub{margin:6px 0 0;color:var(--mute);font-size:13px}
.kpis{display:grid;grid-template-columns:repeat(4,minmax(88px,1fr));gap:8px}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 12px}
.kpi b{display:block;font-size:24px;font-variant-numeric:tabular-nums}
.kpi span{font-size:12px;color:var(--mute)}
.kpi.hot{border-color:var(--hot);background:var(--hot-soft)}.kpi.hot b{color:var(--hot)}
.alert-strip{padding:14px 16px;margin-bottom:20px;border-color:var(--hot);background:var(--hot-soft)}
.alert-strip h2{font-size:15px;margin-bottom:6px}.alert-strip p{margin:4px 0;font-size:14px}
.section{margin-top:28px}
.section-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 12px;margin-bottom:10px}
.section-head h2{font-size:18px;font-weight:800}
.section-head p{margin:0;color:var(--mute);font-size:13px}
.count{margin-left:8px;font-size:12px;background:var(--brand-soft);color:var(--brand);border-radius:99px;padding:2px 8px;vertical-align:middle}
.table-wrap{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:14px}
.tbl{width:100%;border-collapse:collapse;font-size:14px}
.tbl th{text-align:left;font-size:12px;color:var(--mute);font-weight:600;padding:10px 12px;border-bottom:1px solid var(--line);white-space:nowrap}
.tbl td{padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:top}
.tbl tr:last-child td{border-bottom:0}
.what{min-width:240px}.what small{display:block;color:var(--mute);font-size:12px;margin-top:2px}
.nowrap{white-space:nowrap}
.pri{font-size:12px;font-weight:700;border-radius:6px;padding:2px 8px}
.p0{background:var(--hot-soft);color:var(--hot)}.p1{background:var(--warn-soft);color:var(--warn)}.p2{background:var(--line);color:var(--mute)}
.exec{margin-left:6px;font-size:11px;background:var(--ink);color:var(--card);border-radius:4px;padding:1px 6px}
.late{color:var(--hot);font-weight:700}
.state{font-size:12px;color:var(--mute)}
.groups{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px}
.group{padding:16px}
.group-head{display:flex;justify-content:space-between;gap:8px;align-items:baseline}
.group h3{font-size:16px}
.dot{font-size:12px;color:var(--mute);white-space:nowrap}.dot.live::before{content:'●';color:var(--ok);margin-right:4px}
.status{margin:8px 0;font-size:14px;line-height:1.55}
.meta{display:flex;flex-wrap:wrap;gap:6px}
.tag{font-size:12px;border-radius:6px;padding:2px 8px;background:var(--line);color:var(--mute)}
.tag.hot{background:var(--hot-soft);color:var(--hot)}.tag.ok{background:var(--ok-soft);color:var(--ok)}
.topics{margin:10px 0 0;padding-left:18px;font-size:13px;line-height:1.6}.topics span{color:var(--mute)}
details{margin-top:10px;font-size:13px}summary{cursor:pointer;color:var(--brand);font-weight:600}
.pre{white-space:pre-wrap;margin:6px 0 0;line-height:1.6;color:var(--ink)}
.plan td{min-width:170px}.plan .day{min-width:84px;font-weight:700}.plan .day small{display:block;color:var(--mute);font-weight:400}
.plan tr.weekend td{background:color-mix(in srgb,var(--line) 35%,transparent)}
.chip{font-size:13px;line-height:1.45;border-radius:8px;padding:6px 8px;margin-bottom:6px;border-left:3px solid var(--line);background:var(--bg)}
.chip small{display:block;color:var(--mute);font-size:11px}
.chip.need.p0{border-left-color:var(--hot)}.chip.need.p1{border-left-color:var(--warn)}
.chip.meet{border-left-color:var(--meet);background:var(--meet-soft)}.chip.todo{border-left-color:var(--brand)}
.cal{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:8px}
.cal-day{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px;min-height:140px}
.cal-day.today{border-color:var(--brand);box-shadow:0 0 0 1px var(--brand)}
.cal-day.weekend{opacity:.7}
.cal-head{font-weight:800;font-size:14px;margin-bottom:8px}.cal-head small{margin-left:6px;color:var(--mute);font-weight:400}
.meet{background:var(--meet-soft);border-radius:8px;padding:8px;margin-bottom:6px;font-size:13px;border:1px dashed var(--meet)}
.meet.yes{border-style:solid}
.meet small{display:block;color:var(--mute);font-size:12px}.meet .why{margin-top:2px}
.meet-time{color:var(--meet);font-weight:700;font-size:12px}
.meet-foot{display:flex;justify-content:space-between;align-items:center;margin-top:6px;gap:6px}
.meet-foot a{font-size:12px;color:var(--meet);font-weight:600;text-decoration:none}
.none{color:var(--mute);margin:0}
.timeline{list-style:none;margin:0;padding:0;background:var(--card);border:1px solid var(--line);border-radius:14px}
.timeline li{display:flex;gap:12px;padding:10px 14px;border-bottom:1px solid var(--line)}.timeline li:last-child{border-bottom:0}
.timeline .t{font-variant-numeric:tabular-nums;color:var(--mute);font-size:13px;min-width:44px;padding-top:1px}
.timeline details{margin:0;flex:1}.timeline summary{color:var(--ink);font-weight:400}
.empty{padding:16px;color:var(--mute);margin:0}
.demo{background:var(--warn-soft);color:var(--warn);padding:8px 12px;border-radius:10px;margin-bottom:12px;font-size:13px}
footer{margin-top:32px;text-align:center;color:var(--mute);font-size:12px}
.gate{min-height:100vh;display:grid;place-items:center;padding:16px}.gate-card{padding:28px;text-align:center;max-width:380px}
.gate-card p{color:var(--mute)}
@media (max-width:820px){.kpis{grid-template-columns:repeat(2,1fr);width:100%}.cal{grid-template-columns:1fr}.cal-day{min-height:0}.groups{grid-template-columns:1fr}}
`;
