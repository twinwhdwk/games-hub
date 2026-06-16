/**
 * @file js/core/items.js
 * 캐릭터 장비, 아이템 카탈로그, EXP/레벨, 스프라이트 렌더러.
 * Store, User 모듈에만 의존.
 *
 * 데이터는 shared.js 의 onReady() 이후 사용 가능.
 * Items._data.sprites / .catalog / .roomCatalog 로 접근.
 */
'use strict';
(function(global) {

// ── 런타임 데이터 참조 (shared.js onReady 후 채워짐) ──────
const _data = {
  sprites:    { bodies:{}, hair:{}, outfits:{}, hats:{}, weapons:{}, pets:{}, palette:{} },
  catalog:    [],   // ITEM_CATALOG
  roomCatalog:[],   // ROOM_ITEM_CATALOG
};

const LEVEL_EXP = lvl => lvl * 100;

// ── 기본 캐릭터 구조 ──────────────────────────────────────
function _defaultCharacter() {
  const inv     = _data.catalog.filter(it => it.unlock.type === 'default').map(it => it.id);
  const roomInv = _data.roomCatalog.filter(it => it.unlock.type === 'default').map(it => it.id);
  return {
    level: 1, exp: 0,
    inventory: inv,
    equipped: {
      body: 'body_basic', hair: 'hair_brown', outfit: 'outfit_basic',
      hat: 'hat_none', weapon: 'weapon_none', pet1: 'pet_none', pet2: 'pet_none',
    },
    achievements: [],
    roomInventory: roomInv,
    room: { wallpaper: 'wall_basic', floor: 'floor_wood', furniture: [] },
  };
}

function _ensureChar(u) {
  if (!u.character) u.character = _defaultCharacter();
  const c = u.character;
  if (!c.inventory)    c.inventory    = _defaultCharacter().inventory;
  if (!c.equipped)     c.equipped     = _defaultCharacter().equipped;
  if (!c.achievements) c.achievements = [];
  if (!c.level)        c.level        = 1;
  if (c.exp == null)   c.exp          = 0;
  if (!c.roomInventory) c.roomInventory = _defaultCharacter().roomInventory;
  if (!c.room)         c.room         = _defaultCharacter().room;
  // pet 슬롯 마이그레이션
  if (c.equipped.pet !== undefined) {
    c.equipped.pet1 = c.equipped.pet;
    c.equipped.pet2 = 'pet_none';
    delete c.equipped.pet;
  }
  c.equipped.pet1 = c.equipped.pet1 || 'pet_none';
  c.equipped.pet2 = c.equipped.pet2 || 'pet_none';
  return c;
}

// ── 해금 조건 체크 ────────────────────────────────────────
function _checkUnlocks() {
  return Store.tx(db => {
    const name = db.currentUser;
    if (!name || !db.users[name]) return [];
    const u = db.users[name];
    const c = _ensureChar(u);
    const newly = [];

    [[_data.catalog, c.inventory], [_data.roomCatalog, c.roomInventory]].forEach(([catalog, inv]) => {
      catalog.forEach(it => {
        if (inv.includes(it.id)) return;
        const cond = it.unlock;
        let ok = false;
        if      (cond.type === 'default')      ok = true;
        else if (cond.type === 'level')        ok = c.level >= cond.value;
        else if (cond.type === 'streak')       ok = (u.streak || 0) >= cond.value;
        else if (cond.type === 'grade_master') ok = (u.grades || {})[cond.subject] >= 6;
        else if (cond.type === 'achievement')  ok = c.achievements.includes(cond.game + ':' + cond.value);
        if (ok) { inv.push(it.id); newly.push(it); }
      });
    });
    return newly;
  }) || [];
}

// ── Public API ────────────────────────────────────────────
const Items = {
  _data,
  _checkUnlocks,

  /** shared.js onReady 후 호출해 데이터 동기화 */
  sync(sprites, catalog, roomCatalog) {
    _data.sprites    = sprites;
    _data.catalog    = catalog;
    _data.roomCatalog = roomCatalog;
  },

  getCharacter() {
    const u = User.current();
    if (!u) return null;
    return Store.tx(db => {
      const name = db.currentUser;
      if (!name || !db.users[name]) return false;
      return _ensureChar(db.users[name]);
    });
  },

  getById(id) {
    return _data.catalog.find(it => it.id === id) || null;
  },

  getRoomById(id) {
    return _data.roomCatalog.find(it => it.id === id) || null;
  },

  getAllBySlot(slot) {
    const c = Items.getCharacter();
    const owned = new Set(c ? c.inventory : []);
    const catSlot = (slot === 'pet1' || slot === 'pet2') ? 'pet' : slot;
    return _data.catalog.filter(it => it.slot === catSlot).map(it => ({ ...it, unlocked: owned.has(it.id) }));
  },

  getInventoryBySlot(slot) {
    const c = Items.getCharacter();
    if (!c) return [];
    const catSlot = (slot === 'pet1' || slot === 'pet2') ? 'pet' : slot;
    return c.inventory.map(id => Items.getById(id)).filter(it => it && it.slot === catSlot);
  },

  equip(slot, itemId) {
    return Store.tx(db => {
      const name = db.currentUser;
      if (!name || !db.users[name]) return false;
      const c = _ensureChar(db.users[name]);
      const item = Items.getById(itemId);
      if (!item) return false;
      const catSlot = (slot === 'pet1' || slot === 'pet2') ? 'pet' : slot;
      if (item.slot !== catSlot) return false;
      if (!c.inventory.includes(itemId)) return false;
      c.equipped[slot] = itemId;
      return true;
    });
  },

  // ── EXP / 레벨업 ──────────────────────────────────────
  addExp(amount, source) {
    return Store.tx(db => {
      const name = db.currentUser;
      if (!name || !db.users[name]) return null;
      const c = _ensureChar(db.users[name]);
      c.exp = (c.exp || 0) + Math.max(0, amount);
      let leveledUp = false, newItems = [];
      while (c.exp >= LEVEL_EXP(c.level)) {
        c.exp -= LEVEL_EXP(c.level);
        c.level++;
        leveledUp = true;
        newItems = newItems.concat(_checkUnlocks());
      }
      return { leveledUp, newLevel: c.level, exp: c.exp, expToNext: LEVEL_EXP(c.level), newItems, source };
    });
  },

  unlockAchievement(gameId, value) {
    return Store.tx(db => {
      const name = db.currentUser;
      if (!name || !db.users[name]) return false;
      const c = _ensureChar(db.users[name]);
      const key = `${gameId}:${value}`;
      if (c.achievements.includes(key)) return false;
      c.achievements.push(key);
      return _checkUnlocks();
    });
  },

  describeUnlock(item) {
    if (!item?.unlock) return '';
    const { type, value, subject, game } = item.unlock;
    if (type === 'default')      return '';
    if (type === 'level')        return `Lv.${value} 달성 시 해금`;
    if (type === 'streak')       return `${value}일 연속 접속 시 해금`;
    if (type === 'grade_master') return `${subject} 6학년 달성 시 해금`;
    if (type === 'achievement')  return `${game} 특별 업적 달성 시 해금`;
    return '';
  },

  // ── 베이스캠프 ────────────────────────────────────────
  getRoom() {
    const c = Items.getCharacter();
    return c ? c.room : null;
  },

  getAllRoomBySlot(slot) {
    const c = Items.getCharacter();
    const owned = new Set(c ? c.roomInventory : []);
    return _data.roomCatalog.filter(it => it.slot === slot).map(it => ({ ...it, unlocked: owned.has(it.id) }));
  },

  setWallpaper(id) {
    return Store.tx(db => {
      const name = db.currentUser;
      if (!name) return false;
      const c = _ensureChar(db.users[name]);
      if (!c.roomInventory.includes(id)) return false;
      c.room.wallpaper = id; return true;
    });
  },

  setFloor(id) {
    return Store.tx(db => {
      const name = db.currentUser;
      if (!name) return false;
      const c = _ensureChar(db.users[name]);
      if (!c.roomInventory.includes(id)) return false;
      c.room.floor = id; return true;
    });
  },

  toggleFurniture(id) {
    return Store.tx(db => {
      const name = db.currentUser;
      if (!name) return null;
      const c = _ensureChar(db.users[name]);
      if (!c.roomInventory.includes(id)) return null;
      const idx = c.room.furniture.indexOf(id);
      if (idx >= 0) { c.room.furniture.splice(idx, 1); return false; }
      c.room.furniture.push(id); return true;
    });
  },

  // ── 스프라이트 렌더러 ─────────────────────────────────
  _drawGrid(ctx, grid, scale, ox, oy) {
    const pal = _data.sprites.palette || {};
    for (let y = 0; y < grid.length; y++) {
      for (let x = 0; x < grid[y].length; x++) {
        const cell = grid[y][x];
        if (!cell || cell === 0) continue;
        let color = pal[String(cell)];
        if (!color) color = typeof cell === 'string' ? cell : '#000';
        ctx.fillStyle = color;
        ctx.fillRect(ox + x * scale, oy + y * scale, scale, scale);
      }
    }
  },

  renderCharacter(canvas, equipped, scale = 8) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const sp = _data.sprites;
    const get = id => Items.getById(id);

    const bodyItem   = get(equipped?.body)   || get('body_basic');
    const hairItem   = get(equipped?.hair);
    const outfitItem = get(equipped?.outfit);
    const hatItem    = get(equipped?.hat);
    const weaponItem = get(equipped?.weapon);
    const pet1Item   = get(equipped?.pet1 || equipped?.pet);
    const pet2Item   = get(equipped?.pet2);

    [
      bodyItem   && sp.bodies?.[bodyItem.sprite],
      outfitItem && sp.outfits?.[outfitItem.sprite],
      hairItem   && sp.hair?.[hairItem.sprite],
      hatItem    && sp.hats?.[hatItem.sprite],
      weaponItem && sp.weapons?.[weaponItem.sprite],
    ].forEach(g => { if (g) Items._drawGrid(ctx, g, scale, 0, 0); });

    const petScale = scale * 0.65;
    if (pet1Item?.sprite && pet1Item.sprite !== '없음') {
      const g = sp.pets?.[pet1Item.sprite];
      if (g) Items._drawGrid(ctx, g, petScale, -(scale * 1.5), scale * 16 * 0.45);
    }
    if (pet2Item?.sprite && pet2Item.sprite !== '없음') {
      const g = sp.pets?.[pet2Item.sprite];
      if (g) Items._drawGrid(ctx, g, petScale, scale * 16 * 0.85, scale * 16 * 0.45);
    }
  },

  renderCurrentCharacter(canvas, scale) {
    const c = Items.getCharacter();
    if (!c) return;
    Items.renderCharacter(canvas, c.equipped, scale);
  },
};

global.Items = Items;
})(window);
