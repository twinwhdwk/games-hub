/**
 * @file js/ui/modal.js  v2
 * 로그인 모달, 뒤로가기 링크.
 * User 직접 참조 → Container.get('User') 로 변경.
 */
'use strict';
(function(global) {

const Modal = {
  requireLogin(onReady) {
    const U = global.User || Container?.get?.('User');
    if (U?.current()) { onReady(); return; }
    Modal._show(onReady);
  },

  _show(onReady) {
    if (document.getElementById('lh-login-modal')) return;
    const overlay = document.createElement('div');
    overlay.id = 'lh-login-modal';
    Object.assign(overlay.style, {
      position:'fixed', inset:'0',
      background:'rgba(4,7,18,0.94)', backdropFilter:'blur(10px)',
      display:'flex', alignItems:'center', justifyContent:'center', zIndex:'9997', fontFamily:'inherit',
    });

    const box = document.createElement('div');
    Object.assign(box.style, {
      background:'linear-gradient(145deg,#0d1b3a 0%,#111e40 100%)',
      border:'1.5px solid rgba(99,102,241,.25)', borderRadius:'22px',
      padding:'36px 30px', maxWidth:'400px', width:'92%', textAlign:'center',
      boxShadow:'0 24px 80px rgba(0,0,0,.75), 0 0 0 1px rgba(255,255,255,.04)',
    });

    const U = global.User || Container?.get?.('User');
    const users = U?.list() || [];
    box.innerHTML = `
      <div style="font-size:3rem;margin-bottom:14px;">🗺️</div>
      <h2 style="color:#fff;font-size:1.25rem;font-weight:900;margin-bottom:6px;">탐험가 이름을 입력하세요</h2>
      <p style="color:#64748b;font-size:0.8rem;margin-bottom:24px;">진행 상황이 자동 저장됩니다</p>
      ${users.length ? `
        <div style="margin-bottom:18px;border:1px solid rgba(255,255,255,.07);border-radius:14px;overflow:hidden;">
          ${users.slice(0,4).map(u=>`
            <button class="lh-user-pick" data-name="${u}" style="
              display:flex;align-items:center;gap:10px;width:100%;padding:12px 16px;
              background:transparent;border:none;border-bottom:1px solid rgba(255,255,255,.05);
              color:#c4cde0;font-size:0.9rem;font-weight:700;cursor:pointer;
              font-family:inherit;transition:.12s;text-align:left;
            ">
              <span style="font-size:1.3rem;">👤</span><span>${u}</span>
            </button>
          `).join('')}
        </div>
        <p style="color:#475569;font-size:0.72rem;margin-bottom:12px;">또는 새 탐험가</p>
      ` : ''}
      <div style="display:flex;gap:8px;">
        <input id="lh-name-in" type="text" placeholder="이름 입력 (최대 12자)" maxlength="12"
          style="flex:1;padding:12px 16px;border-radius:12px;background:rgba(255,255,255,.07);
          border:1.5px solid rgba(255,255,255,.12);color:#fff;font-size:0.95rem;font-family:inherit;outline:none;"/>
        <button id="lh-go-btn" style="padding:12px 20px;border-radius:12px;
          background:linear-gradient(135deg,#6366f1,#8b5cf6);border:none;
          color:#fff;font-size:0.9rem;font-weight:900;cursor:pointer;font-family:inherit;white-space:nowrap;">
          시작 →
        </button>
      </div>
      <p id="lh-login-err" style="color:#f87171;font-size:0.75rem;margin-top:8px;display:none;">이름을 입력해주세요</p>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    function go(name) {
      name = (name||'').trim();
      if (!name) { document.getElementById('lh-login-err').style.display='block'; return; }
      const U2 = global.User || Container?.get?.('User');
      U2?.createOrSwitch?.(name);
      overlay.remove();
      onReady();
    }

    document.getElementById('lh-go-btn').onclick = () => go(document.getElementById('lh-name-in').value);
    document.getElementById('lh-name-in').onkeydown = e => { if (e.key==='Enter') go(e.target.value); };
    box.querySelectorAll('.lh-user-pick').forEach(btn => {
      btn.onclick = () => go(btn.dataset.name);
      btn.onmouseover = () => btn.style.background = 'rgba(99,102,241,.15)';
      btn.onmouseout  = () => btn.style.background = 'transparent';
    });
    setTimeout(() => document.getElementById('lh-name-in')?.focus(), 80);
  },

  injectBackLink(href='index.html') {
    if (document.getElementById('lh-back')) return;
    const a = document.createElement('a');
    a.id='lh-back'; a.href=href; a.textContent='← 허브';
    Object.assign(a.style, {
      position:'fixed', top:'12px', left:'14px', zIndex:'9995',
      padding:'6px 14px', borderRadius:'100px',
      background:'rgba(0,0,0,.6)', backdropFilter:'blur(8px)',
      border:'1px solid rgba(255,255,255,.12)',
      color:'rgba(255,255,255,.7)', fontSize:'0.78rem',
      fontWeight:'700', textDecoration:'none', fontFamily:'inherit', transition:'.15s',
    });
    a.onmouseover = () => { a.style.color='#fff'; a.style.borderColor='rgba(255,255,255,.3)'; };
    a.onmouseout  = () => { a.style.color='rgba(255,255,255,.7)'; a.style.borderColor='rgba(255,255,255,.12)'; };
    document.body.appendChild(a);
  },
};

if (global.Container) Container.register('Modal', Modal);
global.Modal = Modal;
})(window);
