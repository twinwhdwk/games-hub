/**
 * @file js/game-init.js  v2.0
 * 게임 페이지 표준 초기화. shared.js 로드 후 사용.
 *
 * 사용:
 *   GameInit.start('게임ID', onStartFn, { backLink, requireLogin, checkStreak });
 *   GameInit.finish('게임ID', expAmount);
 */
'use strict';
(function(global) {

const GameInit = {
  /**
   * @param {string}   gameId
   * @param {Function} onStart  - 데이터 + 로그인 완료 후 호출
   * @param {object}   opts
   *   backLink:     {boolean} 뒤로가기 버튼 자동 삽입 (default: true)
   *   requireLogin: {boolean} 비로그인 시 모달 (default: true)
   *   checkStreak:  {boolean} 출석 체크 (default: true)
   */
  start(gameId, onStart, opts = {}) {
    opts = Object.assign({ backLink: true, requireLogin: true, checkStreak: true }, opts);

    // 데이터 준비 후 실행
    const lh = global.LearningHub;
    if (!lh) { console.error('[GameInit] shared.js 가 로드되지 않았습니다'); return; }

    lh.onReady(() => {
      if (opts.backLink && global.Modal) Modal.injectBackLink();

      const proceed = () => {
        if (opts.checkStreak && global.Streak && global.User?.current()) {
          const r = Streak.check();
          if (r?.isNew && r.newItems?.length && global.Toast) {
            setTimeout(() => r.newItems.forEach(it => Toast.show(`🎁 ${it.name} 해금!`, { type:'success' })), 800);
          }
        }
        if (typeof onStart === 'function') onStart();
      };

      if (opts.requireLogin && global.User && !User.current()) {
        Modal.requireLogin(proceed);
      } else {
        proceed();
      }
    });
  },

  /**
   * 게임 종료 시 EXP 지급 + 토스트
   * @returns expResult 또는 null
   */
  finish(gameId, exp, source) {
    if (!global.Items || !global.User?.current()) return null;
    const result = Items.addExp(exp || 0, source || gameId);
    if (global.Toast) Toast.announceExp(result);
    return result;
  },
};

global.GameInit = GameInit;
})(window);
