/* ============================================================
   🎓 학습 게임 허브 - 공유 사용자/레벨/오답노트 시스템
   모든 게임 페이지에서 <script src="shared.js"></script> 로 로드
   ============================================================ */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'lh_users_v1';
  const SUBJECTS = ['수학', '영어', '국어', '사회', '과학'];
  const MIN_GRADE = 3;
  const MAX_GRADE = 6;

  // 학교급별 학년 범위
  const TIER_GRADES = {
    elementary: { min: 3, max: 6 },
    middle:     { min: 7, max: 9 },   // 중1=7, 중2=8, 중3=9
    high:       { min: 10, max: 12 }, // 고1=10, 고2=11, 고3=12
  };

  function getTier(grade) {
    if (grade <= 6)  return 'elementary';
    if (grade <= 9)  return 'middle';
    return 'high';
  }

  function gradeDisplayLabel(grade) {
    if (grade <= 6)  return `초등 ${grade}학년`;
    if (grade <= 9)  return `중등 ${grade - 6}학년`;
    return `고등 ${grade - 9}학년`;
  }

  // ── 외부 데이터 (비동기 로드) ─────────────────────────────
  let SPRITE_DATA = { bodies:{}, hair:{}, outfits:{}, hats:{}, weapons:{}, pets:{}, palette:{} };
  let ITEM_CATALOG = [];
  let ROOM_ITEM_CATALOG = [];
  let _dataReady = false;
  const _readyCallbacks = [];

  function _resolveBase() {
    if (typeof document === 'undefined') return '';
    const s = document.querySelector('script[src*="shared"]');
    if (!s) return '';
    try { return new URL(s.src, location.href).href.replace(/shared\.js.*$/, ''); } catch(e) { return ''; }
  }

  async function _loadData() {
    if (_dataReady) return;
    const base = _resolveBase();
    try {
      const [sr, ir] = await Promise.all([
        fetch(base + 'data/sprites.json'),
        fetch(base + 'data/items.json'),
      ]);
      SPRITE_DATA = await sr.json();
      const id = await ir.json();
      ITEM_CATALOG = id.items || [];
      ROOM_ITEM_CATALOG = id.roomItems || [];
    } catch (e) {
      console.error('[LearningHub] 데이터 로드 실패:', e);
    }
    _dataReady = true;
    _readyCallbacks.splice(0).forEach(fn => fn());
  }

  /** 데이터 로드 완료 후 콜백 실행 (이미 준비됐으면 즉시 실행) */
  function onReady(fn) {
    if (_dataReady) { fn(); return; }
    _readyCallbacks.push(fn);
  }

  // 페이지 로드 즉시 데이터 fetch 시작
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', _loadData);
    } else {
      _loadData();
    }
  }

  // ---------------------------------------------------------
  // 내부 저장소 로드/저장
  // ---------------------------------------------------------
  function loadDB() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { users: {}, currentUser: null };
      const db = JSON.parse(raw);
      if (!db.users) db.users = {};
      return db;
    } catch (e) {
      return { users: {}, currentUser: null };
    }
  }

  function saveDB(db) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    } catch (e) {
      console.warn('LearningHub: 저장 실패', e);
    }
  }

  function defaultGrades() {
    const g = {};
    SUBJECTS.forEach(s => g[s] = MIN_GRADE);
    return g;
  }

  function ensureUser(db, name) {
    if (!db.users[name]) {
      db.users[name] = {
        name: name,
        createdAt: Date.now(),
        grades: defaultGrades(),
        stats: {},       // gameId -> { plays, totalScore, totalCorrect, totalQ, history:[] }
        wrongBank: []     // [{gameId, subject, qKey, data, wrongCount, correctStreak, lastSeen, mastered}]
      };
    }
    // 누락 필드 보정 (구버전 데이터 호환)
    const u = db.users[name];
    if (!u.grades) u.grades = defaultGrades();
    SUBJECTS.forEach(s => { if (!u.grades[s]) u.grades[s] = MIN_GRADE; });
    if (!u.stats) u.stats = {};
    if (!u.wrongBank) u.wrongBank = [];
    if (!u.streak) u.streak = 0;
    if (!u.lastVisitDate) u.lastVisitDate = null;
    return u;
    return u;
  }

  // ---------------------------------------------------------
  // 사용자 관리
  // ---------------------------------------------------------
  function listUsers() {
    const db = loadDB();
    return Object.keys(db.users).sort((a, b) => (db.users[b].createdAt || 0) - (db.users[a].createdAt || 0));
  }

  function getCurrentUserName() {
    const db = loadDB();
    return db.currentUser;
  }

  function getCurrentUser() {
    const db = loadDB();
    if (!db.currentUser || !db.users[db.currentUser]) return null;
    return db.users[db.currentUser];
  }

  function createOrSwitchUser(name) {
    name = (name || '').trim();
    if (!name) return null;
    const db = loadDB();
    ensureUser(db, name);
    db.currentUser = name;
    saveDB(db);
    return db.users[name];
  }

  function switchUser(name) {
    const db = loadDB();
    if (!db.users[name]) return null;
    db.currentUser = name;
    saveDB(db);
    return db.users[name];
  }

  function deleteUser(name) {
    const db = loadDB();
    delete db.users[name];
    if (db.currentUser === name) db.currentUser = null;
    saveDB(db);
  }

  function logout() {
    const db = loadDB();
    db.currentUser = null;
    saveDB(db);
  }

  // ---------------------------------------------------------
  // 학년(레벨) 관리
  // ---------------------------------------------------------
  function getGrade(subject) {
    const u = getCurrentUser();
    if (!u) return MIN_GRADE;
    return u.grades[subject] || MIN_GRADE;
  }

  function setGrade(subject, grade) {
    grade = Math.max(MIN_GRADE, Math.min(MAX_GRADE, grade));
    const db = loadDB();
    const u = db.users[db.currentUser];
    if (!u) return;
    u.grades[subject] = grade;
    saveDB(db);
    return grade;
  }

  /**
   * 라운드 종료 후 레벨업/다운 판정
   * accuracy: 0~1 정답률
   * 반환: { changed: bool, newGrade, direction: 'up'|'down'|'same' }
   */
  function evaluateLevel(subject, accuracy, opts) {
    opts = opts || {};
    const upTh   = opts.upThreshold  != null ? opts.upThreshold  : 0.8;
    const downTh  = opts.downThreshold != null ? opts.downThreshold : 0.4;
    const cur = getGrade(subject);
    const tier = getTier(cur);
    const tierRange = TIER_GRADES[tier] || TIER_GRADES.elementary;
    // opts.tier 로 강제 지정 가능 (중등 게임이 7~9 범위만 쓸 때)
    const minG = opts.minGrade != null ? opts.minGrade : tierRange.min;
    const maxG = opts.maxGrade != null ? opts.maxGrade : tierRange.max;
    let next = cur, direction = 'same';
    if (accuracy >= upTh && cur < maxG) { next = cur + 1; direction = 'up'; }
    else if (accuracy < downTh && cur > minG) { next = cur - 1; direction = 'down'; }
    if (next !== cur) setGrade(subject, next);
    let newItems = [];
    if (next !== cur) {
      const db = loadDB();
      const u = db.currentUser && db.users[db.currentUser];
      if (u) { newItems = _checkUnlocks(db, u); saveDB(db); }
    }
    return { changed: next !== cur, newGrade: next, oldGrade: cur, direction, newItems, tier };
  }

  // ---------------------------------------------------------
  // 오답 노트 (게임 간 공유)
  // ---------------------------------------------------------
  function _findWrong(u, gameId, qKey) {
    return u.wrongBank.find(w => w.gameId === gameId && w.qKey === qKey);
  }

  /**
   * 문제 풀이 결과 기록. 오답이면 오답노트에 추가/누적, 정답이면 연속정답 누적해
   * 일정 횟수 이상 맞히면 mastered 처리하여 복습 큐에서 제외.
   * data: 문제를 복원하는데 필요한 임의 정보 (게임이 정의)
   */
  function recordAnswer(opts) {
    const db = loadDB();
    const u = db.users[db.currentUser];
    if (!u) return;
    const { gameId, subject, qKey, data, correct } = opts;
    let w = _findWrong(u, gameId, qKey);
    if (!correct) {
      if (!w) {
        w = { gameId, subject, qKey, data, wrongCount: 0, correctStreak: 0, lastSeen: 0, mastered: false };
        u.wrongBank.push(w);
      }
      w.wrongCount += 1;
      w.correctStreak = 0;
      w.mastered = false;
      w.data = data || w.data;
      w.lastSeen = Date.now();
    } else if (w) {
      w.correctStreak += 1;
      w.lastSeen = Date.now();
      if (w.correctStreak >= 2) w.mastered = true; // 두 번 연속 맞으면 복습 완료
    }
    saveDB(db);
  }

  /**
   * 특정 게임(및 과목)에 대한 복습 대기 문제 목록 반환 (미숙달, 최근 본 순 우선순위 낮음)
   */
  function getReviewQueue(gameId, subject, limit) {
    const u = getCurrentUser();
    if (!u) return [];
    let list = u.wrongBank.filter(w => w.gameId === gameId && !w.mastered);
    if (subject) list = list.filter(w => w.subject === subject);
    list = list.slice().sort((a, b) => a.lastSeen - b.lastSeen); // 오래된 것 먼저
    if (limit) list = list.slice(0, limit);
    return list.map(w => w.data);
  }

  function getReviewCount(gameId, subject) {
    const u = getCurrentUser();
    if (!u) return 0;
    return u.wrongBank.filter(w => w.gameId === gameId && !w.mastered && (!subject || w.subject === subject)).length;
  }

  /**
   * 오답노트 전용 풀기 — 과목별 미숙달 문제 전체 반환 (data 포함)
   * 오답노트 UI에서 독립적으로 풀 수 있도록 데이터+메타 모두 반환
   */
  function getWrongBankItems(subject) {
    const u = getCurrentUser();
    if (!u) return [];
    let list = u.wrongBank.filter(w => !w.mastered);
    if (subject) list = list.filter(w => w.subject === subject);
    return list.slice().sort((a,b) => b.wrongCount - a.wrongCount || a.lastSeen - b.lastSeen)
      .map(w => ({ qKey: w.qKey, gameId: w.gameId, subject: w.subject, wrongCount: w.wrongCount, correctStreak: w.correctStreak, data: w.data }));
  }

  /**
   * 오답노트에서 직접 풀기 결과 기록
   * 정답을 2번 연속 맞추면 mastered (게임 내 복습과 동일 기준)
   */
  function reviewAnswer(gameId, qKey, correct) {
    const db = loadDB();
    const u = db.users[db.currentUser];
    if (!u) return null;
    const w = u.wrongBank.find(x => x.gameId === gameId && x.qKey === qKey);
    if (!w) return null;
    if (correct) {
      w.correctStreak = (w.correctStreak || 0) + 1;
      w.lastSeen = Date.now();
      if (w.correctStreak >= 2) { w.mastered = true; }
    } else {
      w.wrongCount += 1;
      w.correctStreak = 0;
      w.mastered = false;
      w.lastSeen = Date.now();
    }
    saveDB(db);
    return { mastered: w.mastered, correctStreak: w.correctStreak, wrongCount: w.wrongCount };
  }

  // ---------------------------------------------------------
  // 게임 플레이 통계
  // ---------------------------------------------------------
  function recordPlay(gameId, result) {
    const db = loadDB();
    const u = db.users[db.currentUser];
    if (!u) return;
    if (!u.stats[gameId]) u.stats[gameId] = { plays: 0, totalScore: 0, totalCorrect: 0, totalQ: 0, history: [] };
    const s = u.stats[gameId];
    s.plays += 1;
    s.totalScore += (result.score || 0);
    s.totalCorrect += (result.correct || 0);
    s.totalQ += (result.total || 0);
    s.history.push({ t: Date.now(), score: result.score || 0, correct: result.correct || 0, total: result.total || 0, grade: result.grade });
    if (s.history.length > 30) s.history = s.history.slice(-30);
    saveDB(db);
  }

  function getStats(gameId) {
    const u = getCurrentUser();
    if (!u) return null;
    return u.stats[gameId] || null;
  }

  function getAllStats() {
    const u = getCurrentUser();
    if (!u) return {};
    return u.stats;
  }

  /**
   * 과목별 오답노트 요약: { 과목: { total, mastered, pending } }
   */
  function getWrongBankSummary() {
    const u = getCurrentUser();
    const result = {};
    SUBJECTS.forEach(s => result[s] = { total: 0, mastered: 0, pending: 0 });
    if (!u) return result;
    u.wrongBank.forEach(w => {
      if (!result[w.subject]) result[w.subject] = { total: 0, mastered: 0, pending: 0 };
      result[w.subject].total += 1;
      if (w.mastered) result[w.subject].mastered += 1;
      else result[w.subject].pending += 1;
    });
    return result;
  }

  // ---------------------------------------------------------
  // UI 헬퍼: 상단 프로필 바
  // ---------------------------------------------------------
  function gradeLabel(g) {
    return g + '학년';
  }

  function renderProfileBadge(targetEl, subject) {
    const u = getCurrentUser();
    if (!targetEl) return;
    if (!u) {
      targetEl.innerHTML = '';
      return;
    }
    const grade = subject ? getGrade(subject) : null;
    targetEl.innerHTML =
      '<span class="lh-badge-name">👤 ' + escapeHtml(u.name) + '</span>' +
      (grade ? '<span class="lh-badge-grade">' + escapeHtml(subject) + ' ' + gradeLabel(grade) + '</span>' : '');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------------------------------------------------------
  // 레벨업 / 아이템 획득 토스트 (모든 페이지에서 사용 가능)
  // ---------------------------------------------------------
  function _ensureToastWrap() {
    let wrap = document.getElementById('lh-toast-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'lh-toast-wrap';
      wrap.style.position = 'fixed';
      wrap.style.top = '16px';
      wrap.style.left = '50%';
      wrap.style.transform = 'translateX(-50%)';
      wrap.style.zIndex = '999999';
      wrap.style.display = 'flex';
      wrap.style.flexDirection = 'column';
      wrap.style.gap = '8px';
      wrap.style.alignItems = 'center';
      wrap.style.pointerEvents = 'none';
      document.body.appendChild(wrap);
    }
    if (!document.getElementById('lh-toast-style')) {
      const style = document.createElement('style');
      style.id = 'lh-toast-style';
      style.textContent = `
        .lh-toast { background:linear-gradient(135deg,#1e1e3a,#2a1a4a); border:1px solid #ffd700; border-radius:12px;
          padding:10px 20px; color:#ffd700; font-weight:800; font-size:0.9rem; box-shadow:0 0 24px rgba(255,215,0,0.3);
          animation: lhToastIn .3s ease-out, lhToastOut .3s ease-in 2.7s forwards; white-space:nowrap;
          font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif; }
        @keyframes lhToastIn { from{opacity:0; transform:translateY(-12px);} to{opacity:1; transform:translateY(0);} }
        @keyframes lhToastOut { from{opacity:1;} to{opacity:0; transform:translateY(-12px);} }
      `;
      document.head.appendChild(style);
    }
    return wrap;
  }

  function showToast(text) {
    if (typeof document === 'undefined') return;
    const wrap = _ensureToastWrap();
    const el = document.createElement('div');
    el.className = 'lh-toast';
    el.textContent = text;
    wrap.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  // ---------------------------------------------------------
  // 허브로 돌아가기 링크 (모든 게임 페이지 좌상단에 고정)
  // ---------------------------------------------------------
  function injectBackLink() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('lh-back-link')) return;
    const a = document.createElement('a');
    a.id = 'lh-back-link';
    a.href = 'index.html';
    a.textContent = '← 허브';
    a.style.position = 'fixed';
    a.style.top = '10px';
    a.style.left = '10px';
    a.style.zIndex = '99998';
    a.style.background = 'rgba(0,0,0,0.45)';
    a.style.color = '#c4cde0';
    a.style.fontSize = '0.78rem';
    a.style.fontWeight = '700';
    a.style.padding = '6px 12px';
    a.style.borderRadius = '100px';
    a.style.border = '1px solid rgba(255,255,255,0.15)';
    a.style.textDecoration = 'none';
    a.style.fontFamily = "'Malgun Gothic','Apple SD Gothic Neo',sans-serif";
    a.style.backdropFilter = 'blur(4px)';
    a.onmouseover = () => { a.style.color = '#fff'; a.style.borderColor = '#7c7cff'; };
    a.onmouseout = () => { a.style.color = '#c4cde0'; a.style.borderColor = 'rgba(255,255,255,0.15)'; };
    document.body.appendChild(a);
  }

  /**
   * addExp 결과를 받아서 레벨업/아이템 획득 토스트를 자동으로 표시
   */
  function announceExpResult(result) {
    if (!result) return;
    if (result.leveledUp) {
      showToast('🎉 레벨업! Lv.' + result.newLevel + ' 달성!');
    }
    (result.newItems || []).forEach(item => {
      setTimeout(() => showToast('✨ 새 아이템 획득: ' + item.name), result.leveledUp ? 600 : 0);
    });
  }

  // ---------------------------------------------------------
  // 로그인 모달 (게임 페이지에서 사용자 없을 때 표시)
  // ---------------------------------------------------------
  function injectLoginModal(onReady) {
    if (getCurrentUser()) { onReady && onReady(getCurrentUser()); return; }

    const overlay = document.createElement('div');
    overlay.id = 'lh-login-overlay';
    overlay.innerHTML = `
      <div class="lh-login-box">
        <div class="lh-login-title">🎓 학습 게임 허브</div>
        <div class="lh-login-sub">이름을 입력하면 나만의 학습 기록이 시작돼요</div>
        <input id="lh-login-input" type="text" placeholder="이름 또는 닉네임" maxlength="12" autocomplete="off" />
        <button id="lh-login-btn">시작하기</button>
        <div id="lh-login-users"></div>
      </div>
    `;
    const style = document.createElement('style');
    style.textContent = `
      #lh-login-overlay { position:fixed; inset:0; background:rgba(5,5,15,0.92); backdrop-filter:blur(6px);
        display:flex; align-items:center; justify-content:center; z-index:99999; font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif; }
      .lh-login-box { background:linear-gradient(160deg,#181830,#0c0c1c); border:1px solid #3a3a66; border-radius:20px;
        padding:36px 32px; width:90%; max-width:360px; text-align:center; box-shadow:0 0 60px rgba(100,100,255,0.25); }
      .lh-login-title { font-size:1.5rem; font-weight:900; color:#fff; margin-bottom:8px; }
      .lh-login-sub { font-size:0.85rem; color:#9aa3c0; margin-bottom:20px; line-height:1.6; }
      #lh-login-input { width:100%; padding:12px 14px; border-radius:10px; border:2px solid #3a3a66; background:#0e0e22;
        color:#fff; font-size:1rem; text-align:center; margin-bottom:12px; outline:none; box-sizing:border-box; }
      #lh-login-input:focus { border-color:#7c7cff; }
      #lh-login-btn { width:100%; padding:12px; border:none; border-radius:10px; background:linear-gradient(135deg,#6366f1,#a855f7);
        color:#fff; font-weight:800; font-size:1rem; cursor:pointer; letter-spacing:1px; }
      #lh-login-btn:hover { filter:brightness(1.15); }
      #lh-login-users { margin-top:18px; display:flex; flex-wrap:wrap; gap:8px; justify-content:center; }
      .lh-user-chip { padding:6px 14px; border-radius:100px; background:rgba(255,255,255,0.06); border:1px solid #3a3a66;
        color:#c4cde0; font-size:0.82rem; cursor:pointer; transition:.15s; display:inline-flex; align-items:center; gap:6px; }
      .lh-user-chip:hover { border-color:#7c7cff; color:#fff; background:rgba(124,124,255,0.15); }
      .lh-user-chip .lh-user-del { color:#8892a4; font-weight:900; padding:0 2px; border-radius:50%; line-height:1; }
      .lh-user-chip .lh-user-del:hover { color:#ff6b6b; }
      .lh-login-hint { margin-top:10px; font-size:0.7rem; color:#666f8c; }
    `;
    document.head.appendChild(style);
    document.body.appendChild(overlay);

    const users = listUsers();
    if (users.length) {
      const wrap = overlay.querySelector('#lh-login-users');
      users.slice(0, 8).forEach(name => {
        const chip = document.createElement('div');
        chip.className = 'lh-user-chip';
        const label = document.createElement('span');
        label.textContent = '👤 ' + name;
        label.onclick = () => { switchUser(name); finish(); };
        chip.appendChild(label);
        const del = document.createElement('span');
        del.className = 'lh-user-del';
        del.textContent = '✕';
        del.title = '프로필 삭제';
        del.onclick = (e) => {
          e.stopPropagation();
          if (del.dataset.confirm === '1') {
            deleteUser(name);
            chip.remove();
          } else {
            del.dataset.confirm = '1';
            del.textContent = '삭제?';
            chip.style.borderColor = '#ff6b6b';
            setTimeout(() => { del.dataset.confirm = ''; del.textContent = '✕'; chip.style.borderColor = '#3a3a66'; }, 2500);
          }
        };
        chip.appendChild(del);
        wrap.appendChild(chip);
      });
      const hint = document.createElement('div');
      hint.className = 'lh-login-hint';
      hint.textContent = '✕를 두 번 누르면 해당 프로필이 삭제돼요';
      overlay.querySelector('.lh-login-box').appendChild(hint);
    }

    function finish() {
      overlay.remove();
      style.remove();
      onReady && onReady(getCurrentUser());
    }

    const input = overlay.querySelector('#lh-login-input');
    const btn = overlay.querySelector('#lh-login-btn');
    btn.onclick = () => {
      const name = input.value.trim();
      if (!name) { input.focus(); return; }
      createOrSwitchUser(name);
      finish();
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') btn.click(); });
    setTimeout(() => input.focus(), 100);
  }

  // ---------------------------------------------------------
  // 난이도 자동 매핑 헬퍼
  // 게임마다 난이도 단계 수가 다를 수 있어 변환 헬퍼 제공
  // grade 3~6 -> 0~1 정규화 위치
  // ---------------------------------------------------------
  function gradeToTier(grade, tierCount) {
    const t = Math.round((grade - MIN_GRADE) / (MAX_GRADE - MIN_GRADE) * (tierCount - 1));
    return Math.max(0, Math.min(tierCount - 1, t));
  }


  // ---------------------------------------------------------
  // 🎨 캐릭터 / 픽셀 스프라이트 / 인벤토리 / EXP 시스템
  // ---------------------------------------------------------



// ---------------------------------------------------------
// 🏕️ 탐험가 베이스캠프 꾸미기 아이템 카탈로그
// ---------------------------------------------------------

  const LEVEL_EXP = lvl => lvl * 100; // 레벨업에 필요한 EXP (lvl->lvl+1)

  function defaultCharacter() {
    const defaultItems = ITEM_CATALOG.filter(it => it.unlock.type === 'default').map(it => it.id);
    const defaultRoomItems = ROOM_ITEM_CATALOG.filter(it => it.unlock.type === 'default').map(it => it.id);
    return {
      level: 1,
      exp: 0,
      inventory: defaultItems,
      equipped: {
        body: 'body_basic',
        hair: 'hair_brown',
        outfit: 'outfit_basic',
        hat: 'hat_none',
        weapon: 'weapon_none',
        pet1: 'pet_none',
        pet2: 'pet_none'
      },
      achievements: [], // ["분수계단:clear5", ...]
      roomInventory: defaultRoomItems,
      room: {
        wallpaper: 'wall_basic',
        floor: 'floor_wood',
        furniture: [] // ['furn_bed', ...] 배치된 가구 id 목록 (자동 배치)
      }
    };
  }

  function ensureCharacter(u) {
    if (!u.character) u.character = defaultCharacter();
    const c = u.character;
    if (!c.inventory) c.inventory = defaultCharacter().inventory;
    if (!c.equipped) c.equipped = defaultCharacter().equipped;
    if (!c.achievements) c.achievements = [];
    if (typeof c.level !== 'number') c.level = 1;
    if (typeof c.exp !== 'number') c.exp = 0;
    // pet → pet1/pet2 마이그레이션
    if (c.equipped.pet !== undefined) {
      c.equipped.pet1 = c.equipped.pet;
      c.equipped.pet2 = 'pet_none';
      delete c.equipped.pet;
    }
    if (!c.equipped.pet1) c.equipped.pet1 = 'pet_none';
    if (!c.equipped.pet2) c.equipped.pet2 = 'pet_none';
    if (!c.roomInventory) c.roomInventory = defaultCharacter().roomInventory;
    if (!c.room) c.room = defaultCharacter().room;
    if (!c.room.wallpaper) c.room.wallpaper = 'wall_basic';
    if (!c.room.floor) c.room.floor = 'floor_wood';
    if (!c.room.furniture) c.room.furniture = [];
    return c;
  }

  function getCharacter() {
    const db = loadDB();
    const u = db.users[db.currentUser];
    if (!u) return null;
    return ensureCharacter(u);
  }

  function getItemById(id) {
    return ITEM_CATALOG.find(it => it.id === id);
  }

  /**
   * 새로 해금 가능한 아이템들을 확인하여 인벤토리에 추가.
   * 반환: 새로 획득한 아이템 목록
   */
  function _checkUnlocks(db, u) {
    const c = ensureCharacter(u);
    const newly = [];
    const allCatalogs = [ITEM_CATALOG, ROOM_ITEM_CATALOG];
    const inventories = [c.inventory, c.roomInventory];
    allCatalogs.forEach((catalog, ci) => {
      catalog.forEach(it => {
        if (inventories[ci].includes(it.id)) return;
        const cond = it.unlock;
        let unlocked = false;
        if (cond.type === 'default') unlocked = true;
        else if (cond.type === 'level') unlocked = c.level >= cond.value;
        else if (cond.type === 'achievement') unlocked = c.achievements.includes(cond.game + ':' + cond.value);
        else if (cond.type === 'streak') unlocked = (u.streak || 0) >= cond.value;
        else if (cond.type === 'grade_master') unlocked = (u.grades || {})[cond.subject] >= MAX_GRADE;
        if (unlocked) {
          inventories[ci].push(it.id);
          newly.push(it);
        }
      });
    });
    return newly;
  }

  /**
   * EXP 추가. 레벨업 시 자동으로 레벨/아이템 갱신.
   * 반환: { leveledUp:bool, newLevel, newItems:[...] }
   */
  /**
   * 출석 체크. 매번 앱 접속 시 호출.
   * - 오늘 처음 접속이면 연속 일수(streak) 갱신
   * - 어제 접속 → streak +1 / 이틀 이상 끊기면 streak 1로 리셋
   * 반환: { streak, isNew:bool, newItems:[] }
   */
  function checkStreak() {
    const db = loadDB();
    const u = db.currentUser && db.users[db.currentUser];
    if (!u) return null;
    ensureUser(db, db.currentUser);

    const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
    if (u.lastVisitDate === today) {
      return { streak: u.streak || 1, isNew: false, newItems: [] };
    }

    const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    if (u.lastVisitDate === yesterday) {
      u.streak = (u.streak || 1) + 1;
    } else {
      u.streak = 1; // 끊김 → 리셋
    }
    u.lastVisitDate = today;

    const newItems = _checkUnlocks(db, u);
    saveDB(db);
    return { streak: u.streak, isNew: true, newItems };
  }

  function addExp(amount, source) {
    const db = loadDB();
    const u = db.users[db.currentUser];
    if (!u) return null;
    const c = ensureCharacter(u);
    amount = Math.max(0, Math.round(amount));
    c.exp += amount;
    let leveledUp = false;
    while (c.exp >= LEVEL_EXP(c.level)) {
      c.exp -= LEVEL_EXP(c.level);
      c.level += 1;
      leveledUp = true;
    }
    const newItems = _checkUnlocks(db, u);
    saveDB(db);
    return { leveledUp, newLevel: c.level, exp: c.exp, expToNext: LEVEL_EXP(c.level), newItems, source };
  }

  /**
   * 업적 달성 기록. gameId:value 형식으로 저장. 새 아이템 해금 여부 반환.
   */
  function unlockAchievement(gameId, value) {
    const db = loadDB();
    const u = db.users[db.currentUser];
    if (!u) return null;
    const c = ensureCharacter(u);
    const key = gameId + ':' + value;
    if (c.achievements.includes(key)) return { newItems: [] };
    c.achievements.push(key);
    const newItems = _checkUnlocks(db, u);
    saveDB(db);
    return { newItems };
  }

  function equipItem(slot, itemId) {
    const db = loadDB();
    const u = db.users[db.currentUser];
    if (!u) return false;
    const c = ensureCharacter(u);
    const item = getItemById(itemId);
    if (!item) return false;
    // pet1/pet2는 'pet' 슬롯 아이템을 사용
    const itemSlot = (slot === 'pet1' || slot === 'pet2') ? 'pet' : slot;
    if (item.slot !== itemSlot) return false;
    if (!c.inventory.includes(itemId)) return false;
    c.equipped[slot] = itemId;
    saveDB(db);
    return true;
  }

  // ---------------------------------------------------------
  // 🏠 캐릭터 룸(꾸미기) 관리
  // ---------------------------------------------------------
  function getRoomItemById(id) {
    return ROOM_ITEM_CATALOG.find(it => it.id === id);
  }

  function getRoom() {
    const c = getCharacter();
    return c ? c.room : null;
  }

  /**
   * 보유한 방 아이템(잠금 제외)을 슬롯별로 반환
   */
  function getRoomInventoryBySlot(slot) {
    const c = getCharacter();
    if (!c) return [];
    return c.roomInventory.map(getRoomItemById).filter(it => it && it.slot === slot);
  }

  /**
   * 슬롯의 모든 방 아이템(잠금 포함) 반환. unlocked:bool 추가.
   */
  function getAllRoomItemsBySlot(slot) {
    const c = getCharacter();
    const owned = new Set(c ? c.roomInventory : []);
    return ROOM_ITEM_CATALOG.filter(it => it.slot === slot).map(it => Object.assign({}, it, { unlocked: owned.has(it.id) }));
  }

  function setWallpaper(itemId) {
    const db = loadDB();
    const u = db.users[db.currentUser];
    if (!u) return false;
    const c = ensureCharacter(u);
    const item = getRoomItemById(itemId);
    if (!item || item.slot !== 'wallpaper') return false;
    if (!c.roomInventory.includes(itemId)) return false;
    c.room.wallpaper = itemId;
    saveDB(db);
    return true;
  }

  function setFloor(itemId) {
    const db = loadDB();
    const u = db.users[db.currentUser];
    if (!u) return false;
    const c = ensureCharacter(u);
    const item = getRoomItemById(itemId);
    if (!item || item.slot !== 'floor') return false;
    if (!c.roomInventory.includes(itemId)) return false;
    c.room.floor = itemId;
    saveDB(db);
    return true;
  }

  /**
   * 가구를 방에 배치/제거 토글 (자동 배치, 위치 지정 불필요)
   * 반환: 배치 후 상태(true=놓임, false=치워짐)
   */
  function toggleFurniture(itemId) {
    const db = loadDB();
    const u = db.users[db.currentUser];
    if (!u) return null;
    const c = ensureCharacter(u);
    const item = getRoomItemById(itemId);
    if (!item || item.slot !== 'furniture') return null;
    if (!c.roomInventory.includes(itemId)) return null;
    const idx = c.room.furniture.indexOf(itemId);
    let placed;
    if (idx >= 0) { c.room.furniture.splice(idx, 1); placed = false; }
    else { c.room.furniture.push(itemId); placed = true; }
    saveDB(db);
    return placed;
  }

  function getInventoryBySlot(slot) {
    const c = getCharacter();
    if (!c) return [];
    return c.inventory.map(getItemById).filter(it => it && it.slot === slot);
  }

  /**
   * 슬롯의 모든 아이템(잠금 포함)을 반환. 각 항목에 unlocked:bool 추가.
   */
  function getAllItemsBySlot(slot) {
    const c = getCharacter();
    const owned = new Set(c ? c.inventory : []);
    // pet1/pet2는 모두 'pet' 슬롯 아이템을 공유
    const catalogSlot = (slot === 'pet1' || slot === 'pet2') ? 'pet' : slot;
    return ITEM_CATALOG.filter(it => it.slot === catalogSlot).map(it => Object.assign({}, it, { unlocked: owned.has(it.id) }));
  }

  const ACHIEVEMENT_LABELS = {
    '분수계단_clear5': '분수 계단 5스테이지 클리어',
    '분수계단_perfect_clear': '분수 계단 퍼펙트 클리어',
    '구구단_final_boss_win': '구구단 최종보스 승리',
    '영단어정벌_perfect_stage': '영단어정벌 퍼펙트 스테이지',
    '영단어정벌_combo20': '영단어정벌 20연속 콤보 달성',
    '한국사탐험_all_eras_clear': '한국사탐험 전시대 클리어',
    '지식탐험_perfect_사회': '지식탐험 사회 만점',
    '지식탐험_perfect_과학': '지식탐험 과학 만점',
    '총알피하기_score_1000': '총알피하기 1000점 달성',
    '지식탐험_perfect_국어': '지식탐험 국어 만점',
    '지식탐험_perfect_영어': '지식탐험 영어 만점',
    '짝꿍찾기_perfect_국어': '짝꿍찾기 국어 만점',
    '짝꿍찾기_perfect_영어': '짝꿍찾기 영어 만점',
    '짝꿍찾기_perfect_과학': '짝꿍찾기 과학 만점',
    '짝꿍찾기_perfect_사회': '짝꿍찾기 사회 만점',
    '빈칸마법사_perfect_국어': '빈칸마법사 국어 만점',
    '빈칸마법사_perfect_영어': '빈칸마법사 영어 만점',
  };

  /**
   * 잠긴 아이템의 해금조건을 사람이 읽을 수 있는 문구로 반환
   */
  function describeUnlock(item) {
    if (!item.unlock) return '';
    if (item.unlock.type === 'default') return '';
    if (item.unlock.type === 'level') return `Lv.${item.unlock.value} 달성 시 해금`;
    if (item.unlock.type === 'streak') return `${item.unlock.value}일 연속 접속 시 해금`;
    if (item.unlock.type === 'grade_master') return `${item.unlock.subject} 6학년 달성 시 해금`;
    if (item.unlock.type === 'achievement') {
      const key = `${item.unlock.game}_${item.unlock.value}`;
      return (ACHIEVEMENT_LABELS[key] || `${item.unlock.game} 업적 달성`) + ' 시 해금';
    }
    return '';
  }

  // ---------------------------------------------------------
  // 픽셀 스프라이트 렌더링 (canvas, 16x16 grid)
  // ---------------------------------------------------------
  function _drawGrid(ctx, grid, scale, ox, oy) {
    for (let y = 0; y < grid.length; y++) {
      for (let x = 0; x < grid[y].length; x++) {
        const c = grid[y][x];
        if (!c || c === 0) continue;
        let color = SPRITE_DATA.palette[String(c)];
        if (!color) color = (typeof c === 'string') ? c : '#000';
        ctx.fillStyle = color;
        ctx.fillRect(ox + x * scale, oy + y * scale, scale, scale);
      }
    }
  }

  /**
   * 캐릭터를 캔버스에 렌더링. equipped: {body,hair,outfit,hat,weapon,pet}
   * canvas 크기는 16*scale 이상이어야 함 (펫 포함시 여유 필요)
   */
  function renderCharacter(canvas, equipped, scale) {
    if (!canvas) return;
    scale = scale || 8;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const bodyItem = getItemById(equipped.body) || getItemById('body_basic');
    const hairItem = getItemById(equipped.hair);
    const outfitItem = getItemById(equipped.outfit);
    const hatItem = getItemById(equipped.hat);
    const weaponItem = getItemById(equipped.weapon);
    // pet1/pet2 둘 다 지원 (구형 pet 필드 호환)
    const pet1Item = getItemById(equipped.pet1 || equipped.pet);
    const pet2Item = getItemById(equipped.pet2);

    const layers = [
      bodyItem && SPRITE_DATA.bodies[bodyItem.sprite],
      outfitItem && SPRITE_DATA.outfits[outfitItem.sprite],
      hairItem && SPRITE_DATA.hair[hairItem.sprite],
      hatItem && SPRITE_DATA.hats[hatItem.sprite],
      weaponItem && SPRITE_DATA.weapons[weaponItem.sprite],
    ];
    layers.forEach(g => { if (g) _drawGrid(ctx, g, scale, 0, 0); });

    const petScale = scale * 0.65;
    if (pet1Item && pet1Item.sprite !== '없음') {
      const g = SPRITE_DATA.pets[pet1Item.sprite];
      if (g) _drawGrid(ctx, g, petScale, -(scale * 1.5), 16 * scale * 0.45);
    }
    if (pet2Item && pet2Item.sprite !== '없음') {
      const g = SPRITE_DATA.pets[pet2Item.sprite];
      if (g) _drawGrid(ctx, g, petScale, 16 * scale * 0.85, 16 * scale * 0.45);
    }
  }

  /**
   * 현재 사용자 캐릭터를 캔버스에 렌더링 (장착 아이템 기준)
   */
  function renderCurrentCharacter(canvas, scale) {
    const c = getCharacter();
    if (!c) return;
    renderCharacter(canvas, c.equipped, scale);
  }

  global.LearningHub = {
    SUBJECTS, MIN_GRADE, MAX_GRADE, TIER_GRADES, getTier, gradeDisplayLabel,
    listUsers, getCurrentUser, getCurrentUserName,
    createOrSwitchUser, switchUser, deleteUser, logout,
    getGrade, setGrade, evaluateLevel, gradeToTier, gradeLabel,
    recordAnswer, getReviewQueue, getReviewCount, getWrongBankItems, reviewAnswer,
    recordPlay, getStats, getAllStats, getWrongBankSummary,
    renderProfileBadge, injectLoginModal, escapeHtml,
    // 캐릭터/아이템/EXP
    ITEM_CATALOG, SPRITE_DATA, LEVEL_EXP,
    getCharacter, addExp, unlockAchievement, equipItem,
    getInventoryBySlot, getAllItemsBySlot, describeUnlock, getItemById,
    ROOM_ITEM_CATALOG, getRoom, getRoomItemById, getRoomInventoryBySlot, getAllRoomItemsBySlot,
    setWallpaper, setFloor, toggleFurniture,
    renderCharacter, renderCurrentCharacter,
    showToast, announceExpResult, injectBackLink, checkStreak,
    onReady,
  };
})(window);
