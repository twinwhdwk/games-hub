/**
 * @file js/game-init.js  v3
 * 게임 초기화 헬퍼. Container 기반 DI + 에러 경계.
 */
'use strict';
(function(global) {

const GameInit = {
  /**
   * 표준 게임 시작 시퀀스
   * 1) shared.js onReady (데이터 로드 완료)
   * 2) 뒤로가기 링크 삽입
   * 3) 로그인 확인 → onStart() 호출
   * 4) 출석 체크 + 스트릭 토스트
   */
  start(gameId, onStart, opts = {}) {
    opts = Object.assign({ backLink:true, requireLogin:true, checkStreak:true }, opts);

    const lh = global.LearningHub;
    if (!lh) { console.error('[GameInit] shared.js 가 로드되지 않았습니다'); return; }

    lh.onReady(() => {
      // 서비스 조회 (Container 우선, global 폴백)
      const get = name => global.Container?.get?.(name) || global[name];
      const Modal = get('Modal'), User = get('User'), Streak = get('Streak'), Toast = get('Toast');

      if (opts.backLink && Modal) {
        try { Modal.injectBackLink(); } catch(e) { console.warn('[GameInit] backLink 실패:', e); }
      }

      const proceed = () => {
        if (opts.checkStreak && Streak && User?.current()) {
          try {
            const r = Streak.check();
            if (r?.isNew && r.newItems?.length && Toast) {
              setTimeout(() => {
                r.newItems.forEach(it => Toast.show(`🎁 ${it.name} 해금!`, { type:'success' }));
              }, 900);
            }
          } catch(e) { console.warn('[GameInit] streak 실패:', e); }
        }
        try {
          if (typeof onStart === 'function') onStart();
        } catch(e) {
          console.error(`[GameInit:${gameId}] onStart 에러:`, e);
          // 에러 경계: 게임 초기화 실패 시 사용자에게 알림
          if (Toast) Toast.show('게임 초기화 중 오류가 발생했어요. 새로고침 해주세요.', { type:'error', duration:5000 });
          global.Bus?.emit?.('error:module', { module: gameId, error: e.message });
        }
      };

      if (opts.requireLogin && User && !User.current()) {
        try { Modal?.requireLogin(proceed); }
        catch(e) { console.error('[GameInit] 로그인 모달 실패:', e); proceed(); }
      } else {
        proceed();
      }
    });
  },

  /**
   * 게임 종료 EXP 지급 + 결과 이벤트 발행
   */
  finish(gameId, exp, source) {
    const Items = global.Container?.get?.('Items') || global.Items;
    const User  = global.Container?.get?.('User')  || global.User;
    if (!Items || !User?.current()) return null;
    try {
      const result = Items.addExp(Math.max(0, exp || 0), source || gameId);
      // 통계 기록
      const Stats = global.Container?.get?.('Stats') || global.Stats;
      Stats?.record?.(gameId, { score: exp, source });
      global.Bus?.emit?.('game:finished', { gameId, exp, source, result });
      return result;
    } catch(e) {
      console.error(`[GameInit:${gameId}] finish 에러:`, e);
      return null;
    }
  },
};

if (global.Container) Container.register('GameInit', GameInit);
global.GameInit = GameInit;
})(window);
