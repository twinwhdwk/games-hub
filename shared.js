/* ============================================================
   🎓 학습 게임 허브 - 공유 사용자/레벨/오답노트 시스템
   모든 게임 페이지에서 <script src="shared.js"></script> 로 로드
   ============================================================ */
(function (global) {
  const STORAGE_KEY = 'lh_users_v1';
  const SUBJECTS = ['수학', '영어', '국어', '사회', '과학'];
  const MIN_GRADE = 3;
  const MAX_GRADE = 6;

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
    const upTh = opts.upThreshold != null ? opts.upThreshold : 0.8;
    const downTh = opts.downThreshold != null ? opts.downThreshold : 0.4;
    const cur = getGrade(subject);
    let next = cur;
    let direction = 'same';
    if (accuracy >= upTh && cur < MAX_GRADE) {
      next = cur + 1;
      direction = 'up';
    } else if (accuracy < downTh && cur > MIN_GRADE) {
      next = cur - 1;
      direction = 'down';
    }
    if (next !== cur) setGrade(subject, next);
    return { changed: next !== cur, newGrade: next, oldGrade: cur, direction: direction };
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

const SPRITE_DATA = {"bodies": {"기본": [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 1, 3, 1, 1, 3, 1, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 1, 4, 1, 1, 4, 1, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, "#e0a878", "#e0a878", "#e0a878", "#e0a878", "#e0a878", "#e0a878", 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0], [0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0], [0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0], [0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, "#e0a878", "#e0a878", "#e0a878", "#e0a878", 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, "#e0a878", "#e0a878", "#e0a878", "#e0a878", 0, 0, 0, 0, 0, 0]], "쿨톤": [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 1, 3, 1, 1, 3, 1, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 1, 4, 1, 1, 4, 1, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, "#e8b690", "#e8b690", "#e8b690", "#e8b690", "#e8b690", "#e8b690", 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0], [0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0], [0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0], [0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, "#e8b690", "#e8b690", "#e8b690", "#e8b690", 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, "#e8b690", "#e8b690", "#e8b690", "#e8b690", 0, 0, 0, 0, 0, 0]], "웜톤": [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, "#c68642", "#c68642", "#c68642", "#c68642", "#c68642", "#c68642", 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, "#c68642", "#c68642", "#c68642", "#c68642", "#c68642", "#c68642", 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, "#c68642", "#2b2b2b", "#c68642", "#c68642", "#2b2b2b", "#c68642", 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, "#c68642", "#c68642", "#c68642", "#c68642", "#c68642", "#c68642", 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, "#c68642", "#ff9999", "#c68642", "#c68642", "#ff9999", "#c68642", 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, "#a86b3a", "#a86b3a", "#a86b3a", "#a86b3a", "#a86b3a", "#a86b3a", 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, "#c68642", "#c68642", "#c68642", "#c68642", 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, "#c68642", "#c68642", "#c68642", "#c68642", "#c68642", "#c68642", "#c68642", "#c68642", 0, 0, 0, 0], [0, 0, 0, 0, "#c68642", "#c68642", "#c68642", "#c68642", "#c68642", "#c68642", "#c68642", "#c68642", 0, 0, 0, 0], [0, 0, 0, 0, "#c68642", "#c68642", "#c68642", "#c68642", "#c68642", "#c68642", "#c68642", "#c68642", 0, 0, 0, 0], [0, 0, 0, 0, "#c68642", "#c68642", "#c68642", "#c68642", "#c68642", "#c68642", "#c68642", "#c68642", 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, "#c68642", "#c68642", "#c68642", "#c68642", 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, "#a86b3a", "#a86b3a", "#a86b3a", "#a86b3a", 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, "#a86b3a", "#a86b3a", "#a86b3a", "#a86b3a", 0, 0, 0, 0, 0, 0]], "다크톤": [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, "#8d5524", "#8d5524", "#8d5524", "#8d5524", "#8d5524", "#8d5524", 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, "#8d5524", "#8d5524", "#8d5524", "#8d5524", "#8d5524", "#8d5524", 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, "#8d5524", "#2b2b2b", "#8d5524", "#8d5524", "#2b2b2b", "#8d5524", 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, "#8d5524", "#8d5524", "#8d5524", "#8d5524", "#8d5524", "#8d5524", 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, "#8d5524", "#ffaa99", "#8d5524", "#8d5524", "#ffaa99", "#8d5524", 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, "#704015", "#704015", "#704015", "#704015", "#704015", "#704015", 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, "#8d5524", "#8d5524", "#8d5524", "#8d5524", 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, "#8d5524", "#8d5524", "#8d5524", "#8d5524", "#8d5524", "#8d5524", "#8d5524", "#8d5524", 0, 0, 0, 0], [0, 0, 0, 0, "#8d5524", "#8d5524", "#8d5524", "#8d5524", "#8d5524", "#8d5524", "#8d5524", "#8d5524", 0, 0, 0, 0], [0, 0, 0, 0, "#8d5524", "#8d5524", "#8d5524", "#8d5524", "#8d5524", "#8d5524", "#8d5524", "#8d5524", 0, 0, 0, 0], [0, 0, 0, 0, "#8d5524", "#8d5524", "#8d5524", "#8d5524", "#8d5524", "#8d5524", "#8d5524", "#8d5524", 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, "#8d5524", "#8d5524", "#8d5524", "#8d5524", 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, "#704015", "#704015", "#704015", "#704015", 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, "#704015", "#704015", "#704015", "#704015", 0, 0, 0, 0, 0, 0]]}, "hair": {"짧은머리_브라운": [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, "#6b4423", "#6b4423", "#6b4423", "#6b4423", "#6b4423", "#6b4423", 0, 0, 0, 0, 0], [0, 0, 0, 0, "#6b4423", "#6b4423", "#6b4423", "#6b4423", "#6b4423", "#6b4423", "#6b4423", "#6b4423", 0, 0, 0, 0], [0, 0, 0, 0, "#6b4423", "#6b4423", "#6b4423", "#6b4423", "#6b4423", "#6b4423", "#6b4423", "#6b4423", 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]], "짧은머리_블랙": [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, "#2b2b2b", "#2b2b2b", "#2b2b2b", "#2b2b2b", "#2b2b2b", "#2b2b2b", 0, 0, 0, 0, 0], [0, 0, 0, 0, "#2b2b2b", "#2b2b2b", "#2b2b2b", "#2b2b2b", "#2b2b2b", "#2b2b2b", "#2b2b2b", "#2b2b2b", 0, 0, 0, 0], [0, 0, 0, 0, "#2b2b2b", "#2b2b2b", "#2b2b2b", "#2b2b2b", "#2b2b2b", "#2b2b2b", "#2b2b2b", "#2b2b2b", 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]], "긴머리_퍼플": [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, "#7c3aed", "#7c3aed", "#7c3aed", "#7c3aed", "#7c3aed", "#7c3aed", 0, 0, 0, 0, 0], [0, 0, 0, 0, "#7c3aed", "#7c3aed", "#7c3aed", "#7c3aed", "#7c3aed", "#7c3aed", "#7c3aed", "#7c3aed", 0, 0, 0, 0], [0, 0, 0, 0, "#7c3aed", "#7c3aed", "#7c3aed", "#7c3aed", "#7c3aed", "#7c3aed", "#7c3aed", "#7c3aed", 0, 0, 0, 0], [0, 0, 0, 0, "#7c3aed", 0, 0, 0, 0, 0, 0, "#7c3aed", 0, 0, 0, 0], [0, 0, 0, 0, "#7c3aed", 0, 0, 0, 0, 0, 0, "#7c3aed", 0, 0, 0, 0], [0, 0, 0, 0, "#7c3aed", 0, 0, 0, 0, 0, 0, "#7c3aed", 0, 0, 0, 0], [0, 0, 0, 0, "#7c3aed", 0, 0, 0, 0, 0, 0, "#7c3aed", 0, 0, 0, 0], [0, 0, 0, 0, "#7c3aed", 0, 0, 0, 0, 0, 0, "#7c3aed", 0, 0, 0, 0], [0, 0, 0, 0, "#7c3aed", 0, 0, 0, 0, 0, 0, "#7c3aed", 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]], "포니테일_레드": [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, "#c0392b", "#c0392b", "#c0392b", "#c0392b", "#c0392b", "#c0392b", 0, 0, 0, 0, 0], [0, 0, 0, 0, "#c0392b", "#c0392b", "#c0392b", "#c0392b", "#c0392b", "#c0392b", "#c0392b", "#c0392b", 0, 0, 0, 0], [0, 0, 0, 0, 0, "#c0392b", "#c0392b", "#c0392b", "#c0392b", "#c0392b", "#c0392b", "#c0392b", "#c0392b", 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "#c0392b", "#c0392b", 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "#c0392b", "#c0392b", 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "#c0392b", "#c0392b", 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "#c0392b", "#c0392b", 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]], "황금머리": [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, "#ffd700", "#ffd700", "#fff8dc", "#fff8dc", "#ffd700", "#ffd700", 0, 0, 0, 0, 0], [0, 0, 0, 0, "#ffd700", "#ffd700", "#ffd700", "#ffd700", "#ffd700", "#ffd700", "#ffd700", "#ffd700", 0, 0, 0, 0], [0, 0, 0, 0, "#ffd700", "#ffd700", "#ffd700", "#ffd700", "#ffd700", "#ffd700", "#ffd700", "#ffd700", 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]], "단발머리_블루": [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, "#3b82f6", "#3b82f6", "#3b82f6", "#3b82f6", "#3b82f6", "#3b82f6", "#3b82f6", "#3b82f6", 0, 0, 0, 0], [0, 0, 0, 0, "#3b82f6", "#3b82f6", "#3b82f6", "#3b82f6", "#3b82f6", "#3b82f6", "#3b82f6", "#3b82f6", 0, 0, 0, 0], [0, 0, 0, 0, "#3b82f6", "#3b82f6", "#3b82f6", "#3b82f6", "#3b82f6", "#3b82f6", "#3b82f6", "#3b82f6", 0, 0, 0, 0], [0, 0, 0, 0, "#3b82f6", "#3b82f6", 0, 0, 0, 0, "#3b82f6", "#3b82f6", 0, 0, 0, 0], [0, 0, 0, 0, "#3b82f6", "#3b82f6", 0, 0, 0, 0, "#3b82f6", "#3b82f6", 0, 0, 0, 0], [0, 0, 0, 0, "#3b82f6", "#3b82f6", 0, 0, 0, 0, "#3b82f6", "#3b82f6", 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]]}, "outfits": {"기본옷": [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, "#4a90d9", "#4a90d9", "#4a90d9", "#4a90d9", 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, "#4a90d9", "#4a90d9", "#4a90d9", "#4a90d9", "#4a90d9", "#4a90d9", "#4a90d9", "#4a90d9", 0, 0, 0, 0], [0, 0, 0, 0, "#4a90d9", "#4a90d9", "#4a90d9", "#4a90d9", "#4a90d9", "#4a90d9", "#4a90d9", "#4a90d9", 0, 0, 0, 0], [0, 0, 0, 0, "#4a90d9", "#4a90d9", "#4a90d9", "#4a90d9", "#4a90d9", "#4a90d9", "#4a90d9", "#4a90d9", 0, 0, 0, 0], [0, 0, 0, 0, "#4a90d9", "#4a90d9", "#4a90d9", "#4a90d9", "#4a90d9", "#4a90d9", "#4a90d9", "#4a90d9", 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, "#4a90d9", "#4a90d9", "#4a90d9", "#4a90d9", 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]], "갑옷": [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, "#888899", "#888899", "#888899", "#888899", 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, "#888899", "#888899", "#888899", "#ffd700", "#ffd700", "#888899", "#888899", "#888899", 0, 0, 0, 0], [0, 0, 0, 0, "#888899", "#888899", "#888899", "#ffd700", "#ffd700", "#888899", "#888899", "#888899", 0, 0, 0, 0], [0, 0, 0, 0, "#888899", "#888899", "#888899", "#888899", "#888899", "#888899", "#888899", "#888899", 0, 0, 0, 0], [0, 0, 0, 0, "#888899", "#888899", "#ffd700", "#888899", "#888899", "#ffd700", "#888899", "#888899", 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, "#888899", "#888899", "#888899", "#888899", 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]], "마법사로브": [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, "#3a2a6a", "#3a2a6a", "#a855f7", "#a855f7", "#3a2a6a", "#3a2a6a", 0, 0, 0, 0, 0], [0, 0, 0, 0, "#3a2a6a", "#3a2a6a", "#3a2a6a", "#a855f7", "#a855f7", "#3a2a6a", "#3a2a6a", "#3a2a6a", 0, 0, 0, 0], [0, 0, 0, 0, "#3a2a6a", "#3a2a6a", "#3a2a6a", "#3a2a6a", "#3a2a6a", "#3a2a6a", "#3a2a6a", "#3a2a6a", 0, 0, 0, 0], [0, 0, 0, 0, "#3a2a6a", "#3a2a6a", "#3a2a6a", "#3a2a6a", "#3a2a6a", "#3a2a6a", "#3a2a6a", "#3a2a6a", 0, 0, 0, 0], [0, 0, 0, 0, "#3a2a6a", "#3a2a6a", "#3a2a6a", "#3a2a6a", "#3a2a6a", "#3a2a6a", "#3a2a6a", "#3a2a6a", 0, 0, 0, 0], [0, 0, 0, 0, 0, "#3a2a6a", "#3a2a6a", "#3a2a6a", "#3a2a6a", "#3a2a6a", "#3a2a6a", 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, "#3a2a6a", "#3a2a6a", "#3a2a6a", "#3a2a6a", "#3a2a6a", "#3a2a6a", 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, "#3a2a6a", "#3a2a6a", "#3a2a6a", "#3a2a6a", "#3a2a6a", "#3a2a6a", 0, 0, 0, 0, 0]], "초록옷": [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, "#2e8b57", "#2e8b57", "#2e8b57", "#2e8b57", 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, "#2e8b57", "#2e8b57", "#2e8b57", "#2e8b57", "#2e8b57", "#2e8b57", "#2e8b57", "#2e8b57", 0, 0, 0, 0], [0, 0, 0, 0, "#2e8b57", "#2e8b57", "#2e8b57", "#2e8b57", "#2e8b57", "#2e8b57", "#2e8b57", "#2e8b57", 0, 0, 0, 0], [0, 0, 0, 0, "#2e8b57", "#2e8b57", "#2e8b57", "#2e8b57", "#2e8b57", "#2e8b57", "#2e8b57", "#2e8b57", 0, 0, 0, 0], [0, 0, 0, 0, "#2e8b57", "#2e8b57", "#2e8b57", "#2e8b57", "#2e8b57", "#2e8b57", "#2e8b57", "#2e8b57", 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, "#2e8b57", "#2e8b57", "#2e8b57", "#2e8b57", 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]], "닌자복": [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, "#1f2937", "#1f2937", "#1f2937", "#1f2937", "#1f2937", "#1f2937", 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, "#1f2937", "#1f2937", "#ef4444", "#ef4444", "#1f2937", "#1f2937", 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, "#1f2937", "#1f2937", "#1f2937", "#1f2937", "#1f2937", "#1f2937", 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, "#1f2937", "#1f2937", "#1f2937", "#1f2937", "#1f2937", "#1f2937", 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, "#1f2937", "#1f2937", "#1f2937", "#1f2937", 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, "#1f2937", "#1f2937", "#1f2937", "#1f2937", "#1f2937", "#1f2937", "#1f2937", "#1f2937", 0, 0, 0, 0], [0, 0, 0, 0, "#1f2937", "#1f2937", "#1f2937", "#1f2937", "#1f2937", "#1f2937", "#1f2937", "#1f2937", 0, 0, 0, 0], [0, 0, 0, 0, "#1f2937", "#1f2937", "#1f2937", "#1f2937", "#1f2937", "#1f2937", "#1f2937", "#1f2937", 0, 0, 0, 0], [0, 0, 0, 0, "#1f2937", "#1f2937", "#1f2937", "#1f2937", "#1f2937", "#1f2937", "#1f2937", "#1f2937", 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, "#1f2937", "#1f2937", "#1f2937", "#1f2937", 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]], "전설의망토": [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, "#facc15", "#facc15", "#4a90d9", "#4a90d9", "#4a90d9", "#4a90d9", "#4a90d9", "#4a90d9", "#facc15", "#facc15", 0, 0, 0], [0, 0, 0, "#facc15", "#facc15", "#4a90d9", "#4a90d9", "#4a90d9", "#4a90d9", "#4a90d9", "#4a90d9", "#facc15", "#facc15", 0, 0, 0], [0, 0, 0, "#facc15", "#facc15", "#4a90d9", "#4a90d9", "#4a90d9", "#4a90d9", "#4a90d9", "#4a90d9", "#facc15", "#facc15", 0, 0, 0], [0, 0, 0, "#facc15", "#facc15", "#4a90d9", "#4a90d9", "#4a90d9", "#4a90d9", "#4a90d9", "#4a90d9", "#facc15", "#facc15", 0, 0, 0], [0, 0, 0, "#facc15", "#facc15", "#4a90d9", "#4a90d9", "#4a90d9", "#4a90d9", "#4a90d9", "#4a90d9", "#facc15", "#facc15", 0, 0, 0], [0, 0, 0, "#facc15", "#facc15", "#4a90d9", "#4a90d9", "#4a90d9", "#4a90d9", "#4a90d9", "#4a90d9", "#facc15", "#facc15", 0, 0, 0], [0, 0, 0, "#dc2626", "#dc2626", "#dc2626", "#dc2626", "#dc2626", "#dc2626", "#dc2626", "#dc2626", "#dc2626", "#dc2626", 0, 0, 0], [0, 0, 0, "#dc2626", "#dc2626", "#dc2626", "#dc2626", "#dc2626", "#dc2626", "#dc2626", "#dc2626", "#dc2626", "#dc2626", 0, 0, 0]]}, "hats": {"없음": [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]], "야구모자": [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, "#e74c3c", "#e74c3c", "#e74c3c", "#e74c3c", "#e74c3c", "#e74c3c", 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, "#e74c3c", "#e74c3c", "#e74c3c", "#e74c3c", "#e74c3c", "#e74c3c", "#e74c3c", "#e74c3c", 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, "#e74c3c", "#e74c3c", "#e74c3c", "#e74c3c", 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]], "마법사모자": [[0, 0, 0, 0, 0, 0, 0, "#3a2a6a", "#3a2a6a", 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, "#3a2a6a", "#3a2a6a", "#ffd700", "#3a2a6a", 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, "#3a2a6a", "#ffd700", "#3a2a6a", "#3a2a6a", "#3a2a6a", "#3a2a6a", 0, 0, 0, 0, 0], [0, 0, 0, 0, "#3a2a6a", "#3a2a6a", "#3a2a6a", "#3a2a6a", "#3a2a6a", "#3a2a6a", "#3a2a6a", "#3a2a6a", 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]], "왕관": [[0, 0, 0, 0, 0, "#ffd700", 0, "#ffd700", "#ffd700", 0, "#ffd700", 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, "#ffd700", "#ffd700", "#ff4444", "#ff4444", "#ffd700", "#ffd700", 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, "#ffd700", "#ffd700", "#ffd700", "#ffd700", "#ffd700", "#ffd700", 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]], "머리띠": [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, "#f39c12", "#f39c12", "#f39c12", "#ffffff", "#ffffff", "#f39c12", "#f39c12", "#f39c12", 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]], "졸업모": [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, "#1f2937", "#1f2937", "#1f2937", "#1f2937", "#1f2937", "#1f2937", "#1f2937", "#1f2937", "#1f2937", "#1f2937", 0, 0, 0], [0, 0, 0, "#1f2937", "#1f2937", "#1f2937", "#1f2937", "#1f2937", "#1f2937", "#1f2937", "#1f2937", "#1f2937", "#ffd700", 0, 0, 0], [0, 0, 0, 0, 0, 0, "#1f2937", "#1f2937", "#1f2937", "#1f2937", 0, 0, 0, "#ffd700", 0, 0], [0, 0, 0, 0, 0, 0, "#1f2937", "#1f2937", "#1f2937", "#1f2937", 0, 0, 0, "#ffd700", 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "#ffd700", 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]]}, "weapons": {"없음": [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]], "검": [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "#cfd8e3", 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "#cfd8e3", 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "#cfd8e3", 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "#cfd8e3", 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "#cfd8e3", 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "#cfd8e3", 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "#cfd8e3", 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "#8b5e34", "#8b5e34", "#8b5e34", 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "#8b5e34", "#8b5e34", "#8b5e34", 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "#8b5e34", 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "#8b5e34", 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]], "마법지팡이": [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "#00e5ff", 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "#00e5ff", "#8b5e34", "#00e5ff", 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "#8b5e34", 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "#8b5e34", 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "#8b5e34", 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "#8b5e34", 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "#8b5e34", 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "#8b5e34", 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "#8b5e34", 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "#8b5e34", 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]], "책": [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "#c0392b", "#c0392b", "#c0392b", "#c0392b", 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "#c0392b", "#fdf6e3", "#fdf6e3", "#c0392b", 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "#c0392b", "#fdf6e3", "#fdf6e3", "#c0392b", 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "#c0392b", "#fdf6e3", "#fdf6e3", "#c0392b", 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "#c0392b", "#c0392b", "#c0392b", "#c0392b", 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]], "방패": [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "#9aa5b1", "#9aa5b1", "#9aa5b1", "#9aa5b1", 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "#9aa5b1", "#ffd700", "#ffd700", "#9aa5b1", 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "#9aa5b1", "#ffd700", "#ffd700", "#9aa5b1", 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "#9aa5b1", "#ffd700", "#ffd700", "#9aa5b1", 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "#9aa5b1", "#9aa5b1", "#9aa5b1", "#9aa5b1", 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]], "활": [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "#8b5e34", "#8b5e34", 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "#fdf6e3", "#8b5e34", "#8b5e34", 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "#fdf6e3", "#8b5e34", "#8b5e34", 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "#fdf6e3", "#8b5e34", "#8b5e34", 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "#fdf6e3", "#8b5e34", "#8b5e34", 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "#fdf6e3", "#8b5e34", "#8b5e34", 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "#fdf6e3", "#8b5e34", "#8b5e34", 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "#fdf6e3", "#8b5e34", "#8b5e34", 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "#fdf6e3", "#8b5e34", "#8b5e34", 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "#fdf6e3", "#8b5e34", "#8b5e34", 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "#fdf6e3", "#8b5e34", "#8b5e34", 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "#8b5e34", "#8b5e34", 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]]}, "pets": {"없음": [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]], "고양이": [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, "#f5a623", 0, 0, "#f5a623", 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, "#f5a623", 0, 0, 0, 0, 0, 0, "#f5a623", 0, 0, 0, 0], [0, 0, 0, 0, 0, "#f5a623", "#f5a623", "#f5a623", "#f5a623", "#f5a623", "#f5a623", 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, "#f5a623", "#222222", "#f5a623", "#f5a623", "#222222", "#f5a623", 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, "#f5a623", "#f5a623", "#f5a623", "#f5a623", "#f5a623", "#f5a623", 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, "#f5a623", "#f5a623", "#f5a623", "#f5a623", "#f5a623", "#f5a623", "#f5a623", "#f5a623", "#f5a623", 0, 0], [0, 0, 0, 0, 0, "#f5a623", "#f5a623", "#f5a623", "#f5a623", "#f5a623", "#f5a623", "#f5a623", "#f5a623", "#f5a623", 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]], "부엉이": [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, "#8b5e34", "#8b5e34", "#8b5e34", "#8b5e34", "#8b5e34", "#8b5e34", 0, 0, 0, 0, 0], [0, 0, 0, 0, "#8b5e34", "#8b5e34", "#8b5e34", "#8b5e34", "#8b5e34", "#8b5e34", "#8b5e34", "#8b5e34", 0, 0, 0, 0], [0, 0, 0, 0, "#8b5e34", "#8b5e34", "#ffd700", "#8b5e34", "#8b5e34", "#ffd700", "#8b5e34", "#8b5e34", 0, 0, 0, 0], [0, 0, 0, 0, "#8b5e34", "#8b5e34", "#8b5e34", "#8b5e34", "#8b5e34", "#8b5e34", "#8b5e34", "#8b5e34", 0, 0, 0, 0], [0, 0, 0, 0, 0, "#8b5e34", "#8b5e34", "#ffd700", "#ffd700", "#8b5e34", "#8b5e34", 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, "#8b5e34", "#8b5e34", "#ffd700", "#ffd700", "#8b5e34", "#8b5e34", 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, "#8b5e34", "#8b5e34", "#8b5e34", "#8b5e34", "#8b5e34", "#8b5e34", 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, "#8b5e34", "#8b5e34", "#8b5e34", "#8b5e34", "#8b5e34", "#8b5e34", 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]], "드래곤": [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, "#2e8b57", 0, 0, 0, 0, 0, 0, 0, "#2e8b57", 0, 0, 0], [0, 0, 0, 0, 0, "#2e8b57", "#2e8b57", "#2e8b57", "#2e8b57", "#2e8b57", "#2e8b57", "#2e8b57", 0, 0, 0, 0], [0, 0, 0, 0, 0, "#2e8b57", "#2e8b57", "#2e8b57", "#2e8b57", "#2e8b57", "#2e8b57", "#2e8b57", 0, 0, 0, 0], [0, 0, 0, 0, 0, "#2e8b57", "#2e8b57", "#ffd700", "#2e8b57", "#2e8b57", "#ffd700", "#2e8b57", 0, 0, 0, 0], [0, 0, 0, 0, 0, "#2e8b57", "#2e8b57", "#2e8b57", "#2e8b57", "#2e8b57", "#2e8b57", "#2e8b57", 0, 0, 0, 0], [0, 0, 0, 0, 0, "#2e8b57", "#2e8b57", "#2e8b57", "#2e8b57", "#2e8b57", "#2e8b57", "#2e8b57", "#ffd700", "#ffd700", "#ffd700", 0], [0, 0, 0, 0, 0, "#2e8b57", "#2e8b57", "#2e8b57", "#2e8b57", "#2e8b57", "#2e8b57", "#2e8b57", "#ffd700", "#ffd700", "#ffd700", 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]], "슬라임": [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, "#3498db", "#3498db", "#3498db", "#3498db", "#3498db", "#3498db", 0, 0, 0, 0, 0], [0, 0, 0, 0, "#3498db", "#3498db", "#3498db", "#3498db", "#3498db", "#3498db", "#3498db", "#3498db", 0, 0, 0, 0], [0, 0, 0, 0, 0, "#3498db", "#ffffff", "#3498db", "#3498db", "#ffffff", "#3498db", 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, "#3498db", "#3498db", "#3498db", "#3498db", "#3498db", "#3498db", 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, "#3498db", "#3498db", "#3498db", "#3498db", "#3498db", "#3498db", 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]], "여우": [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, "#f97316", 0, "#f97316", 0, 0, "#f97316", 0, "#f97316", 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, "#f97316", "#f97316", "#f97316", "#f97316", "#f97316", "#f97316", 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, "#f97316", "#1f2937", "#f97316", "#f97316", "#1f2937", "#f97316", 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, "#f97316", "#f97316", "#f97316", "#f97316", "#f97316", "#f97316", "#f97316", "#f97316", "#f97316", "#f97316", 0], [0, 0, 0, 0, 0, "#f97316", "#f97316", "#f97316", "#f97316", "#f97316", "#f97316", "#f97316", "#f97316", "#ffffff", "#ffffff", 0], [0, 0, 0, 0, 0, "#f97316", "#f97316", "#f97316", "#f97316", "#f97316", "#f97316", 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]]}, "palette": {"0": "transparent", "1": "#ffd9b3", "2": "#e0a878", "3": "#2b2b2b", "4": "#ff8888"}};

const ITEM_CATALOG = [{"id": "hair_brown", "name": "짧은머리(브라운)", "slot": "hair", "sprite": "짧은머리_브라운", "rarity": "common", "unlock": {"type": "default"}}, {"id": "outfit_basic", "name": "기본 옷", "slot": "outfit", "sprite": "기본옷", "rarity": "common", "unlock": {"type": "default"}}, {"id": "hat_none", "name": "모자 없음", "slot": "hat", "sprite": "없음", "rarity": "common", "unlock": {"type": "default"}}, {"id": "weapon_none", "name": "맨손", "slot": "weapon", "sprite": "없음", "rarity": "common", "unlock": {"type": "default"}}, {"id": "pet_none", "name": "펫 없음", "slot": "pet", "sprite": "없음", "rarity": "common", "unlock": {"type": "default"}}, {"id": "hair_black", "name": "짧은머리(블랙)", "slot": "hair", "sprite": "짧은머리_블랙", "rarity": "common", "unlock": {"type": "level", "value": 2}}, {"id": "hat_cap", "name": "야구모자", "slot": "hat", "sprite": "야구모자", "rarity": "common", "unlock": {"type": "level", "value": 2}}, {"id": "weapon_shield", "name": "방패", "slot": "weapon", "sprite": "방패", "rarity": "common", "unlock": {"type": "level", "value": 3}}, {"id": "hair_pony", "name": "포니테일(레드)", "slot": "hair", "sprite": "포니테일_레드", "rarity": "rare", "unlock": {"type": "level", "value": 4}}, {"id": "outfit_green", "name": "초록 모험가옷", "slot": "outfit", "sprite": "초록옷", "rarity": "rare", "unlock": {"type": "level", "value": 5}}, {"id": "hat_band", "name": "머리띠", "slot": "hat", "sprite": "머리띠", "rarity": "common", "unlock": {"type": "level", "value": 3}}, {"id": "weapon_sword", "name": "용사의 검", "slot": "weapon", "sprite": "검", "rarity": "rare", "unlock": {"type": "level", "value": 6}}, {"id": "outfit_armor", "name": "강철 갑옷", "slot": "outfit", "sprite": "갑옷", "rarity": "epic", "unlock": {"type": "level", "value": 8}}, {"id": "hat_crown", "name": "왕관", "slot": "hat", "sprite": "왕관", "rarity": "epic", "unlock": {"type": "level", "value": 10}}, {"id": "hair_purple", "name": "긴머리(퍼플)", "slot": "hair", "sprite": "긴머리_퍼플", "rarity": "epic", "unlock": {"type": "level", "value": 7}}, {"id": "weapon_wand", "name": "마법 지팡이", "slot": "weapon", "sprite": "마법지팡이", "rarity": "rare", "unlock": {"type": "achievement", "game": "분수계단", "value": "clear5"}}, {"id": "outfit_robe", "name": "마법사 로브", "slot": "outfit", "sprite": "마법사로브", "rarity": "epic", "unlock": {"type": "achievement", "game": "분수계단", "value": "perfect_clear"}}, {"id": "hat_wizard", "name": "마법사 모자", "slot": "hat", "sprite": "마법사모자", "rarity": "epic", "unlock": {"type": "achievement", "game": "구구단", "value": "final_boss_win"}}, {"id": "weapon_book", "name": "지혜의 책", "slot": "weapon", "sprite": "책", "rarity": "rare", "unlock": {"type": "achievement", "game": "영단어정벌", "value": "perfect_stage"}}, {"id": "pet_cat", "name": "고양이", "slot": "pet", "sprite": "고양이", "rarity": "rare", "unlock": {"type": "level", "value": 3}}, {"id": "pet_owl", "name": "부엉이", "slot": "pet", "sprite": "부엉이", "rarity": "rare", "unlock": {"type": "achievement", "game": "한국사탐험", "value": "all_eras_clear"}}, {"id": "pet_slime", "name": "슬라임", "slot": "pet", "sprite": "슬라임", "rarity": "common", "unlock": {"type": "level", "value": 5}}, {"id": "pet_dragon", "name": "드래곤", "slot": "pet", "sprite": "드래곤", "rarity": "legendary", "unlock": {"type": "level", "value": 12}}, {"id": "body_basic", "name": "기본 피부", "slot": "body", "sprite": "기본", "rarity": "common", "unlock": {"type": "default"}}, {"id": "body_cool", "name": "쿨톤 피부", "slot": "body", "sprite": "쿨톤", "rarity": "common", "unlock": {"type": "level", "value": 2}}, {"id": "hair_gold", "name": "황금 머리카락", "slot": "hair", "sprite": "황금머리", "rarity": "legendary", "unlock": {"type": "level", "value": 9}}, {"id": "outfit_ninja", "name": "닌자 복장", "slot": "outfit", "sprite": "닌자복", "rarity": "epic", "unlock": {"type": "level", "value": 11}}, {"id": "weapon_bow", "name": "숙련의 활", "slot": "weapon", "sprite": "활", "rarity": "epic", "unlock": {"type": "achievement", "game": "지식탐험", "value": "perfect_사회"}}, {"id": "pet_fox", "name": "여우", "slot": "pet", "sprite": "여우", "rarity": "rare", "unlock": {"type": "achievement", "game": "짝꿍찾기", "value": "perfect_국어"}}, {"id": "hat_grad", "name": "졸업모", "slot": "hat", "sprite": "졸업모", "rarity": "epic", "unlock": {"type": "achievement", "game": "지식탐험", "value": "perfect_영어"}}, {"id": "outfit_cape", "name": "전설의 망토", "slot": "outfit", "sprite": "전설의망토", "rarity": "legendary", "unlock": {"type": "achievement", "game": "영단어정벌", "value": "combo20"}}, {"id": "body_warm", "name": "웜톤 피부", "slot": "body", "sprite": "웜톤", "rarity": "common", "unlock": {"type": "level", "value": 4}}, {"id": "body_dark", "name": "다크톤 피부", "slot": "body", "sprite": "다크톤", "rarity": "rare", "unlock": {"type": "achievement", "game": "빈칸마법사", "value": "perfect_영어"}}, {"id": "hair_bob", "name": "단발머리(블루)", "slot": "hair", "sprite": "단발머리_블루", "rarity": "rare", "unlock": {"type": "level", "value": 6}}];

// ---------------------------------------------------------
// 🏠 캐릭터 룸(꾸미기 공간) 아이템 카탈로그
// slot: 'wallpaper'(벽지), 'floor'(바닥) - 1개씩만 적용
//       'furniture' - 자유 배치 (여러개 보유 가능)
// ---------------------------------------------------------
const ROOM_ITEM_CATALOG = [
  { id: 'wall_basic',  name: '기본 벽지',     slot: 'wallpaper', emoji: '⬜', color: '#2a2a44', rarity: 'common',  unlock: { type: 'default' } },
  { id: 'wall_sky',    name: '하늘 벽지',     slot: 'wallpaper', emoji: '☁️', color: '#6ec6ff', rarity: 'common',  unlock: { type: 'level', value: 3 } },
  { id: 'wall_night',  name: '밤하늘 벽지',   slot: 'wallpaper', emoji: '🌌', color: '#1a1a40', rarity: 'rare',    unlock: { type: 'level', value: 7 } },
  { id: 'wall_castle', name: '성벽 벽지',     slot: 'wallpaper', emoji: '🏰', color: '#8d99ae', rarity: 'epic',    unlock: { type: 'achievement', game: '한국사탐험', value: 'all_eras_clear' } },

  { id: 'floor_wood',  name: '나무 바닥',     slot: 'floor', emoji: '🟫', color: '#a9764f', rarity: 'common', unlock: { type: 'default' } },
  { id: 'floor_grass', name: '잔디 바닥',     slot: 'floor', emoji: '🟩', color: '#5fae5f', rarity: 'common', unlock: { type: 'level', value: 4 } },
  { id: 'floor_marble',name: '대리석 바닥',   slot: 'floor', emoji: '⬛', color: '#cfd8e3', rarity: 'rare',   unlock: { type: 'level', value: 8 } },
  { id: 'floor_lava',  name: '용암 바닥',     slot: 'floor', emoji: '🟥', color: '#c1440e', rarity: 'legendary', unlock: { type: 'level', value: 12 } },

  { id: 'furn_bed',    name: '침대',          slot: 'furniture', emoji: '🛏️', rarity: 'common', unlock: { type: 'default' } },
  { id: 'furn_desk',   name: '책상',          slot: 'furniture', emoji: '🪑', rarity: 'common', unlock: { type: 'level', value: 2 } },
  { id: 'furn_plant',  name: '화분',          slot: 'furniture', emoji: '🪴', rarity: 'common', unlock: { type: 'level', value: 3 } },
  { id: 'furn_books',  name: '책장',          slot: 'furniture', emoji: '📚', rarity: 'common', unlock: { type: 'level', value: 5 } },
  { id: 'furn_clock',  name: '시계',          slot: 'furniture', emoji: '🕰️', rarity: 'common', unlock: { type: 'level', value: 6 } },
  { id: 'furn_globe',  name: '지구본',        slot: 'furniture', emoji: '🌍', rarity: 'rare',   unlock: { type: 'achievement', game: '지식탐험', value: 'perfect_사회' } },
  { id: 'furn_telescope', name: '망원경',     slot: 'furniture', emoji: '🔭', rarity: 'rare',   unlock: { type: 'level', value: 7 } },
  { id: 'furn_trophy', name: '트로피',        slot: 'furniture', emoji: '🏆', rarity: 'epic',   unlock: { type: 'achievement', game: '구구단', value: 'final_boss_win' } },
  { id: 'furn_piano',  name: '피아노',        slot: 'furniture', emoji: '🎹', rarity: 'rare',   unlock: { type: 'level', value: 9 } },
  { id: 'furn_aquarium', name: '수족관',      slot: 'furniture', emoji: '🐠', rarity: 'epic',   unlock: { type: 'achievement', game: '짝꿍찾기', value: 'perfect_과학' } },
  { id: 'furn_chest',  name: '보물상자',      slot: 'furniture', emoji: '🧰', rarity: 'epic',   unlock: { type: 'level', value: 10 } },
  { id: 'furn_castle', name: '레고 성',       slot: 'furniture', emoji: '🏯', rarity: 'legendary', unlock: { type: 'level', value: 11 } },
  { id: 'furn_cake',   name: '케이크',        slot: 'furniture', emoji: '🎂', rarity: 'rare',   unlock: { type: 'achievement', game: '영단어정벌', value: 'perfect_stage' } },
  { id: 'furn_rocket', name: '로켓 장난감',   slot: 'furniture', emoji: '🚀', rarity: 'epic',   unlock: { type: 'achievement', game: '빈칸마법사', value: 'perfect_국어' } },
];

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
        pet: 'pet_none'
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
    ITEM_CATALOG.forEach(it => {
      if (c.inventory.includes(it.id)) return;
      const cond = it.unlock;
      let unlocked = false;
      if (cond.type === 'default') unlocked = true;
      else if (cond.type === 'level') unlocked = c.level >= cond.value;
      else if (cond.type === 'achievement') unlocked = c.achievements.includes(cond.game + ':' + cond.value);
      if (unlocked) {
        c.inventory.push(it.id);
        newly.push(it);
      }
    });
    ROOM_ITEM_CATALOG.forEach(it => {
      if (c.roomInventory.includes(it.id)) return;
      const cond = it.unlock;
      let unlocked = false;
      if (cond.type === 'default') unlocked = true;
      else if (cond.type === 'level') unlocked = c.level >= cond.value;
      else if (cond.type === 'achievement') unlocked = c.achievements.includes(cond.game + ':' + cond.value);
      if (unlocked) {
        c.roomInventory.push(it.id);
        newly.push(it);
      }
    });
    return newly;
  }

  /**
   * EXP 추가. 레벨업 시 자동으로 레벨/아이템 갱신.
   * 반환: { leveledUp:bool, newLevel, newItems:[...] }
   */
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
    if (!item || item.slot !== slot) return false;
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
    return ITEM_CATALOG.filter(it => it.slot === slot).map(it => Object.assign({}, it, { unlocked: owned.has(it.id) }));
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
    if (item.unlock.type === 'level') return `Lv.${item.unlock.value} 달성 시 해금`;
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
    const petItem = getItemById(equipped.pet);

    const layers = [
      bodyItem && SPRITE_DATA.bodies[bodyItem.sprite],
      outfitItem && SPRITE_DATA.outfits[outfitItem.sprite],
      hairItem && SPRITE_DATA.hair[hairItem.sprite],
      hatItem && SPRITE_DATA.hats[hatItem.sprite],
      weaponItem && SPRITE_DATA.weapons[weaponItem.sprite],
    ];
    layers.forEach(g => { if (g) _drawGrid(ctx, g, scale, 0, 0); });

    if (petItem && petItem.sprite !== '없음') {
      const petGrid = SPRITE_DATA.pets[petItem.sprite];
      if (petGrid) _drawGrid(ctx, petGrid, scale * 0.7, 16 * scale * 0.15, 16 * scale * 0.55);
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
    SUBJECTS, MIN_GRADE, MAX_GRADE,
    listUsers, getCurrentUser, getCurrentUserName,
    createOrSwitchUser, switchUser, deleteUser, logout,
    getGrade, setGrade, evaluateLevel, gradeToTier, gradeLabel,
    recordAnswer, getReviewQueue, getReviewCount,
    recordPlay, getStats, getAllStats, getWrongBankSummary,
    renderProfileBadge, injectLoginModal, escapeHtml,
    // 캐릭터/아이템/EXP
    ITEM_CATALOG, SPRITE_DATA, LEVEL_EXP,
    getCharacter, addExp, unlockAchievement, equipItem,
    getInventoryBySlot, getAllItemsBySlot, describeUnlock, getItemById,
    ROOM_ITEM_CATALOG, getRoom, getRoomItemById, getRoomInventoryBySlot, getAllRoomItemsBySlot,
    setWallpaper, setFloor, toggleFurniture,
    renderCharacter, renderCurrentCharacter,
    showToast, announceExpResult, injectBackLink
  };
})(window);
