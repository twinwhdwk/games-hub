/**
 * @file js/ui/modal.js
 * 로그인 모달, 뒤로가기 링크. DOM 의존, 비즈니스 로직은 User 모듈에 위임.
 */
'use strict';
(function(global) {

const Modal = {
  /** 게임 시작 시 로그인 확인. 로그인돼 있으면 즉시 onReady() 호출. */
  requireLogin(onReady) {
    if (User.current()) { onReady(); return; }
    Modal._showLoginModal(onReady);
  },

  _showLoginModal(onReady) {
    if (document.getElementById('lh-login-modal')) return;

    const overlay = document.createElement('div');
    overlay.id = 'lh-login-modal';
    Object.assign(overlay.style, {
      position:'fixed', inset:'0', background:'rgba(5,5,20,0.92)',
      backdropFilter:'blur(8px)', display:'flex', alignItems:'center',
      justifyContent:'center', zIndex:'9997', fontFamily:'inherit',
    });

    const box = document.createElement('div');
    Object.assign(box.style, {
      background:'linear-gradient(135deg,#0d1b3a,#1a2550)',
      border:'1.5px solid rgba(255,255,255,0.12)', borderRadius:'20px',
      padding:'32px 28px', maxWidth:'380px', width:'90%', textAlign:'center',
      boxShadow:'0 20px 60px rgba(0,0,0,.7)',
    });

    const users = User.list();
    const hasUsers = users.length > 0;
    box.innerHTML = `
      <div style="font-size:2.5rem;margin-bottom:12px;">🗺️</div>
      <h2 style="color:#fff;font-size:1.2rem;font-weight:900;margin-bottom:6px;">탐험가 이름을 입력하세요</h2>
      <p style="color:#8892a4;font-size:0.78rem;margin-bottom:20px;">진행 상황이 저장됩니다</p>
      ${hasUsers ? `
        <div style="margin-bottom:16px;">
          ${users.map(u => `
            <button class="lh-user-btn" data-name="${u}" style="
              display:block;width:100%;padding:10px 16px;margin-bottom:8px;
              background:rgba(255,255,255,0.05);border:1.5px solid rgba(255,255,255,0.1);
              border-radius:12px;color:#c4cde0;font-size:0.9rem;font-weight:700;
              cursor:pointer;text-align:left;font-family:inherit;transition:.12s;
            ">👤 ${u}</button>
          `).join('')}
          <div style="color:#666f8c;font-size:0.72rem;margin:12px 0 8px;">또는 새 탐험가 만들기</div>
        </div>
      ` : ''}
      <div style="display:flex;gap:8px;">
        <input id="lh-name-input" type="text" placeholder="탐험가 이름" maxlength="12" style="
          flex:1;padding:12px 16px;border-radius:12px;
          background:rgba(255,255,255,0.07);border:1.5px solid rgba(255,255,255,0.12);
          color:#fff;font-size:0.95rem;font-family:inherit;outline:none;
        "/>
        <button id="lh-start-btn" style="
          padding:12px 20px;border-radius:12px;
          background:linear-gradient(135deg,#6366f1,#8b5cf6);border:none;
          color:#fff;font-size:0.9rem;font-weight:900;cursor:pointer;font-family:inherit;
        ">시작!</button>
      </div>
      <p id="lh-login-err" style="color:#f87171;font-size:0.75rem;margin-top:8px;display:none;">이름을 입력해주세요</p>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    function tryLogin(name) {
      name = (name || '').trim();
      if (!name) { document.getElementById('lh-login-err').style.display = 'block'; return; }
      User.createOrSwitch(name);
      overlay.remove();
      onReady();
    }

    document.getElementById('lh-start-btn').onclick = () => {
      tryLogin(document.getElementById('lh-name-input').value);
    };
    document.getElementById('lh-name-input').onkeydown = e => {
      if (e.key === 'Enter') tryLogin(e.target.value);
    };
    box.querySelectorAll('.lh-user-btn').forEach(btn => {
      btn.onclick = () => tryLogin(btn.dataset.name);
      btn.onmouseover = () => { btn.style.borderColor='#6366f1'; btn.style.color='#fff'; };
      btn.onmouseout  = () => { btn.style.borderColor='rgba(255,255,255,0.1)'; btn.style.color='#c4cde0'; };
    });

    setTimeout(() => document.getElementById('lh-name-input')?.focus(), 100);
  },

  /** 좌상단 뒤로가기 링크 자동 삽입 */
  injectBackLink(href = 'index.html') {
    if (document.getElementById('lh-back-link')) return;
    const a = document.createElement('a');
    a.id = 'lh-back-link';
    a.href = href;
    a.textContent = '← 허브';
    Object.assign(a.style, {
      position:'fixed', top:'12px', left:'14px', zIndex:'9995',
      padding:'6px 14px', borderRadius:'100px',
      background:'rgba(0,0,0,0.55)', backdropFilter:'blur(6px)',
      border:'1px solid rgba(255,255,255,0.12)',
      color:'rgba(255,255,255,0.7)', fontSize:'0.78rem',
      fontWeight:'700', textDecoration:'none', fontFamily:'inherit',
      transition:'.15s',
    });
    a.onmouseover = () => { a.style.color='#fff'; a.style.borderColor='rgba(255,255,255,0.3)'; };
    a.onmouseout  = () => { a.style.color='rgba(255,255,255,0.7)'; a.style.borderColor='rgba(255,255,255,0.12)'; };
    document.body.appendChild(a);
  },
};

global.Modal = Modal;
})(window);
