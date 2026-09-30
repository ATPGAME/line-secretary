'use client';
import { useEffect, useMemo, useRef, useState } from 'react';

// ── Quest Board: งาน = เควสต์ · ความสำคัญ = ความหายาก · ขั้นตอนย่อย = ด่าน · ปิดงานได้ XP
const COLS = [
  { id: 'todo', th: 'เควสต์ใหม่', en: 'NEW QUEST', icon: '📜' },
  { id: 'doing', th: 'กำลังลุย', en: 'IN BATTLE', icon: '⚔️' },
  { id: 'waiting', th: 'รอปาร์ตี้', en: 'WAITING', icon: '⏳' },
  { id: 'done', th: 'เคลียร์แล้ว', en: 'CLEARED', icon: '🏆' },
];
const PRI = ['สูง', 'กลาง', 'ต่ำ'];
const RARITY = { สูง: 'LEGENDARY', กลาง: 'EPIC', ต่ำ: 'COMMON' };
const RCLS = { สูง: 'leg', กลาง: 'epic', ต่ำ: 'com' };
const TEAMS = ['Ads', 'Content', 'Graphic', 'Data Analysis', 'Admin', 'Production', 'CEO', 'ทุกทีม'];
const GUILD = { Ads: '🎯', Content: '✍️', Graphic: '🎨', 'Data Analysis': '📊', Admin: '🗂️', Production: '🎬', CEO: '👑', ทุกทีม: '🛡️' };

// กติกา XP — ต้องตรงกับ archivedXp() ใน lib/tasks.js
const TASK_XP = { สูง: 150, กลาง: 100, ต่ำ: 50 };
const STEP_XP = 10;
const LEVEL_XP = 300;
const taskXp = (t) =>
  (t.checklist || []).filter((c) => c.done).length * STEP_XP + (t.status === 'done' ? TASK_XP[t.priority] || 100 : 0);
const rank = (lv) => (lv >= 10 ? 'Legend' : lv >= 6 ? 'Commander' : lv >= 3 ? 'Captain' : 'Rookie');

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
const short = (d) => (d ? `${Number(d.slice(8))}/${Number(d.slice(5, 7))}` : '');
// ช่องวันที่รับเฉพาะปี ค.ศ. ช่วงนี้ — กันพิมพ์ปี พ.ศ. ลงไป (เซิร์ฟเวอร์ตรวจซ้ำอีกชั้น)
const DMIN = `${new Date().getFullYear() - 1}-01-01`;
const DMAX = `${new Date().getFullYear() + 5}-12-31`;
// นับวันจากวันที่ล้วน ๆ (ไม่ใช้เวลา) กันคลาดเพราะเขตเวลา
const daysLeft = (d) => (d ? Math.round((Date.parse(d) - Date.parse(today())) / 864e5) : null);
function timer(t) {
  const left = daysLeft(t.due);
  if (!t.due) return { text: 'ไม่มีกำหนดเวลา', cls: 'none' };
  if (t.status === 'done') return { text: `ส่ง ${short(t.due)}`, cls: 'ok' };
  if (left < 0) return { text: `💀 เลย ${-left} วัน · ${short(t.due)}`, cls: 'boss' };
  if (left === 0) return { text: `🔥 หมดเวลาวันนี้ · ${short(t.due)}`, cls: 'boss' };
  if (left <= 2) return { text: `⏳ เหลือ ${left} วัน · ${short(t.due)}`, cls: 'soon' };
  return { text: `⏳ เหลือ ${left} วัน · ${short(t.due)}`, cls: '' };
}
// ในคอลัมน์: ใกล้หมดเวลาก่อน · ไม่มีกำหนดไว้ท้าย · วันเท่ากันเรียงความหายาก
const byDue = (a, b) => (a.due || '9999').localeCompare(b.due || '9999') || PRI.indexOf(a.priority) - PRI.indexOf(b.priority);

export default function Board({ initial, xpBase = 0, apiKey, botName }) {
  const [tasks, setTasks] = useState(initial);
  const [team, setTeam] = useState('');
  const [openId, setOpenId] = useState(null);
  const [dragId, setDragId] = useState(null);
  const [overCol, setOverCol] = useState(null);
  const [err, setErr] = useState('');
  const [toast, setToast] = useState(null);
  const [draft, setDraft] = useState({ title: '', team: '', priority: 'สูง', due: '' });
  const toastTimer = useRef();

  const xp = xpBase + tasks.reduce((s, t) => s + taskXp(t), 0);
  const level = Math.floor(xp / LEVEL_XP) + 1;
  const inLevel = xp % LEVEL_XP;

  const flash = (t) => {
    clearTimeout(toastTimer.current);
    setToast(t);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  };
  useEffect(() => () => clearTimeout(toastTimer.current), []);

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

  // แก้บนจอทันที แล้วค่อยบันทึก — พลาดก็ดึงของจริงกลับมา · ได้ XP เด้ง toast
  const patch = async (id, change) => {
    const before = tasks.find((t) => t.id === id);
    if (!before) return;
    const after = { ...before, ...change };
    const gained = taskXp(after) - taskXp(before);
    const lvBefore = level;
    setTasks((ts) => ts.map((t) => (t.id === id ? after : t)));
    if (gained > 0) {
      const lvAfter = Math.floor((xp + gained) / LEVEL_XP) + 1;
      flash(
        lvAfter > lvBefore
          ? { big: `LEVEL UP! Lv.${lvAfter}`, small: `+${gained} XP · ${rank(lvAfter)} Manager`, kind: 'lvl' }
          : after.status === 'done' && before.status !== 'done'
            ? { big: 'QUEST CLEAR!', small: `+${gained} XP · ${after.title}`, kind: 'clear' }
            : { big: `+${gained} XP`, small: 'ผ่านด่านย่อย', kind: 'step' }
      );
    }
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
      flash({ big: 'NEW QUEST!', small: draft.title, kind: 'new' });
      reload();
    } catch (e2) {
      setErr(e2.message);
    }
  };
  const remove = async (t) => {
    if (!confirm(`ทิ้งเควสต์ "${t.title}" ถาวร?`)) return;
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
  const bosses = open.filter((t) => t.due && daysLeft(t.due) < 0).length;
  const soon = open.filter((t) => t.due && daysLeft(t.due) >= 0 && daysLeft(t.due) <= 2).length;
  const cleared = tasks.filter((t) => t.status === 'done').length;
  const dash = `/dashboard${apiKey ? `?key=${apiKey}` : ''}`;

  return (
    <main className="qb">
      <style>{CSS}</style>
      <div className="bg" aria-hidden />

      {/* ── HUD ผู้เล่น */}
      <header className="hud panel">
        <div className="player">
          <div className="avatar" aria-hidden>🎮<span className="lv">{level}</span></div>
          <div className="pinfo">
            <p className="tagline">{botName} · QUEST BOARD</p>
            <h1>คุณเกม <span className="rank">Lv.{level} {rank(level)} Manager</span></h1>
            <div className="xp" role="progressbar" aria-valuenow={inLevel} aria-valuemin={0} aria-valuemax={LEVEL_XP} aria-label="XP">
              <i style={{ width: `${(inLevel / LEVEL_XP) * 100}%` }} />
              <span>{inLevel} / {LEVEL_XP} XP</span>
            </div>
          </div>
        </div>
        <div className="stats">
          <Stat icon="⚔️" n={open.length} label="เควสต์ค้าง" />
          <Stat icon="💀" n={bosses} label="บอสโผล่ (เลยกำหนด)" tone={bosses ? 'boss' : ''} />
          <Stat icon="⏳" n={soon} label="ใกล้หมดเวลา ≤2 วัน" tone={soon ? 'soon' : ''} />
          <Stat icon="🏆" n={cleared} label="เคลียร์ 14 วัน" tone="ok" />
        </div>
        <a className="back" href={dash}>🗺️ แผนที่กลุ่ม</a>
      </header>

      {/* ── คอนโซลเพิ่มเควสต์ */}
      <form className="console panel" onSubmit={add}>
        <span className="prompt" aria-hidden>&gt;</span>
        <input
          className="grow"
          placeholder="พิมพ์เควสต์ใหม่ แล้วกด Enter…"
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          aria-label="ชื่อเควสต์"
        />
        <select value={draft.team} onChange={(e) => setDraft({ ...draft, team: e.target.value })} aria-label="กิลด์">
          <option value="">กิลด์ —</option>
          {TEAMS.map((t) => <option key={t} value={t}>{GUILD[t]} {t}</option>)}
        </select>
        <select value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value })} aria-label="ความหายาก">
          {PRI.map((p) => <option key={p} value={p}>{RARITY[p]} · {p}</option>)}
        </select>
        <label className="duebox">
          ⏳
          <input type="date" min={DMIN} max={DMAX} value={draft.due} onChange={(e) => setDraft({ ...draft, due: e.target.value })} aria-label="วันส่ง" />
        </label>
        <button type="submit" className="go">+ รับเควสต์</button>
      </form>
      <p className="hint">💬 สั่งผ่าน LINE ได้: “เพิ่มงาน …” · “งาน #3 ส่ง 10/10” · “งาน #3 เสร็จแล้ว” · 🔔 LINE เตือนเควสต์ใกล้หมดเวลาทุกเช้า</p>

      <nav className="guilds" aria-label="กรองตามกิลด์">
        {['', ...teams].map((t) => (
          <button key={t || 'all'} className={team === t ? 'on' : ''} onClick={() => setTeam(t)}>
            {t ? `${GUILD[t] || '⭐'} ${t}` : '🌐 ทุกกิลด์'}
          </button>
        ))}
      </nav>
      {err && <p className="err">⚠️ {err}</p>}

      {/* ── กระดานเควสต์ */}
      <section className="cols">
        {COLS.map((c) => {
          const list = shown.filter((t) => t.status === c.id).sort(byDue);
          return (
            <div
              key={c.id}
              className={`col ${c.id} ${overCol === c.id ? 'over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setOverCol(c.id);
              }}
              onDragLeave={() => setOverCol(null)}
              onDrop={() => {
                setOverCol(null);
                if (dragId) patch(dragId, { status: c.id });
              }}
            >
              <h2>
                <span>{c.icon} {c.th}<small>{c.en}</small></span>
                <b>{list.length}</b>
              </h2>
              {list.map((t) => (
                <Quest
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
              {!list.length && <p className="empty">{c.id === 'done' ? 'ยังไม่มีถ้วยรางวัล — ลากเควสต์มาวาง' : 'ลากเควสต์มาวางตรงนี้'}</p>}
            </div>
          );
        })}
      </section>

      {toast && (
        <div className={`toast ${toast.kind}`} role="status">
          <b>{toast.big}</b>
          <span>{toast.small}</span>
        </div>
      )}
    </main>
  );
}

const Stat = ({ icon, n, label, tone = '' }) => (
  <div className={`stat ${tone}`}>
    <b>{icon} {n}</b>
    <span>{label}</span>
  </div>
);

function Quest({ t, open, onToggle, onDrag, onPatch, onDelete, teams }) {
  const list = t.checklist || [];
  const done = list.filter((c) => c.done).length;
  const tm = timer(t);
  const [item, setItem] = useState('');
  const setList = (next) => onPatch({ checklist: next });
  const reward = TASK_XP[t.priority] + list.length * STEP_XP;

  return (
    <article className={`quest ${RCLS[t.priority] || 'epic'} ${tm.cls === 'boss' ? 'is-boss' : ''} ${t.status === 'done' ? 'is-done' : ''}`} draggable onDragStart={onDrag}>
      <button className="q-head" onClick={onToggle} aria-expanded={open}>
        <div className="q-top">
          <span className="rarity">{RARITY[t.priority] || 'EPIC'}</span>
          {t.team && <span className="guild">{GUILD[t.team] || '⭐'} {t.team}</span>}
          <span className="qid">Q-{t.id}</span>
        </div>
        <b className="q-title">{t.title}</b>
        <div className="q-foot">
          <span className={`timer ${tm.cls}`}>{tm.text}</span>
          <span className="reward">+{reward} XP</span>
        </div>
        {!!list.length && (
          <div className="stages" aria-label={`ผ่าน ${done} จาก ${list.length} ด่าน`}>
            {list.map((c, i) => <i key={i} className={c.done ? 'on' : ''} />)}
            <small>{done}/{list.length} ด่าน</small>
          </div>
        )}
        {t.status === 'done' && <span className="stamp">CLEAR</span>}
      </button>

      {open && (
        <div className="q-edit">
          <textarea
            placeholder="บันทึกเควสต์ / รายละเอียด"
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
                <button className="x" onClick={() => setList(list.filter((_, j) => j !== i))} aria-label="ลบด่านนี้">×</button>
              </li>
            ))}
          </ul>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (item.trim()) setList([...list, { text: item.trim(), done: false }]);
              setItem('');
            }}
          >
            <input className="full" placeholder="+ เพิ่มด่านย่อย แล้วกด Enter" value={item} onChange={(e) => setItem(e.target.value)} />
          </form>
          <div className="row">
            <select value={t.status} onChange={(e) => onPatch({ status: e.target.value })} aria-label="สถานะ">
              {COLS.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.th}</option>)}
            </select>
            <select value={t.priority} onChange={(e) => onPatch({ priority: e.target.value })} aria-label="ความหายาก">
              {PRI.map((p) => <option key={p} value={p}>{RARITY[p]} · {p}</option>)}
            </select>
            <select value={t.team || ''} onChange={(e) => onPatch({ team: e.target.value })} aria-label="กิลด์">
              <option value="">กิลด์ —</option>
              {teams.map((x) => <option key={x} value={x}>{GUILD[x] || '⭐'} {x}</option>)}
            </select>
            <input type="date" min={DMIN} max={DMAX} value={t.due || ''} onChange={(e) => onPatch({ due: e.target.value })} aria-label="วันส่ง" />
          </div>
          <div className="row between">
            {t.status !== 'done'
              ? <button className="clear-btn" onClick={() => onPatch({ status: 'done' })}>🏆 เคลียร์เควสต์</button>
              : <span />}
            <button className="del" onClick={onDelete}>ทิ้งเควสต์</button>
          </div>
        </div>
      )}
    </article>
  );
}

const CSS = `
.qb{--bg:#0b0d17;--panel:#141827;--panel2:#1a1f33;--line:#272d4a;--ink:#e8ecff;--mute:#8b93b8;
--cyan:#3de0ff;--pink:#ff4fd8;--lime:#7cff6b;--gold:#ffc542;--red:#ff4d5e;--purple:#a974ff;--slate:#7c86a8;
--disp:'Chakra Petch','Noto Sans Thai',system-ui,sans-serif;
position:relative;min-height:100vh;background:var(--bg);color:var(--ink);
font-family:'Noto Sans Thai',system-ui,sans-serif;-webkit-font-smoothing:antialiased;padding:20px 16px 64px;overflow-x:hidden}
html,body{background:#0b0d17}
.qb *{box-sizing:border-box}
.qb h1,.qb h2{margin:0}
.bg{position:fixed;inset:0;pointer-events:none;z-index:0;
background:radial-gradient(900px 500px at 10% -10%,rgba(61,224,255,.14),transparent 60%),
radial-gradient(800px 500px at 100% 0%,rgba(255,79,216,.12),transparent 60%),
linear-gradient(rgba(255,255,255,.025) 1px,transparent 1px) 0 0/100% 32px,
linear-gradient(90deg,rgba(255,255,255,.025) 1px,transparent 1px) 0 0/32px 100%}
.qb>*:not(.bg){position:relative;z-index:1;max-width:1320px;margin-left:auto;margin-right:auto}
.panel{background:linear-gradient(180deg,var(--panel2),var(--panel));border:1px solid var(--line);border-radius:16px;
box-shadow:0 0 0 1px rgba(61,224,255,.04),0 10px 30px rgba(0,0,0,.35)}
.qb input,.qb select,.qb textarea,.qb button{font:inherit;color:var(--ink)}
.qb input,.qb select,.qb textarea{background:#0f1322;border:1px solid var(--line);border-radius:10px;padding:9px 11px;min-width:0;color-scheme:dark}
.qb input:focus,.qb select:focus,.qb textarea:focus{outline:none;border-color:var(--cyan);box-shadow:0 0 0 3px rgba(61,224,255,.18)}
.qb button{cursor:pointer}
.qb :focus-visible{outline:2px solid var(--cyan);outline-offset:2px}

/* HUD */
.hud{display:grid;grid-template-columns:auto 1fr auto;gap:18px;align-items:center;padding:16px 18px;margin-bottom:14px}
.player{display:flex;gap:14px;align-items:center;min-width:280px}
.avatar{position:relative;width:62px;height:62px;border-radius:16px;display:grid;place-items:center;font-size:30px;
background:radial-gradient(circle at 30% 30%,#2b3563,#141827);border:2px solid var(--cyan);box-shadow:0 0 18px rgba(61,224,255,.45)}
.lv{position:absolute;right:-8px;bottom:-8px;background:var(--gold);color:#1a1300;font:700 12px/1 var(--disp);border-radius:8px;padding:4px 6px;box-shadow:0 0 12px rgba(255,197,66,.6)}
.tagline{margin:0;font:600 11px/1 var(--disp);letter-spacing:.14em;color:var(--cyan)}
.pinfo h1{font:700 24px/1.2 var(--disp);margin:4px 0 8px}
.rank{font-size:13px;font-weight:600;color:var(--gold);margin-left:6px;letter-spacing:.02em}
.xp{position:relative;height:16px;min-width:220px;background:#0a0d18;border:1px solid var(--line);border-radius:99px;overflow:hidden}
.xp i{position:absolute;inset:0 auto 0 0;background:linear-gradient(90deg,var(--lime),var(--cyan));box-shadow:0 0 14px rgba(124,255,107,.55);transition:width .6s cubic-bezier(.2,.9,.2,1)}
.xp span{position:absolute;inset:0;display:grid;place-items:center;font:700 11px/1 var(--disp);letter-spacing:.06em;text-shadow:0 1px 2px #000}
.stats{display:grid;grid-template-columns:repeat(4,minmax(96px,1fr));gap:8px}
.stat{background:#0f1322;border:1px solid var(--line);border-radius:12px;padding:8px 10px}
.stat b{display:block;font:700 20px/1.2 var(--disp)}
.stat span{font-size:11px;color:var(--mute)}
.stat.boss{border-color:var(--red);box-shadow:0 0 16px rgba(255,77,94,.35)}.stat.boss b{color:var(--red)}
.stat.soon b{color:var(--gold)}.stat.ok b{color:var(--lime)}
.back{align-self:start;color:var(--cyan);text-decoration:none;font:600 13px var(--disp);white-space:nowrap}

/* คอนโซล */
.console{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px}
.prompt{font:700 20px var(--disp);color:var(--lime);padding:0 4px 0 6px;text-shadow:0 0 10px rgba(124,255,107,.7)}
.console .grow{flex:1 1 260px;font-size:15px}
.duebox{display:flex;align-items:center;gap:6px}
.go{background:linear-gradient(135deg,var(--cyan),var(--pink));color:#0b0d17 !important;border:0;border-radius:10px;padding:9px 16px;
font:700 14px var(--disp);letter-spacing:.04em;box-shadow:0 0 18px rgba(255,79,216,.35);transition:transform .15s}
.go:hover{transform:translateY(-1px) scale(1.02)}
.hint{margin:8px 4px 0;font-size:12px;color:var(--mute)}
.guilds{display:flex;flex-wrap:wrap;gap:6px;margin:14px 0}
.guilds button{border:1px solid var(--line);background:var(--panel);border-radius:99px;padding:5px 12px;font-size:13px;color:var(--mute);transition:all .15s}
.guilds button:hover{border-color:var(--cyan);color:var(--ink)}
.guilds button.on{background:rgba(61,224,255,.14);border-color:var(--cyan);color:var(--cyan);box-shadow:0 0 12px rgba(61,224,255,.25)}
.err{color:var(--red);font-size:14px}

/* คอลัมน์ */
.cols{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;align-items:start}
.col{background:rgba(20,24,39,.72);border:1px solid var(--line);border-radius:16px;padding:10px;min-height:260px;transition:border-color .15s,box-shadow .15s}
.col.over{border-color:var(--cyan);box-shadow:0 0 0 2px rgba(61,224,255,.25),inset 0 0 30px rgba(61,224,255,.08)}
.col h2{display:flex;justify-content:space-between;align-items:center;margin:2px 4px 12px}
.col h2 span{font:700 15px/1.2 var(--disp)}
.col h2 small{display:block;font-size:10px;letter-spacing:.18em;color:var(--mute);font-weight:600}
.col h2 b{font:700 13px var(--disp);background:#0f1322;border:1px solid var(--line);border-radius:8px;padding:2px 9px}
.col.doing h2 span{color:var(--pink)}.col.waiting h2 span{color:var(--gold)}.col.done h2 span{color:var(--lime)}
.empty{color:var(--mute);font-size:12px;text-align:center;margin:28px 6px;border:1px dashed var(--line);border-radius:12px;padding:18px 8px}

/* การ์ดเควสต์ */
.quest{--r:var(--purple);position:relative;margin-bottom:10px;border-radius:14px;background:linear-gradient(180deg,#1b2037,#151a2c);
border:1px solid color-mix(in srgb,var(--r) 45%,var(--line));box-shadow:0 0 0 1px rgba(0,0,0,.2),0 0 14px color-mix(in srgb,var(--r) 18%,transparent);
overflow:hidden;transition:transform .15s,box-shadow .15s}
.quest:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,0,0,.4),0 0 22px color-mix(in srgb,var(--r) 35%,transparent)}
.quest.leg{--r:var(--gold)}.quest.epic{--r:var(--purple)}.quest.com{--r:var(--slate)}
.quest.leg::before{content:'';position:absolute;inset:0;pointer-events:none;
background:linear-gradient(115deg,transparent 30%,rgba(255,197,66,.12) 45%,transparent 60%);background-size:250% 100%;animation:shine 4s linear infinite}
.quest.is-boss{--r:var(--red);animation:pulse 1.8s ease-in-out infinite}
.quest.is-done{opacity:.72;filter:saturate(.7)}
.q-head{display:block;width:100%;text-align:left;background:none;border:0;padding:11px 12px 12px;position:relative}
.q-top{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.rarity{font:700 10px/1 var(--disp);letter-spacing:.14em;color:#0b0d17;background:var(--r);border-radius:5px;padding:4px 6px}
.guild{font-size:11px;color:var(--ink);background:#0f1322;border:1px solid var(--line);border-radius:6px;padding:2px 7px}
.qid{margin-left:auto;font:600 11px var(--disp);color:var(--mute)}
.q-title{display:block;font-size:15px;line-height:1.45;margin:8px 0 8px}
.q-foot{display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap}
.timer{font:600 12px var(--disp);color:var(--mute)}
.timer.soon{color:var(--gold)}.timer.boss{color:var(--red);text-shadow:0 0 10px rgba(255,77,94,.6)}.timer.none{font-style:italic;opacity:.7}.timer.ok{color:var(--lime)}
.reward{font:700 11px var(--disp);color:var(--lime);background:rgba(124,255,107,.1);border:1px solid rgba(124,255,107,.35);border-radius:6px;padding:2px 6px}
.stages{display:flex;gap:3px;align-items:center;margin-top:10px}
.stages i{flex:1;height:7px;border-radius:2px;background:#0a0d18;border:1px solid var(--line)}
.stages i.on{background:var(--lime);border-color:var(--lime);box-shadow:0 0 8px rgba(124,255,107,.6)}
.stages small{margin-left:6px;font:600 11px var(--disp);color:var(--mute);white-space:nowrap}
.stamp{position:absolute;right:10px;top:34px;transform:rotate(-12deg);font:700 16px var(--disp);letter-spacing:.2em;color:var(--lime);
border:2px solid var(--lime);border-radius:6px;padding:2px 8px;opacity:.85;text-shadow:0 0 10px rgba(124,255,107,.6)}
.q-edit{display:grid;gap:9px;padding:4px 12px 12px;border-top:1px dashed var(--line)}
.q-edit textarea{min-height:66px;resize:vertical;margin-top:8px}
.check{list-style:none;margin:0;padding:0;display:grid;gap:6px}
.check li{display:flex;justify-content:space-between;gap:6px;font-size:13px}
.check label{display:flex;gap:8px;align-items:flex-start;line-height:1.45;cursor:pointer}
.check input{appearance:none;width:16px;height:16px;flex:none;margin-top:2px;padding:0;border:2px solid var(--lime);border-radius:3px;background:transparent;display:grid;place-items:center;cursor:pointer}
.check input:checked{background:var(--lime);box-shadow:0 0 8px rgba(124,255,107,.7)}
.check input:checked::after{content:'✓';color:#0b0d17;font-size:11px;font-weight:900;line-height:1}
.struck{text-decoration:line-through;color:var(--mute)}
.x{background:none;border:0;color:var(--mute);font-size:17px;line-height:1}
.full{width:100%}
.row{display:flex;flex-wrap:wrap;gap:6px}.row input,.row select{flex:1 1 110px;font-size:13px;padding:7px 9px}
.between{justify-content:space-between;align-items:center}
.clear-btn{background:rgba(124,255,107,.12);border:1px solid var(--lime);color:var(--lime) !important;border-radius:9px;padding:6px 12px;font:700 13px var(--disp)}
.clear-btn:hover{background:rgba(124,255,107,.22);box-shadow:0 0 14px rgba(124,255,107,.35)}
.del{background:none;border:0;color:var(--red) !important;font-size:12px;padding:0}

/* toast */
.toast{position:fixed;left:50%;top:22px;transform:translateX(-50%);z-index:50;min-width:240px;max-width:min(92vw,420px);text-align:center;
background:linear-gradient(180deg,#1f2542,#141827);border:2px solid var(--cyan);border-radius:16px;padding:12px 18px;
box-shadow:0 0 30px rgba(61,224,255,.45),0 12px 30px rgba(0,0,0,.5);animation:pop .45s cubic-bezier(.2,1.4,.3,1)}
.toast b{display:block;font:700 22px/1.2 var(--disp);letter-spacing:.06em;color:var(--cyan)}
.toast span{display:block;font-size:13px;color:var(--mute);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.toast.clear{border-color:var(--lime);box-shadow:0 0 34px rgba(124,255,107,.5)}.toast.clear b{color:var(--lime)}
.toast.lvl{border-color:var(--gold);box-shadow:0 0 40px rgba(255,197,66,.6)}.toast.lvl b{color:var(--gold)}
.toast.new b{color:var(--pink)}.toast.new{border-color:var(--pink)}

@keyframes shine{from{background-position:150% 0}to{background-position:-100% 0}}
@keyframes pulse{0%,100%{box-shadow:0 0 12px rgba(255,77,94,.25)}50%{box-shadow:0 0 26px rgba(255,77,94,.6)}}
@keyframes pop{from{opacity:0;transform:translate(-50%,-14px) scale(.85)}to{opacity:1;transform:translate(-50%,0) scale(1)}}
@media (prefers-reduced-motion:reduce){.qb *{animation:none !important;transition:none !important}}
@media (max-width:1080px){.hud{grid-template-columns:1fr}.back{justify-self:start}.cols{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:600px){.stats{grid-template-columns:repeat(2,1fr)}.cols{grid-template-columns:1fr}.col{min-height:0}.player{min-width:0}.xp{min-width:0}}
`;
