/**
 * @file js/ui/toast.js
 * 토스트 알림 + EXP 결과 발표. DOM 의존, 비즈니스 로직 없음.
 */
'use strict';
(function(global) {

let _wrap = null;

function _ensureWrap() {
  if (_wrap && document.body.contains(_wrap)) return _wrap;
  _wrap = document.createElement('div');
  _wrap.id = 'lh-toast-wrap';
  Object.assign(_wrap.style, {
    position:'fixed', bottom:'24px', left:'50%', transform:'translateX(-50%)',
    zIndex:'9999', display:'flex', flexDirection:'column', gap:'8px',
    alignItems:'center', pointerEvents:'none', width:'min(90vw,360px)',
  });
  document.body.appendChild(_wrap);
  return _wrap;
}

const Toast = {
  show(text, opts = {}) {
    if (typeof document === 'undefined') return;
    const wrap = _ensureWrap();
    const t = document.createElement('div');
    const bg = opts.type === 'error' ? '#ef4444' : opts.type === 'success' ? '#22c55e' : '#1e2a4a';
    Object.assign(t.style, {
      background: bg, color:'#fff', padding:'10px 20px', borderRadius:'100px',
      fontSize:'0.85rem', fontWeight:'700', fontFamily:'inherit',
      boxShadow:'0 4px 20px rgba(0,0,0,.5)', border:'1px solid rgba(255,255,255,.12)',
      opacity:'0', transform:'translateY(12px)', transition:'opacity .2s, transform .2s',
      textAlign:'center', maxWidth:'320px', lineHeight:'1.4',
    });
    t.textContent = text;
    wrap.appendChild(t);
    requestAnimationFrame(() => { t.style.opacity='1'; t.style.transform='translateY(0)'; });
    const dur = opts.duration || 3000;
    setTimeout(() => {
      t.style.opacity='0'; t.style.transform='translateY(-8px)';
      setTimeout(() => t.remove(), 250);
    }, dur);
  },

  /** addExp 결과 발표 */
  announceExp(result) {
    if (!result) return;
    const msgs = [];
    if (result.leveledUp) {
      msgs.push(`🎉 레벨업! Lv.${result.newLevel}`);
    }
    if (result.newItems?.length) {
      result.newItems.slice(0, 2).forEach(it => msgs.push(`🎁 ${it.name} 해금!`));
      if (result.newItems.length > 2) msgs.push(`외 ${result.newItems.length - 2}개 더!`);
    }
    msgs.forEach((msg, i) => setTimeout(() => Toast.show(msg, { type:'success' }), i * 600));
  },
};

global.Toast = Toast;
})(window);
