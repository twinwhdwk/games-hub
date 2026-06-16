/**
 * @file js/game/data-loader.js
 * 게임 데이터(question_bank, matching_bank, blank_bank)를 한 번만 fetch하고 캐싱.
 * 모든 게임이 DataLoader.get('question_bank') 로 동일하게 접근.
 *
 * 사용:
 *   const bank = await DataLoader.get('question_bank');
 *   const qs = DataLoader.filter('question_bank', { subject:'수학', tier:'middle' });
 */
'use strict';
(function(global) {

const _cache = {};
const _pending = {};

const FILES = {
  question_bank: 'data/question_bank.json',
  matching_bank: 'data/matching_bank.json',
  blank_bank:    'data/blank_bank.json',
  sprites:       'data/sprites.json',
  items:         'data/items.json',
};

function _base() {
  if (typeof document === 'undefined') return '';
  const s = document.querySelector('script[src*="shared"], script[src*="data-loader"]');
  if (s) {
    try { return new URL(s.src, location.href).href.replace(/js\/.*$|shared\.js.*$/, ''); } catch(e) {}
  }
  return '';
}

const DataLoader = {
  /**
   * 데이터 비동기 로드 (캐시 있으면 즉시 반환)
   * @param {string} key - 'question_bank' | 'matching_bank' | 'blank_bank'
   */
  async get(key) {
    if (_cache[key]) return _cache[key];
    if (_pending[key]) return _pending[key];

    const url = _base() + (FILES[key] || key);
    _pending[key] = fetch(url).then(r => {
      if (!r.ok) throw new Error(`[DataLoader] ${key} fetch 실패: ${r.status}`);
      return r.json();
    }).then(data => {
      _cache[key] = data;
      delete _pending[key];
      return data;
    }).catch(e => {
      console.error(e);
      delete _pending[key];
      return {};
    });
    return _pending[key];
  },

  /** 동기 접근 (이미 로드된 경우만) */
  peek(key) {
    return _cache[key] || null;
  },

  /**
   * 과목 + 학년 필터링 헬퍼
   * @param {string} bankKey
   * @param {{ subject, tier, gradeRange }} opts
   * tier: 'elementary'(3-6) | 'middle'(7-9) | 'high'(10-12)
   * gradeRange: [min, max]  (tier보다 우선)
   */
  async filter(bankKey, opts = {}) {
    const bank = await DataLoader.get(bankKey);
    const { subject, tier, gradeRange, grade } = opts;

    let range = gradeRange;
    if (!range && tier) {
      const RANGES = { elementary:[3,6], middle:[7,9], high:[10,12] };
      range = RANGES[tier] || [3,6];
    }
    if (!range && grade) range = [Math.max(3, grade-1), Math.min(12, grade+1)];

    let pool = subject ? (bank[subject] || []) : Object.values(bank).flat();
    if (range) pool = pool.filter(q => q.grade >= range[0] && q.grade <= range[1]);
    return pool;
  },

  /** 캐시 비우기 (테스트용) */
  clear() {
    Object.keys(_cache).forEach(k => delete _cache[k]);
  },
};

global.DataLoader = DataLoader;
})(window);
