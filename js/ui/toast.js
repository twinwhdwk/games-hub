/**
 * @file js/ui/toast.js  v2
 * 토스트 알림. EventBus 를 구독해 자동 표시.
 * - 'level:up'      → 레벨업 알림
 * - 'item:unlocked' → 아이템 해금 알림
 * - 'error:module'  → 에러 알림
 */
'use strict';
(function(global) {

let _wrap = null;
const _queue = [];
let _showing = false;

function _ensureWrap() {
  if (_wrap && document.body?.contains(_wrap)) return _wrap;
  _wrap = document.createElement('div');
  Object.assign(_wrap.style, {
    position:'fixed', bottom:'24px', left:'50%', transform:'translateX(-50%)',
    zIndex:'9999', display:'flex', flexDirection:'column-reverse', gap:'8px',
    alignItems:'center', pointerEvents:'none', width:'min(92vw,380px)',
  });
  document.body.appendChild(_wrap);
  return _wrap;
}

function _render(text, opts) {
  if (typeof document === 'undefined') return;
  const wrap = _ensureWrap();
  const el = document.createElement('div');
  const colors = {
    success: { bg:'#16a34a', border:'rgba(74,222,128,.3)' },
    error:   { bg:'#dc2626', border:'rgba(248,113,113,.3)' },
    info:    { bg:'rgba(15,23,42,.95)', border:'rgba(255,255,255,.12)' },
    warn:    { bg:'#d97706', border:'rgba(251,191,36,.3)' },
  };
  const c = colors[opts.type||'info'];
  Object.assign(el.style, {
    background: c.bg, border:`1px solid ${c.border}`,
    color:'#fff', padding:'10px 20px', borderRadius:'100px',
    fontSize:'0.84rem', fontWeight:'700', fontFamily:'inherit',
    boxShadow:'0 4px 24px rgba(0,0,0,.55)',
    opacity:'0', transform:'translateY(14px) scale(0.95)',
    transition:'opacity .2s, transform .25s cubic-bezier(.34,1.56,.64,1)',
    textAlign:'center', maxWidth:'340px', lineHeight:'1.4', whiteSpace:'nowrap',
  });
  el.textContent = text;
  wrap.prepend(el);
  requestAnimationFrame(() => { el.style.opacity='1'; el.style.transform='translateY(0) scale(1)'; });
  setTimeout(() => {
    el.style.opacity='0'; el.style.transform='translateY(-8px) scale(0.95)';
    setTimeout(() => el.remove(), 250);
  }, opts.duration || 3000);
}

const Toast = {
  show(text, opts = {}) {
    _render(text, opts);
  },

  announceExp(result) {
    if (!result) return;
    const msgs = [];
    if (result.leveledUp) msgs.push(`🎉 레벨업! Lv.${result.newLevel}`);
    if (result.newItems?.length) {
      result.newItems.slice(0,2).forEach(it => msgs.push(`🎁 ${it.name} 해금!`));
      if (result.newItems.length > 2) msgs.push(`외 ${result.newItems.length-2}개 더!`);
    }
    msgs.forEach((m,i) => setTimeout(() => Toast.show(m, { type:'success' }), i*600));
  },
};

// EventBus 자동 구독
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    Bus?.on?.('level:up', ({ newLevel, newItems }) => {
      Toast.show(`🎉 레벨업! Lv.${newLevel}`, { type:'success', duration:3500 });
      newItems?.slice(0,2).forEach((it,i) => setTimeout(()=>Toast.show(`🎁 ${it.name} 해금!`,{type:'success'}),(i+1)*700));
    });
    Bus?.on?.('item:unlocked', ({ item }) => {
      // level:up 이벤트와 중복 방지 — streak/achievement 해금만 여기서 처리
      if (item.unlock?.type==='streak' || item.unlock?.type==='achievement') {
        Toast.show(`🎁 ${item.name} 해금!`, { type:'success' });
      }
    });
    Bus?.on?.('error:module', ({ module, error }) => {
      console.warn(`[${module}] ${error}`);
    });
    Bus?.on?.('streak:updated', ({ streak, isNew }) => {
      if (isNew && streak > 1 && streak % 7 === 0) {
        Toast.show(`🔥 ${streak}일 연속 접속! 보상 해금!`, { type:'success', duration:4000 });
      }
    });
  });
}

if (global.Container) Container.register('Toast', Toast);
global.Toast = Toast;
})(window);
