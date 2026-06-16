/**
 * @file js/core/event-bus.js
 * 플랫폼 전역 이벤트 버스.
 * 모든 cross-module 통신은 이벤트로만 — 직접 참조 금지.
 *
 * 표준 이벤트 목록:
 *   'user:login'       { name }
 *   'user:logout'      {}
 *   'grade:changed'    { subject, oldGrade, newGrade, direction }
 *   'exp:gained'       { amount, source, total }
 *   'level:up'         { newLevel, newItems }
 *   'item:unlocked'    { item }
 *   'streak:updated'   { streak, isNew }
 *   'answer:recorded'  { gameId, subject, correct }
 *   'wrong:mastered'   { gameId, qKey }
 *   'achievement:unlocked' { gameId, value }
 *   'data:ready'       {}
 *   'error:module'     { module, error }
 */
'use strict';
(function(global) {

class EventBus {
  constructor() {
    this._handlers = new Map();   // event -> Set<handler>
    this._once     = new Map();   // event -> Set<handler>
    this._history  = [];          // 최근 50개 이벤트 보관 (디버깅)
    this._debug    = false;
  }

  /** 이벤트 구독 */
  on(event, handler) {
    if (!this._handlers.has(event)) this._handlers.set(event, new Set());
    this._handlers.get(event).add(handler);
    return () => this.off(event, handler); // unsubscribe 함수 반환
  }

  /** 한 번만 실행 */
  once(event, handler) {
    const wrapper = (data) => { this.off(event, wrapper); handler(data); };
    return this.on(event, wrapper);
  }

  /** 구독 해제 */
  off(event, handler) {
    this._handlers.get(event)?.delete(handler);
  }

  /** 이벤트 발행 */
  emit(event, data = {}) {
    const payload = { event, data, ts: Date.now() };
    this._history.push(payload);
    if (this._history.length > 50) this._history.shift();
    if (this._debug) console.log(`[EventBus] ${event}`, data);

    // 동기 핸들러
    this._handlers.get(event)?.forEach(h => {
      try { h(data); } catch(e) { console.error(`[EventBus] handler error on "${event}":`, e); }
    });
  }

  /** Promise로 이벤트 기다리기 */
  wait(event, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.off(event, h); reject(new Error(`[EventBus] timeout: ${event}`)); }, timeoutMs);
      const h = (data) => { clearTimeout(timer); resolve(data); };
      this.once(event, h);
    });
  }

  /** 최근 이벤트 히스토리 (디버깅) */
  history(event) {
    return event ? this._history.filter(h => h.event === event) : this._history.slice();
  }

  enableDebug() { this._debug = true; }
}

const Bus = new EventBus();
global.Bus = Bus;
})(window);
