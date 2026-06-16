/**
 * shared.js  v4.0  — 플랫폼 부트스트랩
 *
 * 변경사항 (v3 → v4):
 * - 동적 script 삽입 제거 → HTML에서 직접 선언 (CSP 안전)
 * - EventBus + Container 초기화
 * - 모든 모듈이 로드되면 데이터 fetch → Items.sync()
 * - LearningHub 어댑터: Container 통해 서비스 조회 (테스터블)
 *
 * HTML 로드 순서 (game-manifest.js 또는 직접 선언):
 *   <script src="js/core/event-bus.js"></script>
 *   <script src="js/core/container.js"></script>
 *   <script src="js/core/store.js"></script>
 *   <script src="js/core/user.js"></script>
 *   <script src="js/core/items.js"></script>
 *   <script src="js/ui/toast.js"></script>
 *   <script src="js/ui/modal.js"></script>
 *   <script src="js/game/data-loader.js"></script>
 *   <script src="js/game/quiz-engine.js"></script>
 *   <script src="shared.js"></script>   ← 마지막: 부트스트랩
 */
'use strict';
(function(global) {

let _ready = false;
const _cbs = [];

function onReady(fn) {
  if (_ready) { fn(); return; }
  _cbs.push(fn);
}

function _resolveBase() {
  if (typeof document === 'undefined') return '';
  const s = document.querySelector('script[src*="shared"]');
  if (!s) return '';
  try { return new URL(s.src, location.href).href.replace(/shared\.js.*$/, ''); }
  catch(e) { return ''; }
}

async function _bootstrap() {
  const BASE = _resolveBase();

  // 1. 외부 데이터 fetch (sprites + items)
  const DL = global.DataLoader;
  let sprites = {}, itemsData = { items:[], roomItems:[] };
  try {
    if (DL) {
      [sprites, itemsData] = await Promise.all([
        DL.get('sprites').catch(()=>({})),
        DL.get('items').catch(()=>({ items:[], roomItems:[] })),
      ]);
    } else {
      const [sr, ir] = await Promise.all([
        fetch(BASE+'data/sprites.json'),
        fetch(BASE+'data/items.json'),
      ]);
      sprites = await sr.json();
      itemsData = await ir.json();
    }
  } catch(e) {
    console.warn('[shared] 데이터 fetch 실패:', e);
    global.Bus?.emit?.('error:module', { module:'shared', error: e.message });
  }

  // 2. Items 모듈에 데이터 동기화
  const Items = global.Items || Container?.get?.('Items');
  if (Items) Items.sync(sprites, itemsData.items||[], itemsData.roomItems||[]);

  // 3. Container에 서비스 일괄 등록 (아직 안 된 것)
  if (global.Container) {
    const services = { Store, User, Grade, WrongBank, Streak, Stats, Items, Toast, Modal, DataLoader };
    Object.entries(services).forEach(([k, v]) => {
      if (v && !Container.has(k)) Container.register(k, v);
    });
  }

  // 4. LearningHub 어댑터 빌드
  _buildAdapter();

  // 5. 콜백
  _ready = true;
  _cbs.splice(0).forEach(fn => { try { fn(); } catch(e) { console.error('[shared] onReady cb error:', e); } });
}

// ── LearningHub 하위호환 어댑터 ───────────────────────────
function _buildAdapter() {
  // 서비스 게터 (Container 통해 — 테스트 시 교체 가능)
  const S  = () => global.Container?.get?.('Store')      || global.Store;
  const U  = () => global.Container?.get?.('User')       || global.User;
  const G  = () => global.Container?.get?.('Grade')      || global.Grade;
  const WB = () => global.Container?.get?.('WrongBank')  || global.WrongBank;
  const ST = () => global.Container?.get?.('Streak')     || global.Streak;
  const SS = () => global.Container?.get?.('Stats')      || global.Stats;
  const I  = () => global.Container?.get?.('Items')      || global.Items;
  const T  = () => global.Container?.get?.('Toast')      || global.Toast;
  const M  = () => global.Container?.get?.('Modal')      || global.Modal;
  const DL = () => global.Container?.get?.('DataLoader') || global.DataLoader;

  const lh = {
    // 메타
    onReady,
    SUBJECTS:    ['수학','영어','국어','사회','과학'],
    MIN_GRADE: 3, MAX_GRADE: 6,
    get TIER_GRADES()      { return G()?.TIER_GRADES || {}; },
    get ITEM_CATALOG()     { return I()?._data?.catalog     || []; },
    get ROOM_ITEM_CATALOG(){ return I()?._data?.roomCatalog || []; },
    get SPRITE_DATA()      { return I()?._data?.sprites     || {}; },
    LEVEL_EXP:   lvl => lvl * 100,

    // 사용자
    listUsers:           ()   => U()?.list()           || [],
    getCurrentUser:      ()   => U()?.current()        || null,
    getCurrentUserName:  ()   => U()?.currentName()    || null,
    createOrSwitchUser:  n    => U()?.createOrSwitch(n),
    switchUser:          n    => U()?.switch(n),
    deleteUser:          n    => U()?.delete(n),
    logout:              ()   => U()?.logout(),

    // 학년
    getGrade:          s        => G()?.get(s),
    setGrade:          (s,g)    => G()?.set(s,g),
    evaluateLevel:     (s,a,o)  => G()?.evaluate(s,a,o),
    gradeLabel:        g        => G()?.gradeLabel(g),
    gradeDisplayLabel: g        => G()?.gradeFullLabel(g),
    getTier:           g        => G()?.getTier(g),
    gradeToTier:       g        => G()?.getTier(g),

    // 오답
    recordAnswer:      o        => WB()?.record(o),
    getReviewQueue:    (g,s,l)  => WB()?.getQueue(g,s,l)  || [],
    getReviewCount:    (g,s)    => WB()?.getCount(g,s)    || 0,
    getWrongBankItems: s        => WB()?.getItems(s)       || [],
    reviewAnswer:      (g,k,c)  => WB()?.review(g,k,c),
    getWrongBankSummary:()      => WB()?.getSummary()      || {},

    // 통계
    recordPlay:  (g,r)   => SS()?.record(g,r),
    getStats:     g      => SS()?.get(g),
    getAllStats:   ()     => SS()?.getAll() || {},

    // 캐릭터
    getCharacter:            ()        => I()?.getCharacter(),
    addExp:                  (a,s)     => I()?.addExp(a,s),
    unlockAchievement:       (g,v)     => I()?.unlockAchievement(g,v),
    equipItem:               (sl,id)   => I()?.equip(sl,id),
    getItemById:             id        => I()?.getById(id),
    getInventoryBySlot:      sl        => I()?.getInventoryBySlot(sl)  || [],
    getAllItemsBySlot:        sl        => I()?.getAllBySlot(sl)         || [],
    describeUnlock:          item      => I()?.describeUnlock(item)     || '',
    renderCharacter:         (cv,eq,s) => I()?.renderCharacter(cv,eq,s),
    renderCurrentCharacter:  (cv,s)    => I()?.renderCurrentCharacter(cv,s),

    // 베이스캠프
    getRoom:               ()  => I()?.getRoom(),
    getRoomItemById:       id  => I()?.getRoomById(id),
    getRoomInventoryBySlot:sl  => I()?.getAllRoomBySlot(sl).filter(i=>i.unlocked) || [],
    getAllRoomItemsBySlot:  sl  => I()?.getAllRoomBySlot(sl)  || [],
    setWallpaper:          id  => I()?.setWallpaper(id),
    setFloor:              id  => I()?.setFloor(id),
    toggleFurniture:       id  => I()?.toggleFurniture(id),

    // 출석
    checkStreak: () => {
      const r = ST()?.check();
      // 새 아이템 해금 체크 (Items._checkUnlocks는 EventBus로 이미 처리됨)
      return r;
    },

    // UI
    showToast:        (t,o) => T()?.show(t,o),
    announceExpResult: r    => T()?.announceExp(r),
    injectBackLink:    ()   => M()?.injectBackLink(),
    injectLoginModal:  cb   => M()?.requireLogin(cb),
    escapeHtml: s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'),
    renderProfileBadge(el, subj) {
      if (!el) return;
      const g = lh.getGrade(subj);
      el.textContent = g ? lh.gradeLabel(g) : '';
    },
  };

  global.LearningHub = lh;
}

// ── 진입점 ────────────────────────────────────────────────
// onReady는 _bootstrap 전에 등록 가능하도록 즉시 노출
global.LearningHub = { onReady };

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _bootstrap);
  } else {
    _bootstrap();
  }
} else {
  global.LearningHub = { onReady };
}

})(typeof window !== 'undefined' ? window : global);
