/**
 * shared.js  v3.0  — 플랫폼 부트스트랩 + 하위호환 어댑터
 *
 * 역할:
 * 1. 새 모듈(Store/User/Items/Toast/Modal/DataLoader/QuizEngine)을 순서대로 로드
 * 2. 외부 데이터(sprites.json, items.json) 비동기 fetch → Items.sync()
 * 3. LearningHub.*  하위호환 API 노출 (기존 게임 HTML 수정 최소화)
 *
 * 로드 순서 (HTML <head> 에서):
 *   <script src="shared.js"></script>          ← 이 파일이 나머지를 동적으로 로드
 */
'use strict';

(function(global) {

// ── 모듈 순서 정의 ─────────────────────────────────────────
const MODULES = [
  'js/core/store.js',
  'js/core/user.js',
  'js/core/items.js',
  'js/ui/toast.js',
  'js/ui/modal.js',
  'js/game/data-loader.js',
  'js/game/quiz-engine.js',
];

// 기반 URL 계산
function resolveBase() {
  if (typeof document === 'undefined') return '';
  const s = document.querySelector('script[src*="shared"]');
  if (!s) return '';
  try { return new URL(s.src, location.href).href.replace(/shared\.js.*$/, ''); }
  catch(e) { return ''; }
}

const BASE = resolveBase();

// ── 모듈 동적 로드 ────────────────────────────────────────
let _dataReady = false;
const _readyCallbacks = [];

function _loadScript(src) {
  return new Promise((resolve, reject) => {
    // Node.js 환경 (테스트) — 스킵
    if (typeof document === 'undefined') { resolve(); return; }
    // 이미 로드됨
    if (document.querySelector(`script[src$="${src}"]`)) { resolve(); return; }
    const el = document.createElement('script');
    el.src = BASE + src;
    el.onload = resolve;
    el.onerror = () => { console.error('[shared] 모듈 로드 실패:', src); resolve(); };
    document.head.appendChild(el);
  });
}

async function _bootstrap() {
  // 1. 모듈 순차 로드
  for (const mod of MODULES) {
    await _loadScript(mod);
  }

  // 2. 외부 데이터 fetch
  try {
    const [spritesRes, itemsRes] = await Promise.all([
      fetch(BASE + 'data/sprites.json'),
      fetch(BASE + 'data/items.json'),
    ]);
    const sprites = await spritesRes.json();
    const itemsData = await itemsRes.json();
    // Items 모듈에 동기화
    if (global.Items) {
      Items.sync(sprites, itemsData.items || [], itemsData.roomItems || []);
    }
    // DataLoader 캐시에도 저장
    if (global.DataLoader) {
      DataLoader._cache = DataLoader._cache || {};
      DataLoader._cache['sprites'] = sprites;
      DataLoader._cache['items'] = itemsData;
    }
  } catch(e) {
    console.warn('[shared] 데이터 로드 실패:', e);
  }

  // 3. 하위호환 LearningHub API 노출
  _exposeAdapter();

  // 4. 콜백 실행
  _dataReady = true;
  _readyCallbacks.splice(0).forEach(fn => fn());
}

function onReady(fn) {
  if (_dataReady) { fn(); return; }
  _readyCallbacks.push(fn);
}

// ── 하위호환 어댑터 ────────────────────────────────────────
// 기존 게임들이 LearningHub.xxx() 형태로 호출하는 API를
// 새 모듈에 위임하는 프록시 레이어
function _exposeAdapter() {
  const lh = {
    // 메타
    SUBJECTS:    global.Grade?.SUBJECTS || ['수학','영어','국어','사회','과학'],
    MIN_GRADE:   3, MAX_GRADE: 6,
    TIER_GRADES: global.Grade?.TIER_GRADES || {},
    LEVEL_EXP:   lvl => lvl * 100,
    onReady,

    // 카탈로그 (동적)
    get ITEM_CATALOG()      { return global.Items?._data?.catalog     || []; },
    get ROOM_ITEM_CATALOG() { return global.Items?._data?.roomCatalog || []; },
    get SPRITE_DATA()       { return global.Items?._data?.sprites     || {}; },

    // 사용자
    listUsers:          ()      => global.User?.list()           || [],
    getCurrentUser:     ()      => global.User?.current()        || null,
    getCurrentUserName: ()      => global.User?.currentName()    || null,
    createOrSwitchUser: name    => global.User?.createOrSwitch(name),
    switchUser:         name    => global.User?.switch(name),
    deleteUser:         name    => global.User?.delete(name),
    logout:             ()      => global.User?.logout(),

    // 학년
    getGrade:      subj        => global.Grade?.get(subj),
    setGrade:      (s, g)      => global.Grade?.set(s, g),
    evaluateLevel: (s, acc, o) => global.Grade?.evaluate(s, acc, o),
    gradeToTier:   g           => global.Grade?.getTier(g),
    gradeLabel:    g           => global.Grade?.gradeLabel(g),
    gradeDisplayLabel: g       => global.Grade?.gradeFullLabel(g),
    getTier:       g           => global.Grade?.getTier(g),

    // 오답노트
    recordAnswer:       opts         => global.WrongBank?.record(opts),
    getReviewQueue:     (gid, s, l)  => global.WrongBank?.getQueue(gid, s, l),
    getReviewCount:     (gid, s)     => global.WrongBank?.getCount(gid, s)  || 0,
    getWrongBankItems:  s            => global.WrongBank?.getItems(s)        || [],
    reviewAnswer:       (gid, qk, c) => global.WrongBank?.review(gid, qk, c),
    getWrongBankSummary:()           => global.WrongBank?.getSummary()       || {},

    // 통계
    recordPlay: (gid, r)  => global.Stats?.record(gid, r),
    getStats:    gid      => global.Stats?.get(gid),
    getAllStats:  ()       => global.Stats?.getAll() || {},

    // 캐릭터/아이템
    getCharacter:           ()          => global.Items?.getCharacter(),
    addExp:                 (amt, src)  => global.Items?.addExp(amt, src),
    unlockAchievement:      (gid, val)  => global.Items?.unlockAchievement(gid, val),
    equipItem:              (slot, id)  => global.Items?.equip(slot, id),
    getItemById:            id          => global.Items?.getById(id),
    getInventoryBySlot:     slot        => global.Items?.getInventoryBySlot(slot)  || [],
    getAllItemsBySlot:       slot        => global.Items?.getAllBySlot(slot)         || [],
    describeUnlock:         item        => global.Items?.describeUnlock(item)       || '',
    renderCharacter:        (cv, eq, s) => global.Items?.renderCharacter(cv, eq, s),
    renderCurrentCharacter: (cv, s)     => global.Items?.renderCurrentCharacter(cv, s),

    // 베이스캠프
    getRoomItemById:       id   => global.Items?.getRoomById(id),
    getRoom:               ()   => global.Items?.getRoom(),
    getRoomInventoryBySlot: sl  => global.Items?.getAllRoomBySlot(sl).filter(i=>i.unlocked) || [],
    getAllRoomItemsBySlot:  sl   => global.Items?.getAllRoomBySlot(sl)  || [],
    setWallpaper:          id   => global.Items?.setWallpaper(id),
    setFloor:              id   => global.Items?.setFloor(id),
    toggleFurniture:       id   => global.Items?.toggleFurniture(id),

    // 출석
    checkStreak: () => global.Streak?.check(),

    // UI
    showToast:       (t, o) => global.Toast?.show(t, o),
    announceExpResult: r    => global.Toast?.announceExp(r),
    injectBackLink:  ()     => global.Modal?.injectBackLink(),
    injectLoginModal: cb    => global.Modal?.requireLogin(cb),
    escapeHtml:      s      => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'),
    renderProfileBadge: (el, subj) => {
      if (!el) return;
      const g = lh.getGrade(subj);
      el.textContent = g ? lh.gradeLabel(g) : '';
    },

    // SUBJECTS 편의
    SUBJECTS: global.Grade?.SUBJECTS || ['수학','영어','국어','사회','과학'],
  };

  global.LearningHub = lh;
}

// ── 진입점 ────────────────────────────────────────────────
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _bootstrap);
  } else {
    _bootstrap();
  }
} else {
  // Node.js 테스트 환경
  global.LearningHub = { onReady };
}

// onReady 는 bootstrap 전에도 등록 가능하도록 전역 노출
global.LearningHub = global.LearningHub || {};
global.LearningHub.onReady = onReady;

})(typeof window !== 'undefined' ? window : global);
