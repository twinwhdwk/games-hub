/**
 * @file js/core/container.js
 * 경량 의존성 주입 컨테이너.
 * 모듈이 global.X 를 직접 참조하는 대신 Container.get('X') 로 가져옴.
 * → 테스트 시 Container.register('X', mockX) 로 교체 가능.
 *
 * 사용:
 *   // 등록
 *   Container.register('Store', Store);
 *   Container.register('User', () => new UserService(Container.get('Store')));
 *
 *   // 사용
 *   const store = Container.get('Store');
 *
 *   // 테스트 모킹
 *   Container.register('Store', mockStore);
 */
'use strict';
(function(global) {

class Container {
  constructor() {
    this._registry = new Map();
    this._cache    = new Map();
    this._aliases  = new Map();
  }

  /**
   * 서비스 등록
   * value: 값 또는 () => 값 팩토리 (팩토리는 처음 get 시 실행)
   * opts.singleton: 팩토리를 한 번만 실행 (default: true)
   */
  register(name, value, opts = {}) {
    const singleton = opts.singleton !== false;
    this._registry.set(name, { value, singleton, isFactory: typeof value === 'function' });
    this._cache.delete(name); // 재등록 시 캐시 무효화
    return this;
  }

  /** 별칭 등록 (LearningHub → Platform) */
  alias(from, to) {
    this._aliases.set(from, to);
    return this;
  }

  /** 서비스 조회 */
  get(name) {
    const real = this._aliases.get(name) || name;
    if (this._cache.has(real)) return this._cache.get(real);
    const entry = this._registry.get(real);
    if (!entry) {
      // 폴백: global 직접 조회 (하위호환)
      if (typeof global[real] !== 'undefined') return global[real];
      // 개발 환경에서만 경고 (prod에서는 조용히 null)
      if (typeof location !== 'undefined' && location.hostname === 'localhost') {
        console.warn(`[Container] "${real}" 미등록 — js/ 모듈 로드 순서를 확인하세요`);
      }
      return null;
    }
    let instance = entry.value;
    if (entry.isFactory) {
      try { instance = entry.value(); }
      catch(e) { console.error(`[Container] factory error for "${real}":`, e); return null; }
    }
    if (entry.singleton) this._cache.set(real, instance);
    return instance;
  }

  /** 등록 여부 확인 */
  has(name) {
    return this._registry.has(this._aliases.get(name) || name);
  }

  /** 일괄 등록 */
  registerAll(map) {
    Object.entries(map).forEach(([k, v]) => this.register(k, v));
    return this;
  }

  /** 현재 등록 목록 (디버깅) */
  list() {
    return [...this._registry.keys()];
  }
}

const C = new Container();
global.Container = C;
})(window);
