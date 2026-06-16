/**
 * @file js/battle-engine.js
 * 재사용 가능한 2D 전투 씬 엔진
 * - 캐릭터 스프라이트 (shared.js renderCharacter 기반)
 * - 몬스터 픽셀아트 (내장)
 * - 공격/피격/스킬/사망 애니메이션
 * - 파티클 이펙트
 * - 상용 게임 수준의 타격감
 *
 * 사용법:
 *   const engine = new BattleEngine(canvasEl, options);
 *   engine.setHero(equipped);         // LearningHub equipped 객체
 *   engine.setMonster(monsterDef);
 *   engine.playHeroAttack(skill);     // 'slash'|'magic'|'arrow'|'skill'
 *   engine.playMonsterAttack();
 *   engine.playMonsterDeath();
 *   engine.on('attackEnd', callback);
 */

'use strict';

(function(global) {

// ═══════════════════════════════════════════════════════
// 몬스터 픽셀아트 정의 (32×32 grid, 팔레트 인덱스)
// ═══════════════════════════════════════════════════════
const MONSTER_SPRITES = {
  goblin: {
    color: '#4a7c3f',
    frames: {
      idle: _buildGrid([
        '....GGGG....',
        '...GGGGGGG..',
        '..GGEGEEG...',
        '..GG.GG.GG..',
        '...GGGGG....',
        '....GGG.....',
        '...GGGG.....',
        '..GG..GG....',
        '.G......G...',
        '....GG......',
        '....GG......',
        '....GG......',
      ], { G:'#4a7c3f', E:'#ff2222' }),
      attack: _buildGrid([
        '....GGGG....',
        '...GGGGGGG..',
        '..GGEGEEG...',
        '..GG.GG.GG..',
        '...GGGGG....',
        '...GGG......',
        '...GGGG.....',
        '..GG..GGGGG.',
        '.G......GGGG',
        '....GG......',
        '....GG......',
        '....GG......',
      ], { G:'#4a7c3f', E:'#ff2222' }),
      hurt: _buildGrid([
        '....GGGG....',
        '...GGGGGGG..',
        '..GGxGxEG...',
        '..GG.GG.GG..',
        '...GGGGG....',
        '....GGG.....',
        '...GGGG.....',
        '..GG..GG....',
        '.G......G...',
        '....GG......',
        '....GG......',
        '....GG......',
      ], { G:'#4a7c3f', E:'#ff2222', x:'#ffffff' }),
    }
  },
  skeleton: {
    color: '#e8dcc8',
    frames: {
      idle: _buildGrid([
        '....WWWW....',
        '...WWWWWWW..',
        '..WWoWWoWW..',
        '...WWWWWWW..',
        '....WWWWW...',
        '...WWWWWWW..',
        '..WW.WW.WW..',
        '.WW.WW.WW...',
        '....WW......',
        '...WWWWW....',
        '..WW...WW...',
        '..WW...WW...',
      ], { W:'#e8dcc8', o:'#222' }),
      attack: _buildGrid([
        '....WWWW....',
        '...WWWWWWW..',
        '..WWoWWoWW..',
        '...WWWWWWW..',
        '....WWWWW...',
        '...WWWWWWWWW',
        '..WW.WW.WWWW',
        '.WW.WW.WWWWW',
        '....WW......',
        '...WWWWW....',
        '..WW...WW...',
        '..WW...WW...',
      ], { W:'#e8dcc8', o:'#222' }),
      hurt: _buildGrid([
        '....WWWW....',
        '...WWWWWWW..',
        '..WWxWWxWW..',
        '...WWWWWWW..',
        '....WWWWW...',
        '...WWWWWWW..',
        '..WW.WW.WW..',
        '.WW.WW.WW...',
        '....WW......',
        '...WWWWW....',
        '..WW...WW...',
        '..WW...WW...',
      ], { W:'#e8dcc8', o:'#222', x:'#ff8888' }),
    }
  },
  dragon: {
    color: '#8b2020',
    frames: {
      idle: _buildGrid([
        '...DDDDDD...',
        '..DDDDDDDD..',
        '.DDEDDDEDDd.',
        '.DDDDDDDDDD.',
        '..DDDDDDDD..',
        '..DDDDDDDD..',
        '.DDDDDDDDDD.',
        'DDDDDDDDDDDD',
        '.DDDDDDDDDD.',
        '...DDDDDD...',
        '..DD....DD..',
        '.DD......DD.',
      ], { D:'#8b2020', E:'#ffd700', d:'#b33030' }),
      attack: _buildGrid([
        '...DDDDDD...',
        '..DDDDDDDD..',
        '.DDEDDDEDDd.',
        '.DDDDDDDDDD.',
        '..DDDDDDDD..',
        '..DDDDDDDDff',
        '.DDDDDDDDfff',
        'DDDDDDDDDfff',
        '.DDDDDDDDDD.',
        '...DDDDDD...',
        '..DD....DD..',
        '.DD......DD.',
      ], { D:'#8b2020', E:'#ffd700', d:'#b33030', f:'#ff6600' }),
      hurt: _buildGrid([
        '...DDDDDD...',
        '..DDxDDxDD..',
        '.DDEDDDEDDd.',
        '.DDxDDDDxDD.',
        '..DDDDDDDD..',
        '..DDDDDDDD..',
        '.DDDDDDDDDD.',
        'DDDDDDDDDDDD',
        '.DDDDDDDDDD.',
        '...DDDDDD...',
        '..DD....DD..',
        '.DD......DD.',
      ], { D:'#8b2020', E:'#ffd700', d:'#b33030', x:'#ffffff' }),
    }
  },
  wizard: {
    color: '#5b2d8e',
    frames: {
      idle: _buildGrid([
        '....PPPP....',
        '...PPPPPP...',
        '..PPpppPPP..',
        '..PP.PP.PP..',
        '...PPPPPP...',
        '....PPPP....',
        '...PPPPPP...',
        '..PP.PP.PP..',
        '.PP..PP..PP.',
        '....PP......',
        '....PP......',
        '....PP......',
      ], { P:'#5b2d8e', p:'#ffd700' }),
      attack: _buildGrid([
        '....PPPP....',
        '...PPPPPP...',
        '..PPpppPPP..',
        '..PP.PP.PP..',
        '...PPPPPP...',
        '....PPPPSSSS',
        '...PPPPPPSS.',
        '..PP.PP.PP..',
        '.PP..PP..PP.',
        '....PP......',
        '....PP......',
        '....PP......',
      ], { P:'#5b2d8e', p:'#ffd700', S:'#00eeff' }),
      hurt: _buildGrid([
        '....PPPP....',
        '...PPxPPP...',
        '..PPpppPPP..',
        '..PP.xP.PP..',
        '...PPPPPP...',
        '....PPPP....',
        '...PPPPPP...',
        '..PP.PP.PP..',
        '.PP..PP..PP.',
        '....PP......',
        '....PP......',
        '....PP......',
      ], { P:'#5b2d8e', p:'#ffd700', x:'#ff8888' }),
    }
  },
  slime_king: {
    color: '#1565c0',
    frames: {
      idle: _buildGrid([
        '...SSSSSS...',
        '..SSSSSSSS..',
        '.SSSoSSoSSS.',
        '.SSSSSSSSSS.',
        '.SSSSSSSSSS.',
        '..SSSSSSSS..',
        '...SSSSSS...',
        '..SSSSSSSS..',
        '.SSSSSSSSSS.',
        'SSSSSSSSSSSS',
        '.SSSSSSSSSS.',
        '...SSSSSS...',
      ], { S:'#1565c0', o:'#fff' }),
      attack: _buildGrid([
        '...SSSSSS...',
        '..SSSSSSSS..',
        '.SSSoSSoSSS.',
        '.SSSSSSSSSS.',
        '.SSSSSSSSSS.',
        '..SSSSSSSS..',
        'SSSSSSSSSSSS',
        'SSSSSSSSSSSS',
        'SSSSSSSSSSSS',
        'SSSSSSSSSSSS',
        '.SSSSSSSSSS.',
        '...SSSSSS...',
      ], { S:'#1565c0', o:'#fff' }),
      hurt: _buildGrid([
        '...SSSSSS...',
        '..SSxSSxSS..',
        '.SSSoSSoSSS.',
        '.SSSSSSSSSS.',
        '.SSxSSSSxSS.',
        '..SSSSSSSS..',
        '...SSSSSS...',
        '..SSSSSSSS..',
        '.SSSSSSSSSS.',
        'SSSSSSSSSSSS',
        '.SSSSSSSSSS.',
        '...SSSSSS...',
      ], { S:'#1565c0', o:'#fff', x:'#ffffff' }),
    }
  },
};

function _buildGrid(rows, colorMap) {
  // 각 행을 12칸으로 맞추고 팔레트 인덱스나 hex색상 배열로 변환
  return rows.map(row => {
    const cells = [];
    for (let i = 0; i < 12; i++) {
      const ch = row[i] || '.';
      cells.push(ch === '.' ? 0 : (colorMap[ch] || '#888'));
    }
    return cells;
  });
}

// ═══════════════════════════════════════════════════════
// 스킬 이펙트 정의
// ═══════════════════════════════════════════════════════
const SKILL_EFFECTS = {
  slash:  { color:'#e0e0ff', type:'slash',  name:'베기',   weaponTypes:['검','번개창','성검'] },
  magic:  { color:'#a855f7', type:'magic',  name:'마법',   weaponTypes:['마법지팡이','마법봉','무지개활'] },
  arrow:  { color:'#fbbf24', type:'arrow',  name:'화살',   weaponTypes:['활','무지개활','망원경'] },
  shield: { color:'#60a5fa', type:'shield', name:'방어',   weaponTypes:['방패','나침반'] },
  book:   { color:'#34d399', type:'book',   name:'지식탄', weaponTypes:['책','지도'] },
  punch:  { color:'#f97316', type:'punch',  name:'주먹',   weaponTypes:[] }, // default
};

// ═══════════════════════════════════════════════════════
// BattleEngine 클래스
// ═══════════════════════════════════════════════════════
class BattleEngine {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.W = canvas.width;
    this.H = canvas.height;
    this.opts = Object.assign({
      bgColor: '#0a0a1a',
      groundY: 0.72,    // 바닥선 비율
      heroX:   0.22,
      enemyX:  0.72,
    }, opts);

    this._equipped = null;
    this._monster = null;
    this._frame = 'idle';
    this._monsterFrame = 'idle';
    this._particles = [];
    this._floatTexts = [];
    this._callbacks = {};
    this._animId = null;
    this._heroState = { x:0, y:0, shakeX:0, shakeY:0, alpha:1, scaleX:1, scaleY:1 };
    this._monsterState = { x:0, y:0, shakeX:0, shakeY:0, alpha:1, scaleX:1, scaleY:1 };

    this._loop = this._loop.bind(this);
    this._animId = requestAnimationFrame(this._loop);
  }

  // ── 공개 API ──────────────────────────────────────────
  setHero(equipped) {
    this._equipped = equipped;
  }

  setMonster(def) {
    // def: { id:'goblin', name:'고블린', level:1 }
    this._monster = def;
    this._monsterFrame = 'idle';
    this._monsterState = { x:0, y:0, shakeX:0, shakeY:0, alpha:1, scaleX:1, scaleY:1 };
  }

  on(event, cb) { this._callbacks[event] = cb; }
  _emit(event, data) { if (this._callbacks[event]) this._callbacks[event](data); }

  /**
   * 영웅 공격 시퀀스
   * @param {string} skillType - 'slash'|'magic'|'arrow'|'skill'|'auto'
   */
  playHeroAttack(skillType) {
    const skill = this._resolveSkill(skillType);
    this._runHeroAttackAnim(skill);
  }

  /** 몬스터 공격 (오답 시) */
  playMonsterAttack() {
    this._runMonsterAttackAnim();
  }

  /** 몬스터 사망 */
  playMonsterDeath(onEnd) {
    this._runMonsterDeathAnim(onEnd);
  }

  /** 영웅 피격 */
  playHeroDamage(dmg) {
    this._spawnFloatText(`-${dmg}`, this.W * this.opts.heroX, this.H * 0.3, '#f87171');
    this._shakeEl(this._heroState, 12, 200);
    this._addParticles(this.W * this.opts.heroX + 24, this.H * this.opts.groundY - 30, '#ef4444', 6);
  }

  /** 스테이지 클리어 연출 */
  playStageClear() {
    for (let i = 0; i < 30; i++) {
      setTimeout(() => {
        const x = Math.random() * this.W;
        const y = Math.random() * this.H * 0.6;
        const colors = ['#ffd700','#ff6b9d','#a855f7','#06b6d4','#4ade80'];
        this._addParticles(x, y, colors[Math.floor(Math.random()*colors.length)], 5);
      }, i * 60);
    }
  }

  destroy() {
    cancelAnimationFrame(this._animId);
  }

  // ── 스킬 결정 ──────────────────────────────────────────
  _resolveSkill(type) {
    if (type && type !== 'auto') return SKILL_EFFECTS[type] || SKILL_EFFECTS.punch;
    // 무기 기반 자동 결정
    if (this._equipped && this._equipped.weapon) {
      const weaponSprite = (window.LearningHub?.getItemById?.(this._equipped.weapon)?.sprite) || '';
      for (const [key, skill] of Object.entries(SKILL_EFFECTS)) {
        if (skill.weaponTypes.some(w => weaponSprite.includes(w))) return skill;
      }
    }
    return SKILL_EFFECTS.slash;
  }

  // ── 공격 애니메이션 시퀀스 ──────────────────────────────
  _runHeroAttackAnim(skill) {
    const hs = this._heroState;
    const ms = this._monsterState;
    const heroX = this.W * this.opts.heroX;
    const enemyX = this.W * this.opts.enemyX;
    const groundY = this.H * this.opts.groundY;

    const timeline = [];

    if (skill.type === 'slash' || skill.type === 'punch') {
      // 돌격 → 베기 → 복귀
      timeline.push(
        { t:0,   fn: () => { this._tweenX(hs, heroX, enemyX - 50, 200); } },
        { t:200, fn: () => {
          this._spawnSlashEffect(enemyX - 20, groundY - 50, skill.color);
          this._monsterFrame = 'hurt';
          this._shakeEl(ms, 18, 250);
          this._addParticles(enemyX, groundY - 40, skill.color, 14);
          this._spawnFloatText('SLASH!', enemyX, groundY - 90, skill.color);
        }},
        { t:280, fn: () => { this._tweenX(hs, enemyX - 50, heroX, 200); } },
        { t:480, fn: () => { this._monsterFrame = 'idle'; this._emit('attackEnd', skill); } },
      );
    } else if (skill.type === 'magic') {
      // 제자리에서 마법 투사체 발사
      timeline.push(
        { t:0,   fn: () => { hs.scaleY = 1.05; } },
        { t:100, fn: () => { this._spawnProjectile(heroX + 30, groundY - 60, enemyX, groundY - 50, skill.color, 'magic'); } },
        { t:350, fn: () => {
          this._monsterFrame = 'hurt';
          this._shakeEl(ms, 14, 280);
          this._addParticles(enemyX, groundY - 50, skill.color, 18);
          this._spawnFloatText('MAGIC!', enemyX, groundY - 95, skill.color);
          this._spawnRingEffect(enemyX, groundY - 50, skill.color);
        }},
        { t:500, fn: () => { hs.scaleY = 1; this._monsterFrame = 'idle'; this._emit('attackEnd', skill); } },
      );
    } else if (skill.type === 'arrow') {
      // 활 투사체
      timeline.push(
        { t:0,   fn: () => { } },
        { t:80,  fn: () => { this._spawnProjectile(heroX + 30, groundY - 65, enemyX - 10, groundY - 55, skill.color, 'arrow'); } },
        { t:320, fn: () => {
          this._monsterFrame = 'hurt';
          this._shakeEl(ms, 12, 220);
          this._addParticles(enemyX, groundY - 50, skill.color, 10);
          this._spawnFloatText('CRITICAL!', enemyX, groundY - 95, skill.color);
        }},
        { t:480, fn: () => { this._monsterFrame = 'idle'; this._emit('attackEnd', skill); } },
      );
    } else if (skill.type === 'book') {
      // 지식 충격파
      timeline.push(
        { t:0,   fn: () => { this._spawnShockwave(heroX + 30, groundY - 40, skill.color); } },
        { t:300, fn: () => {
          this._monsterFrame = 'hurt';
          this._shakeEl(ms, 16, 300);
          this._addParticles(enemyX, groundY - 45, skill.color, 16);
          this._spawnFloatText('WISDOM!', enemyX, groundY - 95, skill.color);
        }},
        { t:500, fn: () => { this._monsterFrame = 'idle'; this._emit('attackEnd', skill); } },
      );
    } else {
      // shield / default
      timeline.push(
        { t:0,   fn: () => { this._spawnShieldEffect(heroX, groundY - 50, skill.color); } },
        { t:200, fn: () => {
          this._monsterFrame = 'hurt';
          this._shakeEl(ms, 10, 200);
          this._addParticles(enemyX, groundY - 40, skill.color, 8);
          this._spawnFloatText('HIT!', enemyX, groundY - 90, skill.color);
        }},
        { t:400, fn: () => { this._monsterFrame = 'idle'; this._emit('attackEnd', skill); } },
      );
    }

    timeline.forEach(({ t, fn }) => setTimeout(fn, t));
  }

  _runMonsterAttackAnim() {
    const ms = this._monsterState;
    const hs = this._heroState;
    const heroX = this.W * this.opts.heroX;
    const enemyX = this.W * this.opts.enemyX;
    const groundY = this.H * this.opts.groundY;

    [
      { t:0,   fn: () => { this._monsterFrame = 'attack'; this._tweenX(ms, 0, -(enemyX - heroX - 60), 180); } },
      { t:180, fn: () => {
        this._shakeEl(hs, 16, 280);
        this._addParticles(heroX + 24, groundY - 40, '#ef4444', 10);
        this._spawnFloatText('ATTACK!', heroX, groundY - 95, '#ef4444');
      }},
      { t:280, fn: () => { this._tweenX(ms, -(enemyX - heroX - 60), 0, 200); } },
      { t:480, fn: () => { this._monsterFrame = 'idle'; this._emit('monsterAttackEnd'); } },
    ].forEach(({ t, fn }) => setTimeout(fn, t));
  }

  _runMonsterDeathAnim(onEnd) {
    const ms = this._monsterState;
    const enemyX = this.W * this.opts.enemyX;
    const groundY = this.H * this.opts.groundY;

    this.playStageClear();
    [
      { t:0,   fn: () => { this._shakeEl(ms, 20, 150); } },
      { t:150, fn: () => { this._tweenAlpha(ms, 1, 0, 500); } },
      { t:200, fn: () => { this._addParticles(enemyX, groundY - 50, '#ffd700', 25); this._addParticles(enemyX, groundY - 50, '#ff6b9d', 15); } },
      { t:650, fn: () => { ms.alpha = 1; if (onEnd) onEnd(); this._emit('monsterDead'); } },
    ].forEach(({ t, fn }) => setTimeout(fn, t));
  }

  // ── 이펙트들 ───────────────────────────────────────────
  _spawnParticle(x, y, color, vx, vy, life) {
    this._particles.push({ x, y, vx, vy, life, maxLife: life, color, size: 3 + Math.random() * 3 });
  }

  _addParticles(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const angle = (Math.PI * 2 * i) / n + Math.random() * 0.3;
      const speed = 2 + Math.random() * 4;
      this._spawnParticle(x, y, color, Math.cos(angle) * speed, Math.sin(angle) * speed - 1, 40 + Math.random() * 20);
    }
  }

  _spawnFloatText(text, x, y, color) {
    this._floatTexts.push({ text, x, y: y, vy: -1.5, life: 60, color, alpha: 1 });
  }

  _spawnSlashEffect(x, y, color) {
    // 슬래시 이펙트: 휘어진 선
    this._particles.push({
      type: 'slash', x, y, color, life: 20, alpha: 1,
      angle: -Math.PI / 4, len: 60,
    });
  }

  _spawnProjectile(x1, y1, x2, y2, color, type) {
    const dx = x2 - x1, dy = y2 - y1;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const steps = 30;
    this._particles.push({
      type: 'projectile', x: x1, y: y1,
      vx: dx / steps, vy: dy / steps,
      life: steps, color, projType: type,
      trail: [],
    });
  }

  _spawnRingEffect(x, y, color) {
    this._particles.push({ type: 'ring', x, y, color, r: 5, maxR: 60, life: 30 });
  }

  _spawnShockwave(x, y, color) {
    for (let i = 0; i < 3; i++) {
      setTimeout(() => {
        this._particles.push({ type: 'ring', x, y, color, r: 5, maxR: 80, life: 25 });
      }, i * 80);
    }
  }

  _spawnShieldEffect(x, y, color) {
    this._particles.push({ type: 'shield', x, y, color, life: 30, r: 0, maxR: 45 });
  }

  // ── 트윈 헬퍼 ──────────────────────────────────────────
  _tweenX(state, from, to, dur) {
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      state.x = from + (to - from) * ease;
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  _tweenAlpha(state, from, to, dur) {
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / dur);
      state.alpha = from + (to - from) * t;
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  _shakeEl(state, amp, dur) {
    const start = performance.now();
    const tick = (now) => {
      const t = (now - start) / dur;
      if (t >= 1) { state.shakeX = 0; state.shakeY = 0; return; }
      const decay = 1 - t;
      state.shakeX = (Math.random() - 0.5) * amp * decay * 2;
      state.shakeY = (Math.random() - 0.5) * amp * decay;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // ── 메인 렌더 루프 ──────────────────────────────────────
  _loop() {
    this._animId = requestAnimationFrame(this._loop);
    const ctx = this.ctx;
    const W = this.W, H = this.H;
    const groundY = H * this.opts.groundY;

    // 배경
    ctx.fillStyle = this.opts.bgColor;
    ctx.fillRect(0, 0, W, H);

    // 배경 그라데이션
    const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0, 'rgba(30,20,60,0.8)');
    bgGrad.addColorStop(1, 'rgba(10,10,26,0.8)');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    // 그리드 배경
    ctx.strokeStyle = 'rgba(100,100,200,0.05)';
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 32) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = 0; y < H; y += 32) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    // 바닥선
    const floorGrad = ctx.createLinearGradient(0, groundY - 2, 0, groundY + 8);
    floorGrad.addColorStop(0, 'rgba(120,100,255,0.4)');
    floorGrad.addColorStop(1, 'rgba(120,100,255,0)');
    ctx.fillStyle = floorGrad;
    ctx.fillRect(0, groundY - 2, W, 10);

    // 바닥 반사 글로우
    const glowGrad = ctx.createRadialGradient(W/2, groundY, 0, W/2, groundY, W * 0.4);
    glowGrad.addColorStop(0, 'rgba(100,80,255,0.06)');
    glowGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glowGrad;
    ctx.fillRect(0, groundY - 10, W, 40);

    // 파티클 업데이트+렌더
    this._updateParticles(ctx, groundY);

    // 영웅 그림자
    const hs = this._heroState;
    const heroDrawX = W * this.opts.heroX + hs.x + hs.shakeX;
    ctx.save();
    ctx.globalAlpha = 0.25 * hs.alpha;
    ctx.fillStyle = '#000';
    ctx.scale(1, 0.3);
    ctx.beginPath();
    ctx.ellipse(heroDrawX + 20, groundY / 0.3, 18, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 영웅 스프라이트
    if (this._equipped && window.LearningHub?.renderCharacter) {
      const offscreen = document.createElement('canvas');
      offscreen.width = 128; offscreen.height = 128;
      window.LearningHub.renderCharacter(offscreen, this._equipped, 8);
      ctx.save();
      ctx.globalAlpha = hs.alpha;
      ctx.translate(heroDrawX + hs.shakeX, groundY - 100 + hs.shakeY);
      ctx.scale(hs.scaleX, hs.scaleY);
      ctx.drawImage(offscreen, -40, -8, 100, 108);
      ctx.restore();
    }

    // 몬스터
    const ms = this._monsterState;
    const monX = W * this.opts.enemyX + ms.x + ms.shakeX;
    const monY = groundY + ms.shakeY;
    this._drawMonster(ctx, monX, monY, ms.alpha, ms.scaleX, ms.scaleY);

    // 플로팅 텍스트
    this._updateFloatTexts(ctx);
  }

  _drawMonster(ctx, x, y, alpha, scaleX, scaleY) {
    if (!this._monster) return;
    const sprite = MONSTER_SPRITES[this._monster.id] || MONSTER_SPRITES.goblin;
    const frame = sprite.frames[this._monsterFrame] || sprite.frames.idle;
    const cellSize = Math.floor(Math.min(this.W, this.H * 1.2) / 14);

    // 그림자
    ctx.save();
    ctx.globalAlpha = 0.2 * alpha;
    ctx.fillStyle = '#000';
    ctx.scale(1, 0.25);
    ctx.beginPath();
    ctx.ellipse(x, y / 0.25, cellSize * 6, cellSize * 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 피격 시 발광
    if (this._monsterFrame === 'hurt') {
      ctx.save();
      ctx.globalAlpha = 0.3 * alpha;
      ctx.fillStyle = '#ff4444';
      ctx.shadowColor = '#ff0000'; ctx.shadowBlur = 20;
      ctx.beginPath();
      ctx.ellipse(x, y - cellSize * 6, cellSize * 6, cellSize * 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 몬스터 그리드 렌더
    ctx.save();
    ctx.globalAlpha = alpha;
    const offsetX = x - cellSize * 6;
    const offsetY = y - cellSize * 12;
    frame.forEach((row, rowIdx) => {
      row.forEach((cell, colIdx) => {
        if (!cell || cell === 0) return;
        ctx.fillStyle = cell;
        ctx.fillRect(
          offsetX + colIdx * cellSize,
          offsetY + rowIdx * cellSize,
          cellSize - 1, cellSize - 1
        );
      });
    });
    ctx.restore();

    // 체력바 (optional, 외부에서 관리하지만 시각적으로 표시)
    if (this._monster.hpPct !== undefined) {
      const barW = cellSize * 10;
      const barX = x - barW / 2;
      const barY = y - cellSize * 13 - 10;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(barX - 1, barY - 1, barW + 2, 7);
      ctx.fillStyle = this._monster.hpPct > 0.5 ? '#22c55e' : this._monster.hpPct > 0.25 ? '#f59e0b' : '#ef4444';
      ctx.fillRect(barX, barY, barW * this._monster.hpPct, 5);
    }
  }

  _updateParticles(ctx, groundY) {
    this._particles = this._particles.filter(p => {
      if (p.life <= 0) return false;
      p.life--;

      if (p.type === 'slash') {
        const alpha = p.life / 20;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 4;
        ctx.shadowColor = p.color; ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.translate(p.x, p.y);
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.moveTo(-p.len/2 + i*10, -p.len/3 + i*8);
          ctx.quadraticCurveTo(i*5, -p.len/6, p.len/2 + i*10, p.len/4 + i*8);
          ctx.stroke();
        }
        ctx.restore();
      } else if (p.type === 'projectile') {
        p.trail.push({ x: p.x, y: p.y });
        if (p.trail.length > 8) p.trail.shift();
        p.x += p.vx; p.y += p.vy;

        // 꼬리
        p.trail.forEach((pt, i) => {
          const a = (i / p.trail.length) * 0.6;
          ctx.save();
          ctx.globalAlpha = a;
          ctx.fillStyle = p.color;
          ctx.shadowColor = p.color; ctx.shadowBlur = 8;
          ctx.beginPath();
          const r = p.projType === 'magic' ? 6 : 4;
          ctx.arc(pt.x, pt.y, r * (i / p.trail.length), 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        });

        // 투사체 헤드
        ctx.save();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#fff';
        ctx.shadowColor = p.color; ctx.shadowBlur = 16;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.projType === 'magic' ? 7 : 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else if (p.type === 'ring') {
        const t = 1 - p.life / 30;
        p.r = p.maxR * t;
        const alpha = (1 - t) * 0.8;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 3 - t * 2;
        ctx.shadowColor = p.color; ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      } else if (p.type === 'shield') {
        const t = 1 - p.life / 30;
        p.r = p.maxR * (1 - Math.pow(1-t, 2));
        const alpha = t < 0.7 ? t/0.7 : (1-t)/0.3;
        ctx.save();
        ctx.globalAlpha = alpha * 0.7;
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color; ctx.shadowBlur = 20;
        ctx.beginPath();
        // 방패 모양
        ctx.moveTo(p.x, p.y - p.r);
        ctx.quadraticCurveTo(p.x + p.r, p.y - p.r, p.x + p.r, p.y);
        ctx.quadraticCurveTo(p.x + p.r, p.y + p.r * 0.6, p.x, p.y + p.r);
        ctx.quadraticCurveTo(p.x - p.r, p.y + p.r * 0.6, p.x - p.r, p.y);
        ctx.quadraticCurveTo(p.x - p.r, p.y - p.r, p.x, p.y - p.r);
        ctx.fill();
        ctx.restore();
      } else {
        // 기본 파티클
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.15; // gravity
        p.vx *= 0.96;
        if (p.y > groundY + 10) return false;

        const alpha = p.life / p.maxLife;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color; ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      return true;
    });
  }

  _updateFloatTexts(ctx) {
    this._floatTexts = this._floatTexts.filter(ft => {
      ft.y += ft.vy;
      ft.life--;
      ft.alpha = ft.life / 60;
      if (ft.life <= 0) return false;

      ctx.save();
      ctx.globalAlpha = ft.alpha;
      ctx.font = `bold ${Math.round(11 + (1 - ft.alpha) * 4)}px 'Malgun Gothic', sans-serif`;
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 3;
      ctx.textAlign = 'center';
      ctx.shadowColor = ft.color; ctx.shadowBlur = 12;
      ctx.strokeText(ft.text, ft.x, ft.y);
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, ft.x, ft.y);
      ctx.restore();
      return true;
    });
  }
}

// ── 몬스터 정의 프리셋 ─────────────────────────────────────
BattleEngine.MONSTERS = [
  { id:'goblin',     name:'고블린',      color:'#4a7c3f', hp:80,  level:1, expIcon:'🧮' },
  { id:'skeleton',   name:'해골 전사',   color:'#e8dcc8', hp:100, level:2, expIcon:'📐' },
  { id:'wizard',     name:'마법사 적',   color:'#5b2d8e', hp:90,  level:3, expIcon:'✨' },
  { id:'slime_king', name:'슬라임 왕',   color:'#1565c0', hp:120, level:4, expIcon:'👑' },
  { id:'dragon',     name:'미니 드래곤', color:'#8b2020', hp:150, level:5, expIcon:'🐉' },
];

BattleEngine.SKILL_EFFECTS = SKILL_EFFECTS;
BattleEngine.MONSTER_SPRITES = MONSTER_SPRITES;

global.BattleEngine = BattleEngine;
})(window);
