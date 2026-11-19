function esc(s){return s.replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]))}
function col(c){return "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ".includes(c)&&"kKrRgGbBcCmMwWyYoO".includes(c)?`var(--${c})`:null}
function shade(name,text){
  if(text.includes("\u0001")) return text;
  const sh=SHADERS[name.trim().toLowerCase()];
  if(!sh) return `<span style="color:${col(name.trim())||"inherit"}">${esc(text)}</span>`;
  if(sh.t==="s") return `<span style="color:${col(sh.c)}">${esc(text)}</span>`;
  const cs=sh.c; let o="",j=0;
  for(const ch of text){
    const c = sh.t==="a" ? cs[Math.min(cs.length-1,Math.floor(j*cs.length/Math.max(1,[...text].length)))] : cs[j%cs.length];
    o+=`<span style="color:${col(c)||"inherit"}">${esc(ch)}</span>`; j++;
  }
  return o;
}
const CP437=" ☺☻♥♦♣♠•◘○◙♂♀♪♫☼►◄↕‼¶§▬↨↑↓→←∟↔▲▼";
function qud(s){
  if(!s) return "";
  s=s.replace(/[\x01-\x1f]/g,c=>c==="\n"?" ":CP437[c.charCodeAt(0)]).replace(/\u0001/g,"☺");
  // resolve innermost {{x|...}} first
  let guard=0;
  while(/\{\{[^{}|]*\|[^{}]*\}\}/.test(s) && guard++<20){
    s=s.replace(/\{\{([^{}|]*)\|([^{}]*)\}\}/g,(m,n,t)=>t.includes("\u0001")?t:"\u0001"+btoa(unescape(encodeURIComponent(shade(n,t))))+"\u0002");
  }
  let out="",open=false;
  const parts=s.split(/(\u0001[^\u0002]*\u0002|&[A-Za-z&]|\^[A-Za-z^])/);
  for(const p of parts){
    if(!p) continue;
    if(p[0]==="\u0001"){out+=decodeURIComponent(escape(atob(p.slice(1,-1))));continue}
    if(p==="&&"){out+="&amp;";continue}
    if(p==="^^"){out+="^";continue}
    if(p[0]==="&"&&p.length===2){if(open)out+="</span>";const c=col(p[1]);out+=`<span style="color:${c||"inherit"}">`;open=true;continue}
    if(p[0]==="^"&&p.length===2){continue}
    out+=esc(p);
  }
  if(open) out+="</span>";
  return out;
}
const plain = s => (s||"").replace(/\{\{[^|}]*\|/g,"").replace(/\}\}/g,"").replace(/[&^][A-Za-z]/g,"");
// CP437 128-255, for map glyphs (names keep Latin-1 as-is).
const CP437HI="ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";
function glyph(ch){const n=ch.charCodeAt(0);if(n<32)return CP437[n]||" ";if(n>=128&&n<256)return CP437HI[n-128];return ch}
