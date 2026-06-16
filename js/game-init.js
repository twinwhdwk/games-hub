/**
 * @file js/game-init.js
 * 모든 게임 페이지 공통 초기화 패턴을 단일 함수로 제공
 *
 * 사용법:
 *   <script src="../shared.js"></script>
 *   <script src="../js/game-init.js"></script>
 *   <script>
 *     GameInit.start('지식탐험', function() {
 *       // 로그인 완료 & 데이터 로드 후 게임 시작
 *       startGame();
 *     });
 *   </script>
 */

'use strict';

(function(global) {

  /**
   * 게임 페이지 표준 초기화
   * @param {string} gameId  - GAME_REGISTRY 의 id (오답 뱃지, 복습 큐에 사용)
   * @param {Function} onStart - 로그인+데이터 준비 완료 후 호출
   * @param {Object} [opts]
   * @param {boolean} [opts.backLink=true]    - 뒤로가기 버튼 자동 삽입
   * @param {boolean} [opts.requireLogin=true] - 비로그인 시 로그인 모달 표시
   * @param {boolean} [opts.checkStreak=true] - 출석 체크 자동 실행
   */
  function start(gameId, onStart, opts) {
    opts = Object.assign({ backLink: true, requireLogin: true, checkStreak: true }, opts || {});

    const lh = global.LearningHub;
    if (!lh) { console.error('[GameInit] shared.js 가 로드되지 않았습니다'); return; }

    // 뒤로가기 링크
    if (opts.backLink) lh.injectBackLink();

    // 데이터 + 로그인 준비 완료 후 시작
    lh.onReady(function() {
      if (opts.requireLogin && !lh.getCurrentUser()) {
        lh.injectLoginModal(function() {
          _afterLogin(gameId, onStart, opts);
        });
      } else {
        _afterLogin(gameId, onStart, opts);
      }
    });
  }

  function _afterLogin(gameId, onStart, opts) {
    const lh = global.LearningHub;
    if (opts.checkStreak && lh.getCurrentUser()) {
      const result = lh.checkStreak();
      if (result && result.isNew && result.newItems.length) {
        setTimeout(function() {
          result.newItems.forEach(function(item) {
            lh.showToast('🎁 ' + item.name + ' 해금!');
          });
        }, 1000);
      }
    }
    if (typeof onStart === 'function') onStart();
  }

  /**
   * 게임 종료 시 EXP/복습 결과 처리 표준 패턴
   * @param {string} gameId
   * @param {number} exp
   * @param {string} source
   */
  function finish(gameId, exp, source) {
    const lh = global.LearningHub;
    if (!lh || !lh.getCurrentUser()) return;
    const result = lh.addExp(exp, source || gameId);
    lh.announceExpResult(result);
    return result;
  }

  global.GameInit = { start, finish };

})(window);
