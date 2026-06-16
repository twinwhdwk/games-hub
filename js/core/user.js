/**
 * @file js/core/user.js  v2
 * 사용자 CRUD, 학년, 오답노트, 출석 스트릭, 통계.
 * Store 에만 의존. Items 참조 제거 — 해금은 EventBus 통해 트리거.
 */
'use strict';
(function(global) {

const SUBJECTS = ['수학', '영어', '국어', '사회', '과학'];
const TIER_GRADES = {
  elementary: { min: 3, max: 6 },
  middle:     { min: 7, max: 9 },
  high:       { min: 10, max: 12 },
};

function getTier(g) {
  return g <= 6 ? 'elementary' : g <= 9 ? 'middle' : 'high';
}
function gradeLabel(g) {
  return g <= 6 ? `초${g}` : g <= 9 ? `중${g-6}` : `고${g-9}`;
}
function gradeFullLabel(g) {
  return g <= 6 ? `초등 ${g}학년` : g <= 9 ? `중등 ${g-6}학년` : `고등 ${g-9}학년`;
}

function defaultGrades() {
  const r = {};
  SUBJECTS.forEach(s => { r[s] = TIER_GRADES.elementary.min; });
  return r;
}

function ensureUser(db, name) {
  if (!db.users[name]) {
    db.users[name] = { name, createdAt: Date.now(), grades: defaultGrades(), stats: {}, wrongBank: [], streak: 0, lastVisitDate: null };
  }
  const u = db.users[name];
  if (!u.grades)   u.grades = defaultGrades();
  if (!u.stats)    u.stats  = {};
  if (!u.wrongBank) u.wrongBank = [];
  if (!u.streak)   u.streak = 0;
  SUBJECTS.forEach(s => { if (!u.grades[s]) u.grades[s] = TIER_GRADES.elementary.min; });
  return u;
}

// ── User ─────────────────────────────────────────────────
const User = {
  list() {
    const db = Store.load();
    return Object.keys(db.users).sort((a,b) => (db.users[b].createdAt||0) - (db.users[a].createdAt||0));
  },
  current() {
    const db = Store.load();
    if (!db.currentUser || !db.users[db.currentUser]) return null;
    return db.users[db.currentUser];
  },
  currentName() { return Store.load().currentUser; },
  createOrSwitch(name) {
    name = (name||'').trim();
    if (!name) return null;
    const result = Store.tx(db => { ensureUser(db, name); db.currentUser = name; return db.users[name]; });
    Bus?.emit?.('user:login', { name });
    return result;
  },
  switch(name) {
    const ok = Store.tx(db => { if (!db.users[name]) return false; db.currentUser = name; return db.users[name]; });
    if (ok) Bus?.emit?.('user:login', { name });
    return ok;
  },
  delete(name) {
    Store.tx(db => { delete db.users[name]; if (db.currentUser === name) db.currentUser = null; });
  },
  logout() {
    Store.tx(db => { db.currentUser = null; });
    Bus?.emit?.('user:logout', {});
  },
};

// ── Grade ─────────────────────────────────────────────────
const Grade = {
  get(subject) {
    const u = User.current();
    return u ? (u.grades[subject] || TIER_GRADES.elementary.min) : TIER_GRADES.elementary.min;
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
  evaluate(subject, accuracy, opts = {}) {
    const upTh   = opts.upThreshold   ?? 0.8;
    const downTh = opts.downThreshold ?? 0.4;
    const cur    = Grade.get(subject);
    const tier   = getTier(cur);
    const range  = TIER_GRADES[tier];
    const minG   = opts.minGrade ?? range.min;
    const maxG   = opts.maxGrade ?? range.max;
    let next = cur, direction = 'same';
    if (accuracy >= upTh && cur < maxG)    { next = cur + 1; direction = 'up'; }
    else if (accuracy < downTh && cur > minG) { next = cur - 1; direction = 'down'; }
    if (next !== cur) {
      Grade.set(subject, next);
      // 해금 체크는 EventBus 통해 Items 모듈이 처리
      Bus?.emit?.('grade:changed', { subject, oldGrade: cur, newGrade: next, direction });
    }
    return { changed: next !== cur, newGrade: next, oldGrade: cur, direction, tier };
  },
  SUBJECTS, TIER_GRADES, getTier, gradeLabel, gradeFullLabel,
};

// ── WrongBank ──────────────────────────────────────────────
const WrongBank = {
  record(opts) {
    const { gameId, subject, qKey, data, correct } = opts;
    Store.tx(db => {
      const name = db.currentUser;
      if (!name) return false;
      const u = ensureUser(db, name);
      let w = u.wrongBank.find(x => x.gameId === gameId && x.qKey === qKey);
      if (!w) {
        w = { gameId, subject, qKey, data, wrongCount:0, correctStreak:0, mastered:false, lastSeen:Date.now() };
        u.wrongBank.push(w);
      }
      w.lastSeen = Date.now();
      if (correct) { w.correctStreak = (w.correctStreak||0)+1; if (w.correctStreak>=2) w.mastered=true; }
      else          { w.wrongCount++; w.correctStreak=0; w.mastered=false; }
    });
    Bus?.emit?.('answer:recorded', { gameId, subject, correct });
  },
  review(gameId, qKey, correct) {
    return Store.tx(db => {
      const name = db.currentUser;
      if (!name || !db.users[name]) return null;
      const w = db.users[name].wrongBank?.find(x => x.gameId===gameId && x.qKey===qKey);
      if (!w) return null;
      if (correct) { w.correctStreak=(w.correctStreak||0)+1; if(w.correctStreak>=2){w.mastered=true; Bus?.emit?.('wrong:mastered',{gameId,qKey});} }
      else          { w.wrongCount++; w.correctStreak=0; w.mastered=false; }
      w.lastSeen = Date.now();
      return { mastered:w.mastered, correctStreak:w.correctStreak, wrongCount:w.wrongCount };
    });
  },
  getItems(subject) {
    const u = User.current();
    if (!u) return [];
    let list = u.wrongBank.filter(w=>!w.mastered);
    if (subject) list = list.filter(w=>w.subject===subject);
    return list.slice().sort((a,b)=>b.wrongCount-a.wrongCount||(a.lastSeen-b.lastSeen))
               .map(w=>({qKey:w.qKey,gameId:w.gameId,subject:w.subject,wrongCount:w.wrongCount,correctStreak:w.correctStreak,data:w.data}));
  },
  getQueue(gameId, subject, limit=5) {
    const u = User.current();
    if (!u) return [];
    return u.wrongBank.filter(w=>w.gameId===gameId&&!w.mastered&&(!subject||w.subject===subject))
                      .sort((a,b)=>b.wrongCount-a.wrongCount).slice(0,limit).map(w=>w.data);
  },
  getCount(gameId, subject) {
    const u = User.current();
    if (!u) return 0;
    return u.wrongBank.filter(w=>w.gameId===gameId&&!w.mastered&&(!subject||w.subject===subject)).length;
  },
  getSummary() {
    const u = User.current();
    const r = {};
    SUBJECTS.forEach(s=>{r[s]={total:0,mastered:0,pending:0};});
    if (!u) return r;
    u.wrongBank.forEach(w=>{ if(!r[w.subject]) return; r[w.subject].total++; w.mastered?r[w.subject].mastered++:r[w.subject].pending++; });
    return r;
  },
};

// ── Streak ────────────────────────────────────────────────
const Streak = {
  check() {
    return Store.tx(db => {
      const name = db.currentUser;
      if (!name) return null;
      const u = ensureUser(db, name);
      const today = new Date().toISOString().slice(0,10);
      if (u.lastVisitDate === today) return { streak:u.streak||1, isNew:false, newItems:[] };
      const yesterday = new Date(Date.now()-864e5).toISOString().slice(0,10);
      u.streak = u.lastVisitDate===yesterday ? (u.streak||1)+1 : 1;
      u.lastVisitDate = today;
      Bus?.emit?.('streak:updated', { streak:u.streak, isNew:true });
      return { streak:u.streak, isNew:true, newItems:[] };
    });
  },
};

// ── Stats ─────────────────────────────────────────────────
const Stats = {
  record(gameId, result) {
    Store.tx(db => {
      const name = db.currentUser;
      if (!name || !db.users[name]) return false;
      const u = ensureUser(db, name);
      if (!u.stats[gameId]) u.stats[gameId] = { plays:0, totalScore:0, totalCorrect:0, totalQ:0, history:[] };
      const s = u.stats[gameId];
      s.plays++; s.totalScore+=result.score||0; s.totalCorrect+=result.correct||0; s.totalQ+=result.total||0;
      s.history.push({...result, ts:Date.now()});
      if (s.history.length>20) s.history=s.history.slice(-20);
    });
  },
  get(gameId) { const u=User.current(); return u?u.stats[gameId]||null:null; },
  getAll()    { const u=User.current(); return u?u.stats:{}; },
};

// Container 등록
if (global.Container) {
  Container.registerAll({ User, Grade, WrongBank, Streak, Stats });
}

global.User=User; global.Grade=Grade; global.WrongBank=WrongBank;
global.Streak=Streak; global.Stats=Stats;
})(window);
