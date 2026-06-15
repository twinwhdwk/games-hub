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
        color:#c4cde0; font-size:0.82rem; cursor:pointer; transition:.15s; }
      .lh-user-chip:hover { border-color:#7c7cff; color:#fff; background:rgba(124,124,255,0.15); }
    `;
    document.head.appendChild(style);
    document.body.appendChild(overlay);

    const users = listUsers();
    if (users.length) {
      const wrap = overlay.querySelector('#lh-login-users');
      users.slice(0, 8).forEach(name => {
        const chip = document.createElement('div');
        chip.className = 'lh-user-chip';
        chip.textContent = '👤 ' + name;
        chip.onclick = () => { switchUser(name); finish(); };
        wrap.appendChild(chip);
      });
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

  global.LearningHub = {
    SUBJECTS, MIN_GRADE, MAX_GRADE,
    listUsers, getCurrentUser, getCurrentUserName,
    createOrSwitchUser, switchUser, deleteUser, logout,
    getGrade, setGrade, evaluateLevel, gradeToTier, gradeLabel,
    recordAnswer, getReviewQueue, getReviewCount,
    recordPlay, getStats,
    renderProfileBadge, injectLoginModal, escapeHtml
  };
})(window);
