"use strict";
const API = "http://127.0.0.1:8765";
let state = null, map = null, tab = "act", lastJson = "";
const $ = id => document.getElementById(id);

/* ---------- storage (per device; optional) ---------- */
function load(k, d){ try{ const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; }catch(e){ return d; } }
function save(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
let pins = load("qudlink.pins", []);          // plain item names
let hpWarn = load("qudlink.hpwarn", 0.33);

/* ---------- networking ---------- */
async function get(path){
  if (window.Native) return JSON.parse(Native.get(path));
  const r = await fetch(API + path, {cache:"no-store", headers:{"X-QudLink":"1"}});
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}
function buzz(ms){ try{ if (!window.Haptics) return; if (ms > 20) Haptics.buzz(ms); else Haptics.tick(); }catch(e){} }
function send(path){ buzz(12); get(path).then(() => setTimeout(poll, 150)).catch(() => {}); }
const cmd = c => send("/do?cmd=" + encodeURIComponent(c));

async function poll(){
  try{
    const txt = await (await fetch(API + "/state", {cache:"no-store"})).text();
    $("conn").classList.add("hide");
    if (txt === lastJson) return;
    lastJson = txt;
    const s = JSON.parse(txt);
    if (!s.player){ $("connmsg").textContent = "Connected — load a save."; $("conn").classList.remove("hide"); return; }
    alerts(state, s);
    state = s; render();
  }catch(e){
    $("connmsg").textContent = "Waiting for Caves of Qud…";
    $("conn").classList.remove("hide");
  }
}
async function pollMap(){
  if (tab !== "map" || !state) return;
  try{ const m = await get("/map"); if (!m.error){ map = m; drawMap(); } }catch(e){}
}
setInterval(poll, 600); poll();


/* ---------- danger alerts ---------- */
function flash(){ const f = $("flash"); f.classList.add("on"); setTimeout(() => f.classList.remove("on"), 500); }
function alerts(prev, s){
  if (!prev) return;
  const pct = s.player.hp / Math.max(1, s.player.maxhp), was = prev.player.hp / Math.max(1, prev.player.maxhp);
  if (pct < hpWarn && was >= hpWarn){ buzz(300); flash(); }
  const before = new Set((prev.nearby||[]).filter(n => n.hostile).map(n => n.id));
  if ((s.nearby||[]).some(n => n.hostile && !before.has(n.id))){ buzz(120); }
}

/* ---------- helpers ---------- */
const tileImg = (t, c="tile") => t ? `<img class="${c}" src="${API + t}" onerror="this.style.visibility='hidden'">` : `<span class="${c}"></span>`;
const pct = (a, b) => Math.max(0, Math.min(100, 100 * a / Math.max(1, b)));
const hpColor = p => p > 66 ? "var(--G)" : p > 33 ? "var(--W)" : "var(--R)";

/* ---------- header ---------- */
function header(){
  const p = state.player;
  $("pname").innerHTML = qud(p.name);
  const pt = $("ptile"); if (pt.dataset.t !== p.tile){ pt.dataset.t = p.tile; pt.innerHTML = p.tile ? tileImg(p.tile, "ptile") : ""; }
  $("plv").innerHTML = `<span style="color:var(--c)">LVL</span> <span style="color:var(--Y)">${p.level}</span>`;
  $("pzone").innerHTML = qud(p.zone || "");
  $("pturn").textContent = "T" + state.turn;
  const hp = pct(p.hp, p.maxhp);
  $("hpfill").style.width = hp + "%"; $("hpfill").style.background = hpColor(hp);
  $("hptext").textContent = `HP ${p.hp} / ${p.maxhp}`;
  $("xpfill").style.width = (p.xpNext ? pct(p.xp, p.xpNext) : 0) + "%";
  const wt = p.maxweight ? `<span style="color:${p.weight > p.maxweight ? "var(--R)" : "var(--c)"}">${p.weight}/${p.maxweight}#</span>` : "";
  $("surv").innerHTML = [p.food ? qud(p.food) : "", p.water ? qud(p.water) : "",
    `<span style="color:var(--B)">${p.drams}</span><span class="dim"> drams</span>`, wt].filter(Boolean).join('<span class="dim">·</span>');
}

/* ---------- ACT ---------- */
const BASIC = [
  ["Wait","CmdWait"],["Rest","CmdWaitUntilHealed"],["Get","CmdGet"],
  ["Look","CmdLook"],["Fire","CmdFire"],["Reload","CmdReload"],
  ["Throw","CmdThrow"],["Explore","CmdExplore"],["Use","CmdUse"],
  ["Char","CmdCharacter"],["Journal","CmdQuests"],["Esc","CmdEscape"],
];
function findPinned(name){
  return [...state.inventory, ...state.equipment].find(i => plain(i.name).replace(/ x\d+\s*$/, "").trim() === name);
}
function renderAct(){
  let h = "<h3>Quick slots</h3><div class='qs'>";
  for (let i = 0; i < 4; i++){
    const name = pins[i];
    if (!name){ h += `<div class="btn empty">empty<small>pin from Items</small></div>`; continue; }
    const it = findPinned(name);
    h += it ? `<button class="btn" data-quick="${it.id}">${tileImg(it.tile)}<span>${qud(it.name)}</span></button>`
            : `<button class="btn cd" data-unpin="${esc(name)}">${esc(name)}<small>none left</small></button>`;
  }
  h += "</div><h3>Abilities</h3><div class='grid'>";
  if (!state.abilities.length) h += "<div class='dim'>No abilities.</div>";
  for (const a of state.abilities){
    const cls = ["btn", a.cooldown > 0 || !a.enabled ? "cd" : "", a.toggleable && a.on ? "toggled" : ""].join(" ");
    h += `<button class="${cls}" data-cmd="${esc(a.cmd)}">${qud(a.name)}${a.cooldown > 0 ? `<small>${a.cooldown} rnd</small>` : a.toggleable ? `<small>${a.on ? "ON" : "off"}</small>` : ""}</button>`;
  }
  h += "</div><h3>Commands</h3><div class='grid'>";
  for (const [l, c] of BASIC) h += `<button class="btn" data-cmd="${c}">${l}</button>`;
  return h + "</div>";
}

/* ---------- ITEMS ---------- */
function itemRow(it){
  const cnt = it.count > 1 && !/ x\d+\s*$/.test(plain(it.name)) ? ` <span class="dim">x${it.count}</span>` : "";
  return `<div class="item" data-id="${it.id}">${tileImg(it.tile)}<span class="n">${qud(it.name)}${cnt}</span><span class="s">${it.slot ? esc(it.slot) : it.weight + "#"}</span></div>`;
}
const ARROW = {here:"here", N:"↑", NE:"↗", E:"→", SE:"↘", S:"↓", SW:"↙", W:"←", NW:"↖"};
function groundRow(it){
  const cnt = it.count > 1 && !/ x\d+\s*$/.test(plain(it.name)) ? ` <span class="dim">x${it.count}</span>` : "";
  return `<div class="item" data-id="${it.id}">${tileImg(it.tile)}<span class="n">${qud(it.name)}${cnt}</span><span class="s">${ARROW[it.dir] || esc(it.dir || "")}</span></div>`;
}
function renderItems(){
  let h = "";
  const ground = (state.ground || []).slice().sort((a, b) => (a.dir !== "here") - (b.dir !== "here"));
  if (ground.length){
    h += `<div class="row"><h3 style="flex:1">Ground</h3>${ground.some(g => g.dir === "here") ? '<button class="btn" data-cmd="CmdGet" style="min-height:0;padding:5px 12px">Take all</button>' : ""}</div>`;
    h += ground.map(groundRow).join("");
  }
  h += "<h3>Equipped</h3>" + (state.equipment.map(itemRow).join("") || "<div class='dim'>Nothing.</div>");
  const groups = {};
  for (const it of state.inventory) (groups[it.category || "Misc"] ??= []).push(it);
  for (const g of Object.keys(groups).sort()) h += `<h3>${esc(g)}</h3>` + groups[g].map(itemRow).join("");
  if (!state.inventory.length) h += "<h3>Inventory</h3><div class='dim'>Empty.</div>";
  return h + "<div class='hint'>Tap: actions · Hold: description</div>";
}

/* ---------- MAP ---------- */
function renderMap(){
  return `<h3>Nearby</h3><div id="nearby">${renderNearby()}</div><div class="hint">Tap a creature for details</div>
  <h3>Move</h3><div class="dpad">
    <button class="btn" data-cmd="CmdMoveNW">↖</button><button class="btn" data-cmd="CmdMoveN">↑</button><button class="btn" data-cmd="CmdMoveNE">↗</button>
    <button class="btn" data-cmd="CmdMoveW">←</button><button class="btn" data-cmd="CmdWait">·</button><button class="btn" data-cmd="CmdMoveE">→</button>
    <button class="btn" data-cmd="CmdMoveSW">↙</button><button class="btn" data-cmd="CmdMoveS">↓</button><button class="btn" data-cmd="CmdMoveSE">↘</button>
  </div>`;
}
function renderNearby(){
  const near = (state.nearby || []).slice().sort((a, b) => (b.hostile - a.hostile) || a.dist - b.dist);
  return near.map(n => {
    const p = pct(n.hp, n.maxhp);
    return `<div class="item ${n.hostile ? "hostile" : ""}" data-near="${n.id}">${tileImg(n.tile)}<span class="n">${qud(n.name)}
      <div class="mini"><i style="width:${p}%;background:${hpColor(p)}"></i></div></span>
      <span class="s">${n.hostile ? '<span style="color:var(--R)">hostile</span><br>' : ""}${n.dist} away</span></div>`;
  }).join("") || "<div class='dim'>Nobody in sight.</div>";
}
const CW = 8, CH = 12;
function drawMap(){
  const cv = $("map"); if (!cv || !map) return;
  cv.width = map.w * CW; cv.height = map.h * CH;
  const g = cv.getContext("2d"), css = getComputedStyle(document.documentElement);
  const colorOf = {}; for (const c of "kKrRgGbBcCmMwWyYoO") colorOf[c] = css.getPropertyValue("--" + c).trim();
  g.fillStyle = "#000"; g.fillRect(0, 0, cv.width, cv.height);
  g.font = `${CH - 1}px monospace`; g.textAlign = "center"; g.textBaseline = "middle";
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++){
    const i = y * map.w + x, ch = map.glyphs[i];
    if (ch === " ") continue;
    g.fillStyle = colorOf[map.colors[i]] || colorOf.y;
    g.fillText(glyph(ch), x * CW + CW / 2, y * CH + CH / 2 + 1);
  }
  for (const n of state.nearby || []) if (n.hostile){
    g.strokeStyle = colorOf.R; g.lineWidth = 1; g.strokeRect(n.x * CW + .5, n.y * CH + .5, CW - 1, CH - 1);
  }
  g.fillStyle = colorOf.Y; g.font = `bold ${CH}px monospace`;
  g.fillText("@", map.px * CW + CW / 2, map.py * CH + CH / 2 + 1);
}
function mapCell(e){
  const cv = $("map"), r = cv.getBoundingClientRect();
  return { x: Math.floor((e.clientX - r.left) / r.width * map.w), y: Math.floor((e.clientY - r.top) / r.height * map.h) };
}

/* ---------- CHAR ---------- */
function renderStatus(){
  const S = state.stats, p = state.player;
  const keys = [["Strength","STR"],["Agility","AGI"],["Toughness","TOU"],["Intelligence","INT"],["Willpower","WIL"],["Ego","EGO"],
    ["AV","AV"],["DV","DV"],["MA","MA"],["Speed","QN"],["MoveSpeed","MS"],["XP","XP"]];
  let h = "<h3>Attributes</h3><div class='stats'>";
  for (const [k, l] of keys) if (S[k] !== undefined) h += `<div class="stat"><b>${k === "MoveSpeed" ? 200 - S[k] : S[k]}</b><span>${l}</span></div>`;
  h += `</div><div class="hint">XP ${p.xp} / ${p.xpNext} to level ${p.level + 1}</div><h3>Resistances</h3><div class='stats'>`;
  for (const [k, l, c] of [["HeatResistance","HEAT","R"],["ColdResistance","COLD","C"],["ElectricResistance","ELEC","W"],["AcidResistance","ACID","G"]])
    if (S[k] !== undefined) h += `<div class="stat"><b style="color:var(--${c})">${S[k]}</b><span>${l}</span></div>`;
  h += "</div>";
  if ((state.mutations || []).length)
    h += "<h3>Mutations</h3><div class='tags'>" + state.mutations.map(m => `<span>${qud(m.name)}${m.level ? ` <b style="color:var(--Y)">${m.level}</b>` : ""}</span>`).join("") + "</div>";
  if ((state.skills || []).length)
    h += "<h3>Skills</h3><div class='tags'>" + state.skills.map(s => `<span>${qud(s)}</span>`).join("") + "</div>";
  h += "<h3>Effects</h3>" + (state.effects.map(e => `<div class="eff">${qud(e.name)}${e.details ? `<div>${esc(plain(e.details))}</div>` : ""}</div>`).join("") || "<div class='dim'>None.</div>");
  h += `<h3>Alerts</h3><div class="grid">${[0, .25, .33, .5].map(v => `<button class="btn ${hpWarn === v ? "toggled" : ""}" data-hpwarn="${v}">${v ? "HP < " + Math.round(v * 100) + "%" : "Off"}</button>`).join("")}</div>`;
  return h;
}

/* ---------- QUESTS ---------- */
function renderQuests(){
  let h = "<h3>Active quests</h3>";
  h += (state.quests || []).map(q => `<div class="quest"><b>${qud(q.name)}</b>${q.giver ? `<div class="dim" style="font-size:12px">from ${qud(q.giver)}</div>` : ""}
    ${q.steps.map(s => `<div class="step ${s.done ? "done" : ""}">${s.done ? "☑" : s.failed ? "☒" : "☐"} ${qud(s.name)}${s.optional ? ' <span class="dim">(optional)</span>' : ""}${!s.done && s.text ? `<span class="t">${qud(s.text)}</span>` : ""}</div>`).join("")}</div>`).join("")
    || "<div class='dim'>No active quests.</div>";
  if ((state.notes || []).length) h += "<h3>Journal notes</h3>" + state.notes.slice(-30).reverse().map(n => `<div class="eff">${qud(n)}</div>`).join("");
  return h;
}

/* ---------- LOG ---------- */
function renderLog(){
  return "<div class='log'>" + state.log.slice().reverse().map((m, i) => `<p data-log="${state.log.length - 1 - i}">${qud(m)}</p>`).join("") + "</div><div class='hint'>Tap a line to look at who's in it</div>";
}

/* ---------- render ---------- */
const VIEWS = {act: renderAct, items: renderItems, map: renderMap, status: renderStatus, quests: renderQuests, log: renderLog};
function render(){
  if (!state) return;
  header();
  const m = $("main"), keep = m.scrollTop;
  m.innerHTML = VIEWS[tab]();
  m.scrollTop = keep;
}

/* ---------- sheet ---------- */
const sheet = $("sheet"), box = $("sheetbox");
function openSheet(html, onClick){ box.innerHTML = html; box.onclick = onClick; sheet.classList.add("open"); }
const closeSheet = () => sheet.classList.remove("open");
sheet.onclick = e => { if (e.target === sheet) closeSheet(); };

async function openItem(id){
  openSheet("<div class='title dim'>…</div>", null);
  try{
    const r = await get("/actions?id=" + id);
    if (r.error){ box.innerHTML = `<div class='title'>${r.error === "busy" ? "Game busy — close any menu in Qud and try again." : esc(r.error)}</div>`; return; }
    const pname = plain(r.name).replace(/ x\d+\s*$/, "").trim(), pinned = pins.includes(pname);
    box.innerHTML = `<div class="title">${tileImg(r.tile, "ptile")}<br>${qud(r.name)}</div>` +
      r.actions.map(a => `<button class="btn act" ${a.usable ? "" : "disabled"} data-act="${esc(a.cmd)}">${qud(a.label)}</button>`).join("") +
      `<button class="btn act" data-describe style="color:var(--c)">describe</button>` +
      `<button class="btn act" data-pin style="color:var(--W)">${pinned ? "unpin from quick slots" : "pin to quick slots"}</button>` +
      `<button class="btn act" data-close style="color:var(--K)">cancel</button>`;
    box.onclick = ev => {
      const b = ev.target.closest("button"); if (!b) return;
      if (b.dataset.describe !== undefined){ describe(id); return; }
      if (b.dataset.pin !== undefined){
        pins = pinned ? pins.filter(p => p !== pname) : [...pins.filter(p => p !== pname), pname].slice(-4);
        save("qudlink.pins", pins); closeSheet(); render(); return;
      }
      closeSheet();
      if (b.dataset.act) send(`/do?id=${id}&action=${encodeURIComponent(b.dataset.act)}`);
    };
  }catch(e){ box.innerHTML = `<div class='title'>Can't reach QudLink mod (${esc(String(e.message || e))}).</div>`; }
}
async function describe(id, extra = ""){
  openSheet("<div class='title dim'>…</div>", null);
  try{
    const r = await get("/describe?id=" + id);
    if (r.error){ box.innerHTML = `<div class='title'>${esc(r.error)}</div>`; return; }
    openSheet(`<div class="title">${tileImg(r.tile, "ptile")}<br>${qud(r.name)}</div><div class="desc">${qud(r.text)}</div>${extra}
      <button class="btn act" data-close style="color:var(--K)">close</button>`, ev => {
        const b = ev.target.closest("button"); if (!b) return;
        if (b.dataset.look) send("/look?" + b.dataset.look);
        if (b.dataset.go) send("/travel?" + b.dataset.go);
        if (b.dataset.target) send("/target?id=" + b.dataset.target);
        if (b.dataset.cmd) cmd(b.dataset.cmd);
        closeSheet();
      });
  }catch(e){ box.innerHTML = `<div class='title'>Can't reach QudLink mod.</div>`; }
}
function openCreature(id){
  const n = (state.nearby || []).find(c => String(c.id) === String(id));
  const go = n ? `<button class="btn act" data-go="x=${n.x}&y=${n.y}" style="color:var(--G)">go to</button>` : "";
  describe(id, go + `<button class="btn act" data-target="${id}" style="color:var(--W)">set as target</button>`);
}

/* ---------- input ---------- */
document.querySelector("nav").onclick = e => {
  const b = e.target.closest("button"); if (!b) return;
  document.querySelectorAll("nav button").forEach(x => x.classList.toggle("on", x === b));
  tab = b.dataset.tab; $("main").scrollTop = 0; $("main").innerHTML = ""; render();
};

// tap vs. long-press on the main panel
let pressTimer = null, pressed = false, pressTarget = null, pressPos = null;
const main = $("main");
main.addEventListener("pointerdown", e => {
  pressed = false; pressTarget = e.target; pressPos = {clientX: e.clientX, clientY: e.clientY};
  clearTimeout(pressTimer);
  pressTimer = setTimeout(() => { pressed = true; longPress(pressTarget, pressPos); }, 450);
});
["pointerup", "pointercancel", "pointerleave"].forEach(ev => main.addEventListener(ev, () => clearTimeout(pressTimer)));
main.addEventListener("scroll", () => clearTimeout(pressTimer), {passive: true});

function longPress(t, pos){
  buzz(25);
  const it = t.closest("[data-id]"); if (it){ describe(it.dataset.id); return; }
  const q = t.closest("[data-quick]"); if (q){ describe(q.dataset.quick); return; }
  if (t.id === "map" && map){ const c = mapCell(pos); send(`/look?x=${c.x}&y=${c.y}`); }
}
main.addEventListener("click", e => {
  if (pressed){ pressed = false; return; }
  const t = e.target;
  const c = t.closest("[data-cmd]"); if (c){ cmd(c.dataset.cmd); return; }
  const q = t.closest("[data-quick]"); if (q){ send(`/do?id=${q.dataset.quick}&action=__default`); return; }
  const u = t.closest("[data-unpin]"); if (u){ pins = pins.filter(p => p !== u.dataset.unpin); save("qudlink.pins", pins); render(); return; }
  const w = t.closest("[data-hpwarn]"); if (w){ hpWarn = +w.dataset.hpwarn; save("qudlink.hpwarn", hpWarn); render(); return; }
  const it = t.closest("[data-id]"); if (it){ openItem(it.dataset.id); return; }
  const n = t.closest("[data-near]"); if (n){ openCreature(n.dataset.near); return; }
  if (t.id === "map" && map){ const cell = mapCell(e); send(`/travel?x=${cell.x}&y=${cell.y}`); return; }
  const l = t.closest("[data-log]"); if (l){
    const line = plain(state.log[+l.dataset.log]).toLowerCase();
    const who = (state.nearby || []).find(n => line.includes(plain(n.name).toLowerCase()));
    if (who) openCreature(who.id);
  }
});

// ?tab=map etc. selects the starting tab (handy for previews)
(() => { const t = new URLSearchParams(location.search).get("tab"); const b = t && document.querySelector(`nav button[data-tab="${t}"]`); if (b) b.click(); })();
