/**
 * @file js/core/store.js  v2
 * localStorage 추상화. 마이그레이션, 에러 복구, EventBus 통합.
 */
'use strict';
(function(global) {

const VERSION = 2;
const KEY = 'lh_db_v2';

function emptyDB() {
  return { version: VERSION, currentUser: null, users: {} };
}

const MIGRATIONS = {
  1: db => { db.version = 2; return db; },
};

function migrate(db) {
  let d = { ...db };
  while (d.version < VERSION) {
    const fn = MIGRATIONS[d.version];
    if (!fn) break;
    d = fn(d);
  }
  return d;
}

const Store = {
  load() {
    try {
      let raw = localStorage.getItem(KEY);
      if (!raw) {
        raw = localStorage.getItem('lh_users_v1');
        if (raw) {
          const old = JSON.parse(raw);
          return migrate({ ...emptyDB(), users: old.users || {}, currentUser: old.currentUser || null, version: 1 });
        }
        return emptyDB();
      }
      const db = JSON.parse(raw);
      return db.version < VERSION ? migrate(db) : db;
    } catch(e) {
      console.warn('[Store] load failed, reset:', e);
      global.Bus?.emit?.('error:module', { module: 'Store', error: e.message });
      return emptyDB();
    }
  },

  save(db) {
    try {
      localStorage.setItem(KEY, JSON.stringify(db));
    } catch(e) {
      console.error('[Store] save failed:', e);
      global.Bus?.emit?.('error:module', { module: 'Store', error: e.message });
    }
  },

  tx(fn) {
    const db = this.load();
    const result = fn(db);
    if (result !== false) this.save(db);
    return result;
  },

  currentUserRecord() {
    const db = this.load();
    if (!db.currentUser || !db.users[db.currentUser]) return null;
    return db.users[db.currentUser];
  },

  emptyDB,
};

if (global.Container) Container.register('Store', Store);
global.Store = Store;
})(window);
