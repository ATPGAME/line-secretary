'use client';
import { useEffect, useMemo, useState } from 'react';

// ── Season Map: ตารางทั้งปี (12 เดือน) · ตารางรายเดือน · นัดที่กำลังจะถึง — ธีมเดียวกับ Quest Board
const MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const MSHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const DOW = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัส', 'ศุกร์', 'เสาร์'];
const DOW1 = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const KINDS = ['งาน', 'ส่วนตัว', 'วันหยุด'];
const KCLS = { งาน: 'work', ส่วนตัว: 'life', วันหยุด: 'hol' };
const KICON = { งาน: '💼', ส่วนตัว: '🎮', วันหยุด: '🎌' };

const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const be = (y) => y + 543;
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const diffDays = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const dow = (d) => new Date(`${d}T12:00:00Z`).getUTCDay();
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const thaiDate = (d) => `${DOW[dow(d)]} ${Number(d.slice(8))} ${MSHORT[Number(d.slice(5, 7)) - 1]}`;
// ช่องวันในตารางเดือน เริ่มอาทิตย์ — เติมวันเดือนก่อน/หลังให้ครบสัปดาห์
function monthCells(y, m) {
  const first = iso(y, m, 1);
  const start = addDays(first, -dow(first));
  const weeks = Math.ceil((dow(first) + daysIn(y, m)) / 7);
  return Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i));
}

export default function Calendar({ initial, startMonth, today, apiKey, botName }) {
  const [events, setEvents] = useState(initial);
  const [ym, setYm] = useState(startMonth); // 'YYYY-MM' ที่กำลังดู
  const [loadedYear, setLoadedYear] = useState(Number(startMonth.slice(0, 4)));
  const [pick, setPick] = useState(null); // วันที่ที่เลือก (เปิดแผงแก้)
  const [err, setErr] = useState('');
  const [draft, setDraft] = useState({ title: '', date: today, time: '', kind: 'งาน' });
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));

  const api = async (method, body, query = '') => {
    setErr('');
    const res = await fetch(`/api/events${query}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-key': apiKey },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'บันทึกไม่สำเร็จ');
    return json;
  };
  const reload = async (year = y) => setEvents((await api('GET', null, `?year=${year}`)).events);

  // เลื่อนข้ามปี → โหลดปีนั้น
  useEffect(() => {
    if (y !== loadedYear) {
      setLoadedYear(y);
      reload(y).catch((e) => setErr(e.message));
    }
  }, [y]); // eslint-disable-line react-hooks/exhaustive-deps

  const byDate = useMemo(() => {
    const map = {};
    for (const e of events) (map[e.date] ||= []).push(e);
    return map;
  }, [events]);

  const go = (delta) => {
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    setYm(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`);
    setPick(null);
  };
  const add = async (e) => {
    e.preventDefault();
    if (!draft.title.trim()) return;
    try {
      await api('POST', draft);
      setDraft({ ...draft, title: '', time: '' });
      const ny = Number(draft.date.slice(0, 4));
      if (ny === y) await reload();
      setYm(draft.date.slice(0, 7));
      setPick(draft.date);
    } catch (e2) {
      setErr(e2.message);
    }
  };
  const remove = async (ev) => {
    if (!confirm(`ลบนัด "${ev.title}"?`)) return;
    setEvents((xs) => xs.filter((x) => x.id !== ev.id));
    try {
      await api('DELETE', null, `?id=${ev.id}`);
    } catch (e) {
      setErr(e.message);
      reload();
    }
  };
  const save = async (ev, change) => {
    setEvents((xs) => xs.map((x) => (x.id === ev.id ? { ...x, ...change } : x)));
    try {
      await api('PATCH', { id: ev.id, ...change });
      if (change.date) reload();
    } catch (e) {
      setErr(e.message);
      reload();
    }
  };

  // นัดที่กำลังจะถึง 30 วัน (ของปีที่โหลดอยู่ + ข้ามปีไม่ได้ดึง — พอสำหรับมุมมองนี้)
  const upcoming = events.filter((e) => e.date >= today && diffDays(today, e.date) <= 30);
  const next = upcoming.find((e) => e.kind !== 'วันหยุด');
  const monthEvents = events.filter((e) => e.date.startsWith(ym));
  const busyDays = new Set(monthEvents.filter((e) => e.kind !== 'วันหยุด').map((e) => e.date)).size;
  const dash = (p) => `${p}${apiKey ? `?key=${apiKey}` : ''}`;

  return (
    <main className="sm">
      <style>{CSS}</style>
      <div className="bg" aria-hidden />

      {/* ── HUD */}
      <header className="hud panel">
        <div>
          <p className="tagline">{botName} · SEASON MAP</p>
          <h1>ตารางของคุณเกม <span>ปี {be(y)}</span></h1>
          <p className="sub">
            {next
              ? <>⚔️ ภารกิจถัดไป: <b>{next.title}</b> · {diffDays(today, next.date) === 0 ? 'วันนี้' : `อีก ${diffDays(today, next.date)} วัน`} ({thaiDate(next.date)}{next.time ? ` ${next.time}` : ''})</>
              : 'ยังไม่มีนัดใน 30 วันข้างหน้า'}
          </p>
        </div>
        <div className="stats">
          <div className="stat"><b>📅 {monthEvents.filter((e) => e.kind !== 'วันหยุด').length}</b><span>นัดเดือนนี้</span></div>
          <div className="stat"><b>🔥 {busyDays}</b><span>วันที่ไม่ว่าง</span></div>
          <div className="stat"><b>🎌 {monthEvents.filter((e) => e.kind === 'วันหยุด').length}</b><span>วันหยุด</span></div>
        </div>
        <nav className="links">
          <a href={dash('/board')}>📜 Quest Board</a>
          <a href={dash('/dashboard')}>🗺️ กลุ่ม</a>
        </nav>
      </header>

      {/* ── ทั้งปี */}
      <section className="year">
        {MONTHS.map((name, i) => {
          const mm = `${y}-${pad(i + 1)}`;
          const n = events.filter((e) => e.date.startsWith(mm) && e.kind !== 'วันหยุด').length;
          return (
            <button key={mm} className={`mini panel ${mm === ym ? 'on' : ''}`} onClick={() => { setYm(mm); setPick(null); }}>
              <div className="mini-head"><b>{name}</b>{n ? <span>{n} นัด</span> : <span className="dim">ว่าง</span>}</div>
              <div className="mini-grid">
                {DOW1.map((d) => <i key={d} className="dh">{d}</i>)}
                {monthCells(y, i + 1).map((d) => {
                  const list = byDate[d] || [];
                  const out = !d.startsWith(mm);
                  const cls = [
                    out && 'out',
                    d === today && 'today',
                    list.some((e) => e.kind === 'วันหยุด') && 'hol',
                    list.some((e) => e.kind !== 'วันหยุด') && 'busy',
                  ].filter(Boolean).join(' ');
                  return <i key={d} className={cls}>{out ? '' : Number(d.slice(8))}</i>;
                })}
              </div>
            </button>
          );
        })}
      </section>

      {/* ── เพิ่มนัด */}
      <form className="console panel" onSubmit={add}>
        <span className="prompt" aria-hidden>&gt;</span>
        <input className="grow" placeholder="เพิ่มนัดใหม่ เช่น ประชุมทีม Ads…" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} aria-label="ชื่อนัด" />
        <input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} aria-label="วันที่" />
        <input type="time" value={draft.time} onChange={(e) => setDraft({ ...draft, time: e.target.value })} aria-label="เวลา (ว่าง = ทั้งวัน)" />
        <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })} aria-label="ประเภท">
          {KINDS.map((k) => <option key={k} value={k}>{KICON[k]} {k}</option>)}
        </select>
        <button className="go" type="submit">+ ลงตาราง</button>
      </form>
      <p className="hint">💬 สั่งผ่าน LINE ได้: “นัดหมอฟัน 15 ต.ค. 6 โมงเย็น” · 🔔 LINE เตือน: เช้า = วันนี้มีอะไร · 2 ทุ่ม = พรุ่งนี้มีอะไร · ก่อนนัด ~1 ชม.</p>
      {err && <p className="err">⚠️ {err}</p>}

      <div className="split">
        {/* ── เดือน */}
        <section className="month panel">
          <div className="month-head">
            <h2>{MONTHS[m - 1]} <span>{be(y)}</span></h2>
            <div className="nav">
              <button onClick={() => go(-1)} aria-label="เดือนก่อน">‹</button>
              <button onClick={() => { setYm(today.slice(0, 7)); setPick(today); }}>วันนี้</button>
              <button onClick={() => go(1)} aria-label="เดือนถัดไป">›</button>
            </div>
          </div>
          <div className="grid">
            {DOW.map((d, i) => <div key={d} className={`dow ${i === 0 || i === 6 ? 'we' : ''}`}>{d}</div>)}
            {monthCells(y, m).map((d) => {
              const list = byDate[d] || [];
              const out = !d.startsWith(ym);
              return (
                <button
                  key={d}
                  className={`cell ${out ? 'out' : ''} ${d === today ? 'today' : ''} ${pick === d ? 'picked' : ''} ${d < today ? 'past' : ''}`}
                  onClick={() => { setPick(d); setDraft((x) => ({ ...x, date: d })); }}
                >
                  <span className="num">{Number(d.slice(8))}{d.slice(8) === '01' && <small> {MSHORT[Number(d.slice(5, 7)) - 1]}</small>}</span>
                  {list.slice(0, 3).map((e) => (
                    <span key={e.id} className={`ev ${KCLS[e.kind]}`}>
                      <em>{e.title}</em>{e.time && <time>{e.time}</time>}
                    </span>
                  ))}
                  {list.length > 3 && <span className="more">+{list.length - 3}</span>}
                </button>
              );
            })}
          </div>
        </section>

        {/* ── ข้าง: วันที่เลือก / นัดที่กำลังจะถึง */}
        <aside className="side">
          {pick && (
            <section className="panel day">
              <h3>{thaiDate(pick)} {be(Number(pick.slice(0, 4)))}</h3>
              {(byDate[pick] || []).length ? (byDate[pick] || []).map((e) => (
                <div key={e.id} className={`item ${KCLS[e.kind]}`}>
                  <input defaultValue={e.title} onBlur={(x) => x.target.value.trim() && x.target.value !== e.title && save(e, { title: x.target.value })} aria-label="ชื่อนัด" />
                  <div className="row">
                    <input type="time" defaultValue={e.time || ''} onBlur={(x) => x.target.value !== (e.time || '') && save(e, { time: x.target.value })} aria-label="เวลา" />
                    <select value={e.kind} onChange={(x) => save(e, { kind: x.target.value })} aria-label="ประเภท">
                      {KINDS.map((k) => <option key={k} value={k}>{KICON[k]} {k}</option>)}
                    </select>
                    <button className="del" onClick={() => remove(e)} aria-label="ลบนัด">ลบ</button>
                  </div>
                </div>
              )) : <p className="dim">ว่าง — พิมพ์นัดในช่องด้านบนได้เลย (ตั้งวันที่ให้แล้ว)</p>}
            </section>
          )}
          <section className="panel agenda">
            <h3>🗓️ 30 วันข้างหน้า</h3>
            {upcoming.length ? upcoming.map((e) => {
              const n = diffDays(today, e.date);
              return (
                <button key={e.id} className={`ag ${KCLS[e.kind]}`} onClick={() => { setYm(e.date.slice(0, 7)); setPick(e.date); }}>
                  <span className="when">{n === 0 ? 'วันนี้' : n === 1 ? 'พรุ่งนี้' : `อีก ${n} วัน`}</span>
                  <b>{KICON[e.kind]} {e.title}</b>
                  <small>{thaiDate(e.date)}{e.time ? ` · ${e.time}` : ' · ทั้งวัน'}</small>
                </button>
              );
            }) : <p className="dim">ไม่มีนัด</p>}
          </section>
        </aside>
      </div>
    </main>
  );
}

const CSS = `
html,body{background:#0b0d17}
.sm{--bg:#0b0d17;--panel:#141827;--panel2:#1a1f33;--line:#272d4a;--ink:#e8ecff;--mute:#8b93b8;
--cyan:#3de0ff;--pink:#ff4fd8;--lime:#7cff6b;--gold:#ffc542;--red:#ff4d5e;--purple:#a974ff;
--disp:'Chakra Petch','Noto Sans Thai',system-ui,sans-serif;
position:relative;min-height:100vh;background:var(--bg);color:var(--ink);font-family:'Noto Sans Thai',system-ui,sans-serif;
-webkit-font-smoothing:antialiased;padding:20px 16px 64px;overflow-x:hidden}
.sm *{box-sizing:border-box}.sm h1,.sm h2,.sm h3{margin:0}
.bg{position:fixed;inset:0;pointer-events:none;z-index:0;
background:radial-gradient(900px 500px at 0% -10%,rgba(169,116,255,.16),transparent 60%),radial-gradient(800px 500px at 100% 0%,rgba(61,224,255,.12),transparent 60%),
linear-gradient(rgba(255,255,255,.025) 1px,transparent 1px) 0 0/100% 32px,linear-gradient(90deg,rgba(255,255,255,.025) 1px,transparent 1px) 0 0/32px 100%}
.sm>*:not(.bg){position:relative;z-index:1;max-width:1320px;margin-left:auto;margin-right:auto}
.panel{background:linear-gradient(180deg,var(--panel2),var(--panel));border:1px solid var(--line);border-radius:16px;box-shadow:0 10px 30px rgba(0,0,0,.35)}
.sm input,.sm select,.sm button{font:inherit;color:var(--ink)}
.sm input,.sm select{background:#0f1322;border:1px solid var(--line);border-radius:10px;padding:8px 10px;min-width:0;color-scheme:dark}
.sm input:focus,.sm select:focus{outline:none;border-color:var(--cyan);box-shadow:0 0 0 3px rgba(61,224,255,.18)}
.sm button{cursor:pointer}.sm :focus-visible{outline:2px solid var(--cyan);outline-offset:2px}
.dim{color:var(--mute);font-size:13px}

.hud{display:grid;grid-template-columns:1fr auto auto;gap:16px;align-items:center;padding:16px 18px;margin-bottom:14px}
.tagline{margin:0;font:600 11px/1 var(--disp);letter-spacing:.14em;color:var(--purple)}
.hud h1{font:700 26px/1.25 var(--disp);margin:4px 0 6px}.hud h1 span{color:var(--gold);font-size:18px;margin-left:6px}
.sub{margin:0;color:var(--mute);font-size:14px}.sub b{color:var(--ink)}
.stats{display:grid;grid-template-columns:repeat(3,minmax(92px,1fr));gap:8px}
.stat{background:#0f1322;border:1px solid var(--line);border-radius:12px;padding:8px 10px}
.stat b{display:block;font:700 20px/1.2 var(--disp)}.stat span{font-size:11px;color:var(--mute)}
.links{display:grid;gap:6px;align-self:start}
.links a{color:var(--cyan);text-decoration:none;font:600 13px var(--disp);white-space:nowrap}

/* ทั้งปี */
.year{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;margin-bottom:14px}
.mini{text-align:left;padding:10px;border-radius:14px;transition:transform .15s,border-color .15s}
.mini:hover{transform:translateY(-2px);border-color:var(--purple)}
.mini.on{border-color:var(--cyan);box-shadow:0 0 0 1px var(--cyan),0 0 18px rgba(61,224,255,.3)}
.mini-head{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px}
.mini-head b{font:700 13px var(--disp)}.mini-head span{font:600 11px var(--disp);color:var(--pink)}.mini-head .dim{color:var(--mute);font-size:11px}
.mini-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px}
.mini-grid i{font-style:normal;font:500 9px/16px var(--disp);text-align:center;border-radius:4px;color:var(--mute)}
.mini-grid i.dh{color:#5c6386}
.mini-grid i.busy{background:var(--pink);color:#0b0d17;font-weight:700;box-shadow:0 0 6px rgba(255,79,216,.6)}
.mini-grid i.hol{background:rgba(169,116,255,.35);color:var(--ink)}
.mini-grid i.hol.busy{background:var(--pink)}
.mini-grid i.today{outline:1px solid var(--cyan);color:var(--cyan);font-weight:700}

/* คอนโซล */
.console{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px}
.prompt{font:700 20px var(--disp);color:var(--lime);padding:0 4px 0 6px;text-shadow:0 0 10px rgba(124,255,107,.7)}
.console .grow{flex:1 1 240px;font-size:15px}
.go{background:linear-gradient(135deg,var(--purple),var(--cyan));color:#0b0d17 !important;border:0;border-radius:10px;padding:9px 16px;font:700 14px var(--disp);box-shadow:0 0 18px rgba(169,116,255,.35)}
.hint{margin:8px 4px 14px;font-size:12px;color:var(--mute)}.err{color:var(--red);font-size:14px}

/* เดือน + ข้าง */
.split{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:14px;align-items:start}
.month{padding:14px}
.month-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
.month-head h2{font:700 28px var(--disp)}.month-head h2 span{font-weight:500;color:var(--mute)}
.nav{display:flex;gap:6px}.nav button{background:#0f1322;border:1px solid var(--line);border-radius:10px;padding:6px 12px;font:600 14px var(--disp)}
.nav button:hover{border-color:var(--cyan);color:var(--cyan)}
.grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));border-top:1px solid var(--line);border-left:1px solid var(--line);border-radius:10px;overflow:hidden}
.dow{font:600 12px var(--disp);text-align:right;padding:6px 8px;color:var(--mute);border-right:1px solid var(--line);border-bottom:1px solid var(--line);background:#10142a}
.dow.we{color:var(--pink)}
.cell{position:relative;min-height:104px;display:flex;flex-direction:column;gap:3px;align-items:stretch;text-align:left;background:transparent;
border:0;border-right:1px solid var(--line);border-bottom:1px solid var(--line);padding:6px;transition:background .12s}
.cell:hover{background:rgba(61,224,255,.05)}
.cell.out{opacity:.35}.cell.past .num{color:var(--mute)}
.cell.picked{background:rgba(169,116,255,.12);box-shadow:inset 0 0 0 1px var(--purple)}
.num{align-self:flex-end;font:600 15px var(--disp);padding:1px 6px;border-radius:99px}
.num small{font-size:11px;color:var(--mute)}
.cell.today .num{background:var(--cyan);color:#0b0d17;box-shadow:0 0 12px rgba(61,224,255,.7)}
.ev{display:flex;justify-content:space-between;gap:4px;font-size:12px;line-height:1.35;border-radius:6px;padding:2px 6px;border-left:3px solid var(--pink);background:rgba(255,79,216,.1)}
.ev em{font-style:normal;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ev time{flex:none;font:600 10px/1.6 var(--disp);color:var(--mute)}
.ev.life{border-left-color:var(--lime);background:rgba(124,255,107,.08)}
.ev.hol{border-left-color:var(--purple);background:rgba(169,116,255,.22);color:#dccbff}
.more{font-size:11px;color:var(--mute);padding-left:6px}
.side{display:grid;gap:12px}
.side h3{font:700 15px var(--disp);margin-bottom:10px}
.day,.agenda{padding:14px}
.item{display:grid;gap:6px;padding:8px;border-radius:10px;margin-bottom:8px;background:#0f1322;border-left:3px solid var(--pink)}
.item.life{border-left-color:var(--lime)}.item.hol{border-left-color:var(--purple)}
.row{display:flex;gap:6px;flex-wrap:wrap}.row input,.row select{flex:1 1 90px;font-size:13px;padding:6px 8px}
.del{background:none;border:0;color:var(--red) !important;font-size:12px}
.ag{display:grid;grid-template-columns:64px 1fr;gap:0 8px;width:100%;text-align:left;background:none;border:0;border-bottom:1px dashed var(--line);padding:8px 2px}
.ag .when{grid-row:span 2;font:700 12px var(--disp);color:var(--cyan);padding-top:2px}
.ag b{font-size:14px;font-weight:600}.ag small{color:var(--mute);font-size:12px}
.ag.hol .when{color:var(--purple)}.ag:hover b{color:var(--cyan)}
@media (max-width:1100px){.year{grid-template-columns:repeat(4,minmax(0,1fr))}.split{grid-template-columns:1fr}.hud{grid-template-columns:1fr}}
@media (max-width:640px){.year{grid-template-columns:repeat(2,minmax(0,1fr))}.stats{grid-template-columns:repeat(3,1fr)}
.cell{min-height:64px;padding:3px}.ev time{display:none}.ev{font-size:10px;padding:1px 3px}.dow{font-size:10px;padding:4px}.month-head h2{font-size:22px}}
@media (prefers-reduced-motion:reduce){.sm *{animation:none !important;transition:none !important}}
`;
