/**
 * @file js/core/user.js
 * 사용자 CRUD, 학년(레벨) 관리, 오답 노트, 출석 스트릭.
 * Store에만 의존. UI/렌더링 없음.
 */
'use strict';
(function(global) {

const SUBJECTS = ['수학', '영어', '국어', '사회', '과학'];
const TIER_GRADES = {
  elementary: { min: 3, max: 6 },
  middle:     { min: 7, max: 9 },
  high:       { min: 10, max: 12 },
};

function getTier(grade) {
  if (grade <= 6) return 'elementary';
  if (grade <= 9) return 'middle';
  return 'high';
}

function gradeLabel(grade) {
  if (grade <= 6) return `초${grade}`;
  if (grade <= 9) return `중${grade - 6}`;
  return `고${grade - 9}`;
}

function gradeFullLabel(grade) {
  if (grade <= 6) return `초등 ${grade}학년`;
  if (grade <= 9) return `중등 ${grade - 6}학년`;
  return `고등 ${grade - 9}학년`;
}

// ── 기본 구조 ─────────────────────────────────────────────
function defaultGrades() {
  const g = {};
  SUBJECTS.forEach(s => { g[s] = TIER_GRADES.elementary.min; });
  return g;
}

function ensureUser(db, name) {
  if (!db.users[name]) {
    db.users[name] = {
      name,
      createdAt: Date.now(),
      grades: defaultGrades(),
      stats: {},
      wrongBank: [],
      streak: 0,
      lastVisitDate: null,
    };
  }
  const u = db.users[name];
  if (!u.grades) u.grades = defaultGrades();
  SUBJECTS.forEach(s => { if (!u.grades[s]) u.grades[s] = TIER_GRADES.elementary.min; });
  if (!u.stats) u.stats = {};
  if (!u.wrongBank) u.wrongBank = [];
  if (!u.streak) u.streak = 0;
  if (u.lastVisitDate === undefined) u.lastVisitDate = null;
  return u;
}

// ── 사용자 CRUD ────────────────────────────────────────────
const User = {
  list() {
    const db = Store.load();
    return Object.keys(db.users).sort((a, b) => (db.users[b].createdAt || 0) - (db.users[a].createdAt || 0));
  },

  current() {
    const db = Store.load();
    if (!db.currentUser || !db.users[db.currentUser]) return null;
    return db.users[db.currentUser];
  },

  currentName() {
    return Store.load().currentUser;
  },

  createOrSwitch(name) {
    name = (name || '').trim();
    if (!name) return null;
    return Store.tx(db => {
      ensureUser(db, name);
      db.currentUser = name;
      return db.users[name];
    });
  },

  switch(name) {
    return Store.tx(db => {
      if (!db.users[name]) return false;
      db.currentUser = name;
      return db.users[name];
    });
  },

  delete(name) {
    Store.tx(db => {
      delete db.users[name];
      if (db.currentUser === name) db.currentUser = null;
    });
  },

  logout() {
    Store.tx(db => { db.currentUser = null; });
  },
};

// ── 학년(레벨) 관리 ────────────────────────────────────────
const Grade = {
  get(subject) {
    const u = User.current();
    if (!u) return TIER_GRADES.elementary.min;
    return u.grades[subject] || TIER_GRADES.elementary.min;
  },

  set(subject, grade) {
    Store.tx(db => {
      const name = db.currentUser;
      if (!name || !db.users[name]) return false;
      const u = ensureUser(db, name);
      const tier = getTier(grade);
      const r = TIER_GRADES[tier];
      u.grades[subject] = Math.max(r.min, Math.min(r.max, grade));
    });
  },

  /**
   * 정확도 기반 학년 자동 조정
   * opts.minGrade / opts.maxGrade 로 tier 경계 지정 가능
   * 반환: { changed, newGrade, oldGrade, direction, tier }
   */
  evaluate(subject, accuracy, opts = {}) {
    const upTh   = opts.upThreshold   ?? 0.8;
    const downTh = opts.downThreshold ?? 0.4;
    const cur    = Grade.get(subject);
    const tier   = getTier(cur);
    const range  = TIER_GRADES[tier];
    const minG   = opts.minGrade ?? range.min;
    const maxG   = opts.maxGrade ?? range.max;

    let next = cur, direction = 'same';
    if (accuracy >= upTh && cur < maxG)   { next = cur + 1; direction = 'up'; }
    else if (accuracy < downTh && cur > minG) { next = cur - 1; direction = 'down'; }

    if (next !== cur) {
      Grade.set(subject, next);
      // 아이템 해금 체크 (Items 모듈 존재 시)
      if (global.Items) global.Items._checkUnlocks();
    }
    return { changed: next !== cur, newGrade: next, oldGrade: cur, direction, tier };
  },

  gradeLabel,
  gradeFullLabel,
  getTier,
  TIER_GRADES,
  SUBJECTS,
};

// ── 오답 노트 ──────────────────────────────────────────────
const WrongBank = {
  /**
   * 답변 기록 (정답/오답 모두)
   * opts: { gameId, subject, qKey, data, correct }
   */
  record(opts) {
    const { gameId, subject, qKey, data, correct } = opts;
    Store.tx(db => {
      const name = db.currentUser;
      if (!name) return false;
      const u = ensureUser(db, name);
      let w = u.wrongBank.find(x => x.gameId === gameId && x.qKey === qKey);
      if (!w) {
        w = { gameId, subject, qKey, data, wrongCount: 0, correctStreak: 0, mastered: false, lastSeen: Date.now() };
        u.wrongBank.push(w);
      }
      w.lastSeen = Date.now();
      if (correct) {
        w.correctStreak = (w.correctStreak || 0) + 1;
        if (w.correctStreak >= 2) w.mastered = true;
      } else {
        w.wrongCount++;
        w.correctStreak = 0;
        w.mastered = false;
      }
    });
  },

  /** 오답노트 전용 풀기 — 2연속 정답 시 mastered */
  review(gameId, qKey, correct) {
    return Store.tx(db => {
      const name = db.currentUser;
      if (!name) return null;
      const u = db.users[name];
      if (!u) return null;
      const w = u.wrongBank.find(x => x.gameId === gameId && x.qKey === qKey);
      if (!w) return null;
      if (correct) {
        w.correctStreak = (w.correctStreak || 0) + 1;
        if (w.correctStreak >= 2) w.mastered = true;
      } else {
        w.wrongCount++;
        w.correctStreak = 0;
        w.mastered = false;
      }
      w.lastSeen = Date.now();
      return { mastered: w.mastered, correctStreak: w.correctStreak, wrongCount: w.wrongCount };
    });
  },

  /** 미숙달 목록 반환 (subject 필터 선택) */
  getItems(subject) {
    const u = User.current();
    if (!u) return [];
    let list = u.wrongBank.filter(w => !w.mastered);
    if (subject) list = list.filter(w => w.subject === subject);
    return list.slice()
      .sort((a, b) => b.wrongCount - a.wrongCount || (a.lastSeen - b.lastSeen))
      .map(w => ({ qKey: w.qKey, gameId: w.gameId, subject: w.subject, wrongCount: w.wrongCount, correctStreak: w.correctStreak, data: w.data }));
  },

  /** 게임별 복습 큐 */
  getQueue(gameId, subject, limit = 5) {
    const u = User.current();
    if (!u) return [];
    return u.wrongBank
      .filter(w => w.gameId === gameId && !w.mastered && (!subject || w.subject === subject))
      .sort((a, b) => b.wrongCount - a.wrongCount)
      .slice(0, limit)
      .map(w => w.data);
  },

  getCount(gameId, subject) {
    const u = User.current();
    if (!u) return 0;
    return u.wrongBank.filter(w => w.gameId === gameId && !w.mastered && (!subject || w.subject === subject)).length;
  },

  getSummary() {
    const u = User.current();
    const result = {};
    SUBJECTS.forEach(s => { result[s] = { total: 0, mastered: 0, pending: 0 }; });
    if (!u) return result;
    u.wrongBank.forEach(w => {
      if (!result[w.subject]) return;
      result[w.subject].total++;
      if (w.mastered) result[w.subject].mastered++;
      else result[w.subject].pending++;
    });
    return result;
  },
};

// ── 출석 스트릭 ────────────────────────────────────────────
const Streak = {
  check() {
    return Store.tx(db => {
      const name = db.currentUser;
      if (!name) return null;
      const u = ensureUser(db, name);
      const today = new Date().toISOString().slice(0, 10);
      if (u.lastVisitDate === today) return { streak: u.streak || 1, isNew: false, newItems: [] };
      const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
      u.streak = u.lastVisitDate === yesterday ? (u.streak || 1) + 1 : 1;
      u.lastVisitDate = today;
      const newItems = global.Items ? global.Items._checkUnlocks() : [];
      return { streak: u.streak, isNew: true, newItems };
    });
  },
};

// ── 게임 통계 ─────────────────────────────────────────────
const Stats = {
  record(gameId, result) {
    Store.tx(db => {
      const name = db.currentUser;
      if (!name) return false;
      const u = ensureUser(db, name);
      if (!u.stats[gameId]) u.stats[gameId] = { plays: 0, totalScore: 0, totalCorrect: 0, totalQ: 0, history: [] };
      const s = u.stats[gameId];
      s.plays++;
      s.totalScore += result.score || 0;
      s.totalCorrect += result.correct || 0;
      s.totalQ += result.total || 0;
      s.history.push({ ...result, ts: Date.now() });
      if (s.history.length > 20) s.history = s.history.slice(-20);
    });
  },

  get(gameId) {
    const u = User.current();
    if (!u) return null;
    return u.stats[gameId] || null;
  },

  getAll() {
    const u = User.current();
    return u ? u.stats : {};
  },
};

global.User = User;
global.Grade = Grade;
global.WrongBank = WrongBank;
global.Streak = Streak;
global.Stats = Stats;
})(window);
