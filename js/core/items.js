/**
 * @file js/core/items.js  v2
 * 캐릭터 장비, 아이템 카탈로그, EXP/레벨, 스프라이트 렌더러.
 * Store에만 의존. User 직접 참조 제거 — EventBus로 grade:changed/streak:updated 구독.
 */
'use strict';
(function(global) {

const _data = {
  sprites:     { bodies:{}, hair:{}, outfits:{}, hats:{}, weapons:{}, pets:{}, palette:{} },
  catalog:     [],
  roomCatalog: [],
};

const LEVEL_EXP = lvl => lvl * 100;

function _defaultChar() {
  const inv     = _data.catalog.filter(i=>i.unlock.type==='default').map(i=>i.id);
  const roomInv = _data.roomCatalog.filter(i=>i.unlock.type==='default').map(i=>i.id);
  return {
    level:1, exp:0, inventory:inv,
    equipped:{ body:'body_basic', hair:'hair_brown', outfit:'outfit_basic', hat:'hat_none', weapon:'weapon_none', pet1:'pet_none', pet2:'pet_none' },
    achievements:[], roomInventory:roomInv,
    room:{ wallpaper:'wall_basic', floor:'floor_wood', furniture:[] },
  };
}

function _ensureChar(u) {
  if (!u.character) u.character = _defaultChar();
  const c = u.character;
  if (!c.inventory)     c.inventory     = _defaultChar().inventory;
  if (!c.equipped)      c.equipped      = _defaultChar().equipped;
  if (!c.achievements)  c.achievements  = [];
  if (!c.level)         c.level         = 1;
  if (c.exp == null)    c.exp           = 0;
  if (!c.roomInventory) c.roomInventory = _defaultChar().roomInventory;
  if (!c.room)          c.room          = _defaultChar().room;
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

// ── 해금 조건 체크 (이벤트 수신 시 호출) ────────────────────
function _checkUnlocks() {
  return Store.tx(db => {
    const name = db.currentUser;
    if (!name || !db.users[name]) return [];
    const u = db.users[name];
    const c = _ensureChar(u);
    const newly = [];

    [[_data.catalog, c.inventory], [_data.roomCatalog, c.roomInventory]].forEach(([cat, inv]) => {
      cat.forEach(it => {
        if (inv.includes(it.id)) return;
        const { type, value, subject, game } = it.unlock;
        let ok = false;
        if      (type==='default')      ok = true;
        else if (type==='level')        ok = c.level >= value;
        else if (type==='streak')       ok = (u.streak||0) >= value;
        else if (type==='grade_master') ok = (u.grades||{})[subject] >= 6;
        else if (type==='achievement')  ok = c.achievements.includes(`${game}:${value}`);
        if (ok) { inv.push(it.id); newly.push(it); }
      });
    });

    newly.forEach(item => Bus?.emit?.('item:unlocked', { item }));
    return newly;
  }) || [];
}

const Items = {
  _data,
  _checkUnlocks,

  sync(sprites, catalog, roomCatalog) {
    Object.assign(_data, { sprites, catalog: catalog||[], roomCatalog: roomCatalog||[] });
    // 로드 후 즉시 해금 체크 (streak/level 기반 아이템)
    _checkUnlocks();
    Bus?.emit?.('data:ready', {});
  },

  getCharacter() {
    return Store.tx(db => {
      if (!db.currentUser || !db.users[db.currentUser]) return false;
      return _ensureChar(db.users[db.currentUser]);
    });
  },

  getById(id)        { return _data.catalog.find(i=>i.id===id) || null; },
  getRoomById(id)    { return _data.roomCatalog.find(i=>i.id===id) || null; },

  getAllBySlot(slot) {
    const c = Items.getCharacter();
    const owned = new Set(c ? c.inventory : []);
    const cs = (slot==='pet1'||slot==='pet2') ? 'pet' : slot;
    return _data.catalog.filter(i=>i.slot===cs).map(i=>({...i, unlocked:owned.has(i.id)}));
  },

  getInventoryBySlot(slot) {
    const c = Items.getCharacter();
    if (!c) return [];
    const cs = (slot==='pet1'||slot==='pet2') ? 'pet' : slot;
    return c.inventory.map(id=>Items.getById(id)).filter(i=>i&&i.slot===cs);
  },

  equip(slot, itemId) {
    return Store.tx(db => {
      if (!db.currentUser || !db.users[db.currentUser]) return false;
      const c = _ensureChar(db.users[db.currentUser]);
      const item = Items.getById(itemId);
      if (!item) return false;
      const cs = (slot==='pet1'||slot==='pet2') ? 'pet' : slot;
      if (item.slot !== cs || !c.inventory.includes(itemId)) return false;
      c.equipped[slot] = itemId;
      return true;
    });
  },

  addExp(amount, source) {
    return Store.tx(db => {
      if (!db.currentUser || !db.users[db.currentUser]) return null;
      const c = _ensureChar(db.users[db.currentUser]);
      c.exp = (c.exp||0) + Math.max(0, amount);
      let leveledUp = false, newItems = [];
      while (c.exp >= LEVEL_EXP(c.level)) {
        c.exp -= LEVEL_EXP(c.level);
        c.level++;
        leveledUp = true;
        newItems = newItems.concat(_checkUnlocks());
      }
      const result = { leveledUp, newLevel:c.level, exp:c.exp, expToNext:LEVEL_EXP(c.level), newItems, source };
      Bus?.emit?.('exp:gained', { amount, source, total:c.exp });
      if (leveledUp) Bus?.emit?.('level:up', { newLevel:c.level, newItems });
      return result;
    });
  },

  unlockAchievement(gameId, value) {
    return Store.tx(db => {
      if (!db.currentUser || !db.users[db.currentUser]) return false;
      const c = _ensureChar(db.users[db.currentUser]);
      const key = `${gameId}:${value}`;
      if (c.achievements.includes(key)) return false;
      c.achievements.push(key);
      Bus?.emit?.('achievement:unlocked', { gameId, value });
      return _checkUnlocks();
    });
  },

  describeUnlock(item) {
    if (!item?.unlock) return '';
    const { type, value, subject, game } = item.unlock;
    if (type==='default')      return '';
    if (type==='level')        return `Lv.${value} 달성 시 해금`;
    if (type==='streak')       return `${value}일 연속 접속 시 해금`;
    if (type==='grade_master') return `${subject} 6학년 달성 시 해금`;
    if (type==='achievement')  return `${game} 특별 업적 달성 시 해금`;
    return '';
  },

  // 베이스캠프
  getRoom() { const c=Items.getCharacter(); return c?c.room:null; },
  getAllRoomBySlot(slot) { const c=Items.getCharacter(); const o=new Set(c?c.roomInventory:[]); return _data.roomCatalog.filter(i=>i.slot===slot).map(i=>({...i,unlocked:o.has(i.id)})); },
  setWallpaper(id) { return Store.tx(db=>{if(!db.currentUser)return false;const c=_ensureChar(db.users[db.currentUser]);if(!c.roomInventory.includes(id))return false;c.room.wallpaper=id;return true;}); },
  setFloor(id)     { return Store.tx(db=>{if(!db.currentUser)return false;const c=_ensureChar(db.users[db.currentUser]);if(!c.roomInventory.includes(id))return false;c.room.floor=id;return true;}); },
  toggleFurniture(id) { return Store.tx(db=>{if(!db.currentUser)return null;const c=_ensureChar(db.users[db.currentUser]);if(!c.roomInventory.includes(id))return null;const i=c.room.furniture.indexOf(id);if(i>=0){c.room.furniture.splice(i,1);return false;}c.room.furniture.push(id);return true;}); },

  // 스프라이트 렌더러
  _drawGrid(ctx, grid, scale, ox, oy) {
    const pal = _data.sprites.palette || {};
    for (let y=0; y<grid.length; y++) {
      for (let x=0; x<grid[y].length; x++) {
        const cell = grid[y][x];
        if (!cell || cell===0) continue;
        ctx.fillStyle = pal[String(cell)] || (typeof cell==='string'?cell:'#000');
        ctx.fillRect(ox+x*scale, oy+y*scale, scale, scale);
      }
    }
  },

  renderCharacter(canvas, equipped, scale=8) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    const sp = _data.sprites;
    const g  = id => Items.getById(id);
    const body=g(equipped?.body)||g('body_basic'), hair=g(equipped?.hair), outfit=g(equipped?.outfit);
    const hat=g(equipped?.hat), weapon=g(equipped?.weapon);
    const pet1=g(equipped?.pet1||equipped?.pet), pet2=g(equipped?.pet2);
    [body&&sp.bodies?.[body.sprite], outfit&&sp.outfits?.[outfit.sprite], hair&&sp.hair?.[hair.sprite],
     hat&&sp.hats?.[hat.sprite], weapon&&sp.weapons?.[weapon.sprite]]
      .forEach(gr=>{if(gr)Items._drawGrid(ctx,gr,scale,0,0);});
    const ps=scale*0.65;
    if(pet1?.sprite&&pet1.sprite!=='없음'){const gr=sp.pets?.[pet1.sprite];if(gr)Items._drawGrid(ctx,gr,ps,-(scale*1.5),scale*16*0.45);}
    if(pet2?.sprite&&pet2.sprite!=='없음'){const gr=sp.pets?.[pet2.sprite];if(gr)Items._drawGrid(ctx,gr,ps,scale*16*0.85,scale*16*0.45);}
  },

  renderCurrentCharacter(canvas, scale) {
    const c = Items.getCharacter();
    if (c) Items.renderCharacter(canvas, c.equipped, scale);
  },

  LEVEL_EXP,
};

// EventBus 구독 — grade 변경/streak 업데이트 시 해금 체크
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    Bus?.on?.('grade:changed', () => _checkUnlocks());
    Bus?.on?.('streak:updated', () => _checkUnlocks());
    Bus?.on?.('achievement:unlocked', () => _checkUnlocks());
  });
}

if (global.Container) Container.register('Items', Items);
global.Items = Items;
})(window);
