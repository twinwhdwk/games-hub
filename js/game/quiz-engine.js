/**
 * @file js/game/quiz-engine.js
 * 4지선다 퀴즈 공통 로직. 문제 풀, 진행, 채점, 학년 조정을 담당.
 * UI 렌더링 없음 — 각 게임 HTML이 콜백으로 처리.
 *
 * 사용:
 *   const quiz = new QuizEngine({
 *     gameId: '지식탐험',
 *     subject: '수학',
 *     tier: 'middle',        // 또는 gradeRange:[7,9]
 *     total: 20,
 *     onQuestion(q, idx, total) {},   // 문제 표시
 *     onResult(isCorrect, q, stats) {},  // 채점 결과
 *     onEnd(summary) {},              // 게임 종료
 *   });
 *   await quiz.init();
 *   quiz.start();
 *   quiz.answer(choiceIdx);
 */
'use strict';
(function(global) {

class QuizEngine {
  constructor(opts) {
    this.gameId  = opts.gameId  || 'unknown';
    this.subject = opts.subject || null;   // null = 전 과목
    this.tier    = opts.tier    || null;
    this.gradeRange = opts.gradeRange || null;
    this.total   = opts.total   || 20;
    this.bankKey = opts.bankKey || 'question_bank';

    // 콜백
    this._onQuestion = opts.onQuestion || (() => {});
    this._onResult   = opts.onResult   || (() => {});
    this._onEnd      = opts.onEnd      || (() => {});

    // 내부 상태
    this._pool     = [];
    this._queue    = [];
    this._idx      = 0;
    this._correct  = 0;
    this._wrong    = 0;
    this._streak   = 0;
    this._bestStreak = 0;
    this._answered = false;
    this._curGrade = 3;
  }

  // ── 초기화 ────────────────────────────────────────────
  async init() {
    const filterOpts = {
      subject:    this.subject,
      tier:       this.tier,
      gradeRange: this.gradeRange,
    };
    // subject 없으면 뱅크의 모든 과목 합침
    if (!this.subject) {
      const bank = await DataLoader.get(this.bankKey);
      let all = Object.entries(bank).flatMap(([subj, qs]) =>
        qs.map(q => ({ ...q, subject: subj }))
      );
      if (this.tier || this.gradeRange) {
        const [min, max] = this.gradeRange || (
          { elementary:[3,6], middle:[7,9], high:[10,12] }[this.tier] || [3,6]
        );
        all = all.filter(q => q.grade >= min && q.grade <= max);
      }
      this._pool = all;
    } else {
      const qs = await DataLoader.filter(this.bankKey, filterOpts);
      this._pool = qs.map(q => ({ ...q, subject: this.subject }));
    }

    if (typeof Grade !== 'undefined') {
      const subj = this.subject || (Grade.SUBJECTS[0]);
      this._curGrade = Grade.get(subj);
    }
    this._buildQueue();
    return this;
  }

  _buildQueue() {
    const g = this._curGrade;
    const pool = this._pool.filter(q => Math.abs(q.grade - g) <= 1);
    const base  = pool.length ? pool : this._pool;
    this._queue = [...base].sort(() => Math.random() - 0.5).slice(0, this.total);
    this._idx = 0; this._correct = 0; this._wrong = 0; this._streak = 0;
  }

  // ── 진행 ─────────────────────────────────────────────
  start() {
    this._idx = 0;
    this._showCurrent();
  }

  restart() {
    this._buildQueue();
    this.start();
  }

  get current() { return this._queue[this._idx] || null; }
  get index()   { return this._idx; }
  get length()  { return this._queue.length; }
  get stats()   { return { correct: this._correct, wrong: this._wrong, streak: this._streak, bestStreak: this._bestStreak, total: this._idx }; }

  _showCurrent() {
    this._answered = false;
    const q = this.current;
    if (!q) { this._finish(); return; }
    this._onQuestion(q, this._idx, this._queue.length);
  }

  /** 선택지 인덱스로 답변 */
  answer(choiceIdx) {
    if (this._answered) return;
    this._answered = true;
    const q = this.current;
    if (!q) return;

    const isCorrect = choiceIdx === q.answer;
    if (isCorrect) {
      this._correct++;
      this._streak++;
      this._bestStreak = Math.max(this._bestStreak, this._streak);
    } else {
      this._wrong++;
      this._streak = 0;
    }

    // 오답 기록
    if (typeof WrongBank !== 'undefined' && typeof User !== 'undefined' && User.current()) {
      WrongBank.record({
        gameId:  this.gameId,
        subject: q.subject || this.subject || '기타',
        qKey:    q.q?.slice(0, 50) || String(this._idx),
        data:    { q: q.q, choices: q.choices, answer: q.answer, unit: q.unit, grade: q.grade },
        correct: isCorrect,
      });
    }

    this._onResult(isCorrect, q, this.stats);
    this._idx++;

    // 5문제마다 학년 조정
    if (this._idx > 0 && this._idx % 5 === 0) this._adjustGrade();
  }

  next() { this._showCurrent(); }

  _adjustGrade() {
    if (!this.subject || typeof Grade === 'undefined' || !User?.current()) return;
    const acc = this._idx > 0 ? this._correct / this._idx : 0;
    const opts = {};
    if (this.tier) {
      const ranges = { elementary:[3,6], middle:[7,9], high:[10,12] };
      const r = ranges[this.tier] || [3,6];
      opts.minGrade = r[0]; opts.maxGrade = r[1];
    }
    if (this.gradeRange) { opts.minGrade = this.gradeRange[0]; opts.maxGrade = this.gradeRange[1]; }
    const result = Grade.evaluate(this.subject, acc, opts);
    this._curGrade = Grade.get(this.subject);
    if (result.changed) {
      const msg = result.direction === 'up' ? '⬆️ 레벨업!' : '⬇️ 난이도 조정';
      if (typeof Toast !== 'undefined') Toast.show(msg);
    }
    return result;
  }

  _finish() {
    const acc = this._idx > 0 ? this._correct / this._idx : 0;
    // 최종 학년 조정
    if (this.subject && typeof Grade !== 'undefined' && User?.current()) {
      this._adjustGrade();
    }
    // EXP 지급
    let expResult = null;
    if (typeof Items !== 'undefined' && User?.current()) {
      const exp = this._correct * 8 + (this._bestStreak >= 5 ? 30 : 0);
      expResult = Items.addExp(exp, this.gameId);
      if (typeof Toast !== 'undefined') Toast.announceExp(expResult);
    }

    const grade = acc >= 0.9 ? 'S' : acc >= 0.75 ? 'A' : acc >= 0.6 ? 'B' : acc >= 0.4 ? 'C' : 'D';
    this._onEnd({
      correct: this._correct, wrong: this._wrong, total: this._idx,
      acc, grade, bestStreak: this._bestStreak, expResult,
    });
  }
}

global.QuizEngine = QuizEngine;
})(window);
