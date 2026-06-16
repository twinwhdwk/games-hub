/**
 * @file js/core/store.js
 * localStorage 추상화. 직렬화/역직렬화, 마이그레이션, 에러 복구.
 * 모든 데이터 접근은 이 모듈을 통한다.
 */
'use strict';
(function(global) {

const CURRENT_VERSION = 2;
const KEY = 'lh_db_v2';

// 기본 DB 구조
function emptyDB() {
  return { version: CURRENT_VERSION, currentUser: null, users: {} };
}

// 마이그레이션 테이블 (버전 N → N+1)
const MIGRATIONS = {
  1: (db) => {
    // v1(lh_users_v1) → v2: users 구조 그대로, version 필드만 추가
    db.version = 2;
    return db;
  },
};

function migrate(db) {
  while (db.version < CURRENT_VERSION) {
    const fn = MIGRATIONS[db.version];
    if (!fn) break;
    db = fn(db);
  }
  return db;
}

function load() {
  try {
    // v2 키 시도
    let raw = localStorage.getItem(KEY);
    if (!raw) {
      // v1 레거시 마이그레이션
      raw = localStorage.getItem('lh_users_v1');
      if (raw) {
        const old = JSON.parse(raw);
        const db = Object.assign(emptyDB(), { users: old.users || {}, currentUser: old.currentUser || null, version: 1 });
        return migrate(db);
      }
      return emptyDB();
    }
    const db = JSON.parse(raw);
    if (!db.version || db.version < CURRENT_VERSION) return migrate(db);
    return db;
  } catch (e) {
    console.warn('[Store] 로드 실패, 초기화:', e);
    return emptyDB();
  }
}

function save(db) {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch (e) {
    console.error('[Store] 저장 실패:', e);
  }
}

/** 트랜잭션: fn(db) 실행 후 자동 저장. 반환값이 false면 저장 안 함. */
function tx(fn) {
  const db = load();
  const result = fn(db);
  if (result !== false) save(db);
  return result;
}

/** 현재 유저 레코드 조회 (없으면 null) */
function currentUserRecord() {
  const db = load();
  if (!db.currentUser || !db.users[db.currentUser]) return null;
  return db.users[db.currentUser];
}

global.Store = { load, save, tx, currentUserRecord, emptyDB };
})(window);
