/**
 * @file js/game/quiz-engine.js  v2
 * 4지선다 퀴즈 엔진. Container 기반 의존성 주입 — global 직접 참조 없음.
 * 테스트 시 Container에 mock 주입 가능.
 */
'use strict';
(function(global) {

class QuizEngine {
  /**
   * @param {object} opts
   *   gameId, subject, tier, gradeRange, total, bankKey
   *   onQuestion(q, idx, total)
   *   onResult(isCorrect, q, stats)
   *   onEnd(summary)
   *   deps: { DataLoader, Grade, WrongBank, Items, Toast, User }  — DI 오버라이드용
   */
  constructor(opts) {
    this.gameId     = opts.gameId  || 'unknown';
    this.subject    = opts.subject || null;
    this.tier       = opts.tier    || null;
    this.gradeRange = opts.gradeRange || null;
    this.total      = opts.total   || 20;
    this.bankKey    = opts.bankKey || 'question_bank';

    this._onQuestion = opts.onQuestion || (() => {});
    this._onResult   = opts.onResult   || (() => {});
    this._onEnd      = opts.onEnd      || (() => {});

    // 의존성: Container 또는 직접 주입
    const C = global.Container;
    this._DL    = opts.deps?.DataLoader || C?.get?.('DataLoader') || global.DataLoader;
    this._Grade = opts.deps?.Grade      || C?.get?.('Grade')      || global.Grade;
    this._WB    = opts.deps?.WrongBank  || C?.get?.('WrongBank')  || global.WrongBank;
    this._Items = opts.deps?.Items      || C?.get?.('Items')      || global.Items;
    this._Toast = opts.deps?.Toast      || C?.get?.('Toast')      || global.Toast;
    this._User  = opts.deps?.User       || C?.get?.('User')       || global.User;

    this._pool    = [];
    this._queue   = [];
    this._idx     = 0;
    this._correct = 0;
    this._wrong   = 0;
    this._streak  = 0;
    this._best    = 0;
    this._answered = false;
    this._curGrade = 3;
  }

  async init() {
    const dl = this._DL;
    if (!dl) throw new Error('[QuizEngine] DataLoader 없음');

    if (!this.subject) {
      const bank = await dl.get(this.bankKey);
      let all = Object.entries(bank).flatMap(([subj, qs]) => qs.map(q=>({...q, subject:subj})));
      if (this.tier || this.gradeRange) {
        const [min,max] = this.gradeRange || ({elementary:[3,6],middle:[7,9],high:[10,12]}[this.tier]||[3,6]);
        all = all.filter(q=>q.grade>=min&&q.grade<=max);
      }
      this._pool = all;
    } else {
      const qs = await dl.filter(this.bankKey, { subject:this.subject, tier:this.tier, gradeRange:this.gradeRange });
      this._pool = qs.map(q=>({...q, subject:this.subject}));
    }

    if (this._Grade && this.subject) this._curGrade = this._Grade.get(this.subject);
    this._buildQueue();
    return this;
  }

  _buildQueue() {
    const g = this._curGrade;
    const pool = this._pool.filter(q=>Math.abs(q.grade-g)<=1);
    const base  = pool.length ? pool : this._pool;
    this._queue = [...base].sort(()=>Math.random()-.5).slice(0, this.total);
    this._idx=0; this._correct=0; this._wrong=0; this._streak=0;
  }

  start()   { this._idx=0; this._showCurrent(); }
  restart() { this._buildQueue(); this.start(); }
  next()    { this._showCurrent(); }

  get current()  { return this._queue[this._idx]||null; }
  get index()    { return this._idx; }
  get length()   { return this._queue.length; }
  get stats()    { return { correct:this._correct, wrong:this._wrong, streak:this._streak, bestStreak:this._best, total:this._idx }; }

  _showCurrent() {
    this._answered = false;
    const q = this.current;
    if (!q) { this._finish(); return; }
    this._onQuestion(q, this._idx, this._queue.length);
  }

  answer(choiceIdx) {
    if (this._answered) return;
    this._answered = true;
    const q = this.current;
    if (!q) return;
    const isCorrect = choiceIdx === q.answer;

    if (isCorrect) { this._correct++; this._streak++; this._best=Math.max(this._best,this._streak); }
    else           { this._wrong++;   this._streak=0; }

    // 오답 기록 (WrongBank)
    if (this._WB && this._User?.current()) {
      this._WB.record({
        gameId:  this.gameId,
        subject: q.subject || this.subject || '기타',
        qKey:    (q.q||'').slice(0,50) || String(this._idx),
        data:    { q:q.q, choices:q.choices, answer:q.answer, unit:q.unit, grade:q.grade },
        correct: isCorrect,
      });
    }

    this._onResult(isCorrect, q, this.stats);
    this._idx++;

    // 5문제마다 학년 조정
    if (this._idx>0 && this._idx%5===0) this._adjustGrade();
  }

  _adjustGrade() {
    if (!this.subject || !this._Grade || !this._User?.current()) return;
    const acc = this._idx>0 ? this._correct/this._idx : 0;
    const opts = {};
    if (this.tier) {
      const r = {elementary:[3,6],middle:[7,9],high:[10,12]}[this.tier];
      if (r) { opts.minGrade=r[0]; opts.maxGrade=r[1]; }
    }
    if (this.gradeRange) { opts.minGrade=this.gradeRange[0]; opts.maxGrade=this.gradeRange[1]; }
    const result = this._Grade.evaluate(this.subject, acc, opts);
    this._curGrade = this._Grade.get(this.subject);
    // 학년 변경 알림은 Bus를 통해 user.js → toast.js 에서 처리
    return result;
  }

  _finish() {
    const acc = this._idx>0 ? this._correct/this._idx : 0;
    this._adjustGrade();
    let expResult = null;
    if (this._Items && this._User?.current()) {
      const exp = this._correct*8 + (this._best>=5?30:0);
      expResult = this._Items.addExp(exp, this.gameId);
      // Toast는 EventBus(level:up)를 통해 자동 표시됨
    }
    const grade = acc>=.9?'S':acc>=.75?'A':acc>=.6?'B':acc>=.4?'C':'D';
    this._onEnd({ correct:this._correct, wrong:this._wrong, total:this._idx, acc, grade, bestStreak:this._best, expResult });
  }
}

if (global.Container) Container.register('QuizEngine', () => QuizEngine); // 팩토리가 아닌 클래스 자체를
global.QuizEngine = QuizEngine;
})(window);
