'use client';
import { useMemo, useState } from 'react';

const COLS = [
  { id: 'todo', th: 'ต้องทำ' },
  { id: 'doing', th: 'กำลังทำ' },
  { id: 'waiting', th: 'รอคนอื่น' },
  { id: 'done', th: 'เสร็จแล้ว' },
];
const PRI = ['สูง', 'กลาง', 'ต่ำ'];
const TEAMS = ['Ads', 'Content', 'Graphic', 'Data Analysis', 'Admin', 'Production', 'CEO', 'ทุกทีม'];

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
const short = (d) => (d ? `${Number(d.slice(8))}/${Number(d.slice(5, 7))}` : '');
// ช่องวันที่รับเฉพาะปี ค.ศ. ช่วงนี้ — กันพิมพ์ปี พ.ศ. ลงไป (เซิร์ฟเวอร์ตรวจซ้ำอีกชั้น)
const DMIN = `${new Date().getFullYear() - 1}-01-01`;
const DMAX = `${new Date().getFullYear() + 5}-12-31`;
// นับวันจากวันที่ล้วน ๆ (ไม่ใช้เวลา) กันคลาดเพราะเขตเวลา
const daysLeft = (d) => (d ? Math.round((Date.parse(d) - Date.parse(today())) / 864e5) : null);
function dueInfo(t, left) {
  if (!t.due) return { text: 'ยังไม่กำหนดวันส่ง', cls: 'none-set' };
  const day = `ส่ง ${short(t.due)}`;
  if (t.status === 'done') return { text: day, cls: '' };
  if (left < 0) return { text: `${day} · เลย ${-left} วัน`, cls: 'bad' };
  if (left === 0) return { text: `${day} · วันนี้!`, cls: 'bad' };
  if (left <= 2) return { text: `${day} · เหลือ ${left} วัน`, cls: 'soon' };
  return { text: `${day} · เหลือ ${left} วัน`, cls: '' };
}
// ในคอลัมน์: ใกล้ส่งก่อน · ไม่มีวันส่งไว้ท้าย · วันเท่ากันเรียงความสำคัญ
const byDue = (a, b) => (a.due || '9999').localeCompare(b.due || '9999') || PRI.indexOf(a.priority) - PRI.indexOf(b.priority);

export default function Board({ initial, apiKey, botName }) {
  const [tasks, setTasks] = useState(initial);
  const [team, setTeam] = useState('');
  const [openId, setOpenId] = useState(null);
  const [dragId, setDragId] = useState(null);
  const [err, setErr] = useState('');
  const [draft, setDraft] = useState({ title: '', team: '', priority: 'สูง', due: '' });

  const api = async (method, body, query = '') => {
    setErr('');
    const res = await fetch(`/api/tasks${query}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-key': apiKey },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'บันทึกไม่สำเร็จ');
    return json;
  };
  const reload = async () => setTasks((await api('GET')).tasks);

  // แก้บนจอทันที แล้วค่อยบันทึก — พลาดก็ดึงของจริงกลับมา
  const patch = async (id, change) => {
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, ...change } : t)));
    try {
      await api('PATCH', { id, ...change });
    } catch (e) {
      setErr(e.message);
      reload();
    }
  };
  const add = async (e) => {
    e.preventDefault();
    if (!draft.title.trim()) return;
    try {
      await api('POST', draft);
      setDraft({ ...draft, title: '' });
      reload();
    } catch (e2) {
      setErr(e2.message);
    }
  };
  const remove = async (t) => {
    if (!confirm(`ลบงาน "${t.title}" ถาวร?`)) return;
    setTasks((ts) => ts.filter((x) => x.id !== t.id));
    try {
      await api('DELETE', null, `?id=${t.id}`);
    } catch (e) {
      setErr(e.message);
      reload();
    }
  };

  const shown = useMemo(() => tasks.filter((t) => !team || t.team === team), [tasks, team]);
  const teams = [...new Set([...TEAMS, ...tasks.map((t) => t.team).filter(Boolean)])];
  const open = tasks.filter((t) => t.status !== 'done');
  const late = open.filter((t) => t.due && t.due < today()).length;
  const soon = open.filter((t) => t.due && daysLeft(t.due) >= 0 && daysLeft(t.due) <= 2).length;
  const noDue = open.filter((t) => !t.due).length;
  const dash = `/dashboard${apiKey ? `?key=${apiKey}` : ''}`;

  return (
    <main className="wrap">
      <style>{CSS}</style>
      <header className="top">
        <div>
          <p className="eyebrow">{botName} · บอร์ดติดตามงาน</p>
          <h1>งานของคุณเกม</h1>
          <p className="sub">
            ค้าง {open.length} · สำคัญสูง {open.filter((t) => t.priority === 'สูง').length}
            {late ? <span className="late"> · เลยกำหนด {late}</span> : null}
            {soon ? <span className="soon"> · ใกล้ส่ง (≤2 วัน) {soon}</span> : null}
            {noDue ? <span> · ยังไม่มีวันส่ง {noDue}</span> : null}
          </p>
          <p className="sub">🔔 LINE เตือนงานใกล้ส่งทุกเช้า · สั่งผ่าน LINE ได้: “เพิ่มงาน …” / “งาน #3 ส่ง 10/10” / “งาน #3 เสร็จแล้ว”</p>
        </div>
        <a className="link" href={dash}>← กระดานกลุ่ม</a>
      </header>

      <form className="add card" onSubmit={add}>
        <input
          className="grow"
          placeholder="เพิ่มงานใหม่ แล้วกด Enter…"
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
        />
        <select value={draft.team} onChange={(e) => setDraft({ ...draft, team: e.target.value })} aria-label="ทีม">
          <option value="">ทีม —</option>
          {TEAMS.map((t) => <option key={t}>{t}</option>)}
        </select>
        <select value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value })} aria-label="ความสำคัญ">
          {PRI.map((p) => <option key={p}>{p}</option>)}
        </select>
        <label className="duebox">
          วันส่ง
          <input type="date" min={DMIN} max={DMAX} value={draft.due} onChange={(e) => setDraft({ ...draft, due: e.target.value })} />
        </label>
        <button type="submit">เพิ่ม</button>
      </form>

      <nav className="filters">
        {['', ...teams].map((t) => (
          <button key={t || 'all'} className={team === t ? 'on' : ''} onClick={() => setTeam(t)}>
            {t || 'ทุกงาน'}
          </button>
        ))}
      </nav>
      {err && <p className="err">⚠️ {err}</p>}

      <section className="cols">
        {COLS.map((c) => {
          const list = shown.filter((t) => t.status === c.id).sort(byDue);
          return (
            <div
              key={c.id}
              className={`col ${c.id}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => dragId && patch(dragId, { status: c.id })}
            >
              <h2>{c.th}<span>{list.length}</span></h2>
              {list.map((t) => (
                <Card
                  key={t.id}
                  t={t}
                  open={openId === t.id}
                  onToggle={() => setOpenId(openId === t.id ? null : t.id)}
                  onDrag={() => setDragId(t.id)}
                  onPatch={(ch) => patch(t.id, ch)}
                  onDelete={() => remove(t)}
                  teams={teams}
                />
              ))}
              {!list.length && <p className="none">ลากการ์ดมาวางตรงนี้</p>}
            </div>
          );
        })}
      </section>
    </main>
  );
}

function Card({ t, open, onToggle, onDrag, onPatch, onDelete, teams }) {
  const list = t.checklist || [];
  const done = list.filter((c) => c.done).length;
  const left = daysLeft(t.due);
  const due = dueInfo(t, left);
  const [item, setItem] = useState('');
  const setList = (next) => onPatch({ checklist: next });

  return (
    <article className={`card task p${PRI.indexOf(t.priority)}`} draggable onDragStart={onDrag}>
      <button className="task-head" onClick={onToggle} aria-expanded={open}>
        <div className="tags">
          <span className={`pri p${PRI.indexOf(t.priority)}`}>{t.priority}</span>
          {t.team && <span className="tag">{t.team}</span>}
          <span className="id">#{t.id}</span>
        </div>
        <b>{t.title}</b>
        <span className={`due ${due.cls}`}>📅 {due.text}</span>
        {!!list.length && (
          <div className="bar" title={`${done}/${list.length}`}>
            <i style={{ width: `${(done / list.length) * 100}%` }} />
            <small>{done}/{list.length}</small>
          </div>
        )}
      </button>

      {open && (
        <div className="edit">
          <textarea
            placeholder="รายละเอียด / โน้ต"
            defaultValue={t.detail || ''}
            onBlur={(e) => e.target.value !== (t.detail || '') && onPatch({ detail: e.target.value })}
          />
          <ul className="check">
            {list.map((c, i) => (
              <li key={i}>
                <label>
                  <input
                    type="checkbox"
                    checked={c.done}
                    onChange={() => setList(list.map((x, j) => (j === i ? { ...x, done: !x.done } : x)))}
                  />
                  <span className={c.done ? 'struck' : ''}>{c.text}</span>
                </label>
                <button className="x" onClick={() => setList(list.filter((_, j) => j !== i))} aria-label="ลบข้อนี้">×</button>
              </li>
            ))}
          </ul>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              if (item.trim()) setList([...list, { text: item.trim(), done: false }]);
              setItem('');
            }}
          >
            <input placeholder="+ ขั้นตอนย่อย" value={item} onChange={(e) => setItem(e.target.value)} />
          </form>
          <div className="row">
            <select value={t.status} onChange={(e) => onPatch({ status: e.target.value })} aria-label="สถานะ">
              {COLS.map((c) => <option key={c.id} value={c.id}>{c.th}</option>)}
            </select>
            <select value={t.priority} onChange={(e) => onPatch({ priority: e.target.value })} aria-label="ความสำคัญ">
              {PRI.map((p) => <option key={p}>{p}</option>)}
            </select>
            <select value={t.team || ''} onChange={(e) => onPatch({ team: e.target.value })} aria-label="ทีม">
              <option value="">ทีม —</option>
              {teams.map((x) => <option key={x}>{x}</option>)}
            </select>
            <input type="date" min={DMIN} max={DMAX} value={t.due || ''} onChange={(e) => onPatch({ due: e.target.value })} aria-label="กำหนดส่ง" />
          </div>
          <button className="del" onClick={onDelete}>ลบงาน</button>
        </div>
      )}
    </article>
  );
}

const CSS = `
:root{--bg:#f6f5fb;--card:#fff;--ink:#1d1b2b;--mute:#6b6880;--line:#e7e4f0;--brand:#6d4aff;--brand-soft:#efeaff;
--hot:#e5484d;--hot-soft:#fdecec;--warn:#b7791f;--warn-soft:#fff5dc;--ok:#1f9d63;--ok-soft:#e5f6ee;--wait:#2563eb;--wait-soft:#e8efff}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#121119;--card:#1b1a24;--ink:#ecebf5;--mute:#a09db5;--line:#2c2a3a;
--brand:#9b86ff;--brand-soft:#2a2342;--hot:#ff6b6f;--hot-soft:#3a1e22;--warn:#f0b64a;--warn-soft:#352b17;--ok:#4cc38a;--ok-soft:#173026;--wait:#7aa2ff;--wait-soft:#1c2744}}
*{box-sizing:border-box}
body{background:var(--bg);color:var(--ink);font-family:'Noto Sans Thai',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:1280px;margin:0 auto;padding:24px 16px 48px}
h1,h2{margin:0}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px}
.top{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap;margin-bottom:16px}
.eyebrow{margin:0 0 4px;color:var(--brand);font-weight:700;font-size:13px}
.top h1{font-size:clamp(22px,3.4vw,30px);font-weight:800}
.sub{margin:6px 0 0;color:var(--mute);font-size:13px}.late{color:var(--hot);font-weight:700}.soon{color:var(--warn);font-weight:700}
.link{color:var(--brand);font-weight:600;text-decoration:none;font-size:14px}
input,select,textarea,button{font:inherit;color:var(--ink)}
input,select,textarea{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:8px 10px;min-width:0}
button{cursor:pointer}
.add{display:flex;flex-wrap:wrap;gap:8px;padding:10px}
.add .grow{flex:1 1 260px}
.duebox{display:flex;align-items:center;gap:6px;font-size:13px;color:var(--mute)}
.add button[type=submit]{background:var(--brand);color:#fff;border:0;border-radius:8px;padding:8px 18px;font-weight:700}
.filters{display:flex;flex-wrap:wrap;gap:6px;margin:14px 0}
.filters button{border:1px solid var(--line);background:var(--card);border-radius:99px;padding:4px 12px;font-size:13px;color:var(--mute)}
.filters button.on{background:var(--brand);border-color:var(--brand);color:#fff}
.err{color:var(--hot);font-size:14px}
.cols{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;align-items:start}
.col{background:color-mix(in srgb,var(--line) 45%,transparent);border-radius:14px;padding:10px;min-height:220px}
.col h2{font-size:14px;font-weight:800;display:flex;justify-content:space-between;margin:2px 4px 10px}
.col h2 span{font-size:12px;color:var(--mute);font-weight:600}
.col.doing h2{color:var(--warn)}.col.waiting h2{color:var(--wait)}.col.done h2{color:var(--ok)}
.col.done .task{opacity:.7}
.none{color:var(--mute);font-size:12px;text-align:center;margin:24px 0}
.task{margin-bottom:8px;border-left:4px solid var(--line);overflow:hidden}
.task.p0{border-left-color:var(--hot)}.task.p1{border-left-color:var(--warn)}
.task-head{display:block;width:100%;text-align:left;background:none;border:0;padding:10px 12px}
.task-head b{display:block;font-size:14px;line-height:1.45;margin-top:6px}
.tags{display:flex;flex-wrap:wrap;gap:4px;align-items:center}
.pri,.tag{font-size:11px;border-radius:5px;padding:1px 7px}
.pri.p0{background:var(--hot-soft);color:var(--hot);font-weight:700}.pri.p1{background:var(--warn-soft);color:var(--warn)}.pri.p2{background:var(--line);color:var(--mute)}
.tag{background:var(--brand-soft);color:var(--brand)}.tag.bad{background:var(--hot-soft);color:var(--hot);font-weight:700}
.id{margin-left:auto;font-size:11px;color:var(--mute)}
.due{display:block;margin-top:6px;font-size:12px;color:var(--mute)}.due.soon{color:var(--warn);font-weight:700}.due.bad{color:var(--hot);font-weight:700}.due.none-set{font-style:italic;opacity:.75}
.bar{position:relative;height:6px;background:var(--line);border-radius:9px;margin-top:8px}
.bar i{position:absolute;inset:0 auto 0 0;background:var(--ok);border-radius:9px}
.bar small{position:absolute;right:0;top:6px;font-size:10px;color:var(--mute)}
.edit{padding:4px 12px 12px;border-top:1px dashed var(--line);display:grid;gap:8px}
.edit textarea{min-height:64px;resize:vertical;margin-top:8px}
.check{list-style:none;margin:0;padding:0;display:grid;gap:4px}
.check li{display:flex;justify-content:space-between;gap:6px;font-size:13px}
.check label{display:flex;gap:6px;align-items:flex-start;line-height:1.4}
.struck{text-decoration:line-through;color:var(--mute)}
.x{background:none;border:0;color:var(--mute);font-size:16px;line-height:1}
.row{display:flex;flex-wrap:wrap;gap:6px}.row input,.row select{flex:1 1 100px;font-size:13px;padding:6px 8px}
.del{justify-self:start;background:none;border:0;color:var(--hot);font-size:12px;padding:0}
@media (max-width:960px){.cols{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:560px){.cols{grid-template-columns:1fr}.col{min-height:0}}
`;
