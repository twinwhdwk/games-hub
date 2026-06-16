/**
 * @file js/battle-engine.js  v2.0
 * 상용 수준 2D 전투 씬 엔진
 *
 * 주요 기능:
 * - RAF 기반 정밀 타임라인 (setTimeout 없음)
 * - 히어로 스프라이트 오프스크린 캐시
 * - 배경 다층 패럴랙스 (하늘/구름/산/지면)
 * - Web Audio API 사운드 (타격/마법/BGM)
 * - 몬스터 32×20 픽셀아트 + idle/walk/attack/hurt/die 5프레임
 * - 스킬 차지 게이지 + 필살기 연출
 * - 아이템 드롭 / 경험치 파티클
 * - 스테이지 진입·클리어·게임오버 씬 전환
 */
'use strict';
(function(global){

// ═══════════════════════════════════════════════════════
// 사운드 엔진 (Web Audio API)
// ═══════════════════════════════════════════════════════
const SFX = (() => {
  let ctx = null;
  function getCtx() {
    if (!ctx) {
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) {}
    }
    return ctx;
  }

  function tone(freq, type, vol, dur, delay=0) {
    const c = getCtx(); if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    o.connect(g); g.connect(c.destination);
    o.type = type; o.frequency.setValueAtTime(freq, c.currentTime + delay);
    g.gain.setValueAtTime(vol, c.currentTime + delay);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + delay + dur);
    o.start(c.currentTime + delay);
    o.stop(c.currentTime + delay + dur + 0.01);
  }

  function noise(vol, dur, delay=0) {
    const c = getCtx(); if (!c) return;
    const buf = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * vol;
    const src = c.createBufferSource(), g = c.createGain();
    src.buffer = buf; src.connect(g); g.connect(c.destination);
    g.gain.setValueAtTime(vol, c.currentTime + delay);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + delay + dur);
    src.start(c.currentTime + delay);
  }

  return {
    slash()  { noise(0.25,0.08); tone(400,'sawtooth',0.1,0.06,0.02); tone(200,'sawtooth',0.08,0.1,0.04); },
    magic()  { [0,0.05,0.1,0.15,0.2].forEach((d,i)=>tone(300+i*200,'sine',0.08,0.18,d)); },
    arrow()  { tone(900,'square',0.08,0.04); tone(600,'square',0.06,0.04,0.03); noise(0.12,0.05,0.04); },
    hit()    { noise(0.3,0.12); tone(150,'sawtooth',0.15,0.12); },
    hurt()   { tone(200,'square',0.12,0.15); noise(0.2,0.1,0.05); },
    death()  { [0,0.08,0.16,0.24,0.32].forEach((d,i)=>tone(180-i*25,'sawtooth',0.12,0.18,d)); },
    levelup(){ [0,0.1,0.2,0.3].forEach((d,i)=>{ const f=[400,500,600,800][i]; tone(f,'sine',0.12,0.12,d); }); },
    item()   { [0,0.06,0.12].forEach((d,i)=>tone([600,750,900][i],'sine',0.1,0.1,d)); },
    clear()  { [[400,0],[500,0.08],[600,0.16],[800,0.24],[1000,0.32]].forEach(([f,d])=>{ tone(f,'sine',0.12,0.15,d); }); },
    gameover(){ [0,0.15,0.3,0.5].forEach((d,i)=>tone([300,250,200,150][i],'sawtooth',0.1,0.18,d)); },
    charge(p){ const f=200+p*600; tone(f,'sine',0.06,0.05); },
    ultimate(){ [0,0.04,0.08,0.12,0.16,0.2].forEach((d,i)=>{ tone(200+i*100,'sawtooth',0.15,0.2,d); tone(300+i*150,'sine',0.1,0.2,d+0.01); }); noise(0.3,0.3); },
  };
})();

// ═══════════════════════════════════════════════════════
// 몬스터 픽셀아트 (20×14 칸, 각 칸=cellSize px)
// ═══════════════════════════════════════════════════════
function mkGrid(rows, pal) {
  return rows.map(r=>[...r].map(c=>c==='.'?0:pal[c]||c));
}

const M = {
  goblin: {
    palette:{ G:'#3d6b33', g:'#2d5028', E:'#ff3333', e:'#cc0000', S:'#b8860b', s:'#8b6914', W:'#deb887', t:'#8fbc8f' },
    size:[12,10],
    frames:{
      idle:[
        '....GGgg....',
        '...GGGGGGg..',
        '..GGEgGEGG..',
        '..GGgGGgGG..',
        '...GGeSGG...',
        '....GGGG....',
        '..ggGGGGgg..',
        '.gGGGGGGGGg.',
        '....gg.gg...',
        '....GG.GG...',
      ],
      walk:[
        '....GGgg....',
        '...GGGGGGg..',
        '..GGEgGEGG..',
        '..GGgGGgGG..',
        '...GGeSGG...',
        '....GGGG....',
        '..ggGGGGgg..',
        '.gGGGGGGGGg.',
        '...ggg.gg...',
        '...GG..GGg..',
      ],
      attack:[
        '....GGgg....',
        '...GGGGGGg..',
        '..GGEgGEGG..',
        '..GGgGGgGG..',
        '...GGeSSSSS.',
        '....GGGGGgGG',
        '..ggGGGGGGGG',
        '.gGGGGGGGGg.',
        '....gg.gg...',
        '....GG.GG...',
      ],
      hurt:[
        '....GGgg....',
        '...GWGGGGg..',
        '..GGWgGWGG..',
        '..GGgWGgGG..',
        '...GGesgG...',
        '....GGGG....',
        '..ggGGGGgg..',
        '.gGGGGGGGGg.',
        '....gg.gg...',
        '....GG.GG...',
      ],
      die:[
        '............',
        '..GGgg......',
        '.GGGGGGg....',
        'GGEgGEGG....',
        'GGgGGgGG....',
        '.GGesgG.....',
        '..GGGG......',
        '.gGGGGGGgg..',
        '....gg.gg...',
        '.GG.GG.GGgg.',
      ],
    }
  },
  skeleton:{
    palette:{ W:'#e8e0cc', w:'#c8c0aa', B:'#333', E:'#88f', e:'#66cc66', S:'#ccc', r:'#cc3333' },
    size:[12,10],
    frames:{
      idle:[
        '....WWWW....',
        '...WBWWBWw..',
        '..WWWwWWWW..',
        '...WWrWWW...',
        '....WWWW....',
        '...WWWWWW...',
        '..WWwWWwWW..',
        '.WW..WW..WW.',
        '....WW.WW...',
        '....WW.WW...',
      ],
      attack:[
        '....WWWW....',
        '...WBWWBWw..',
        '..WWWwWWWW..',
        '...WWrWWW...',
        '....WWWWSSSS',
        '...WWWWWWSSS',
        '..WWwWWwWWSS',
        '.WW..WW..WW.',
        '....WW.WW...',
        '....WW.WW...',
      ],
      hurt:[
        '....WWWW....',
        '...WrWWrWw..',
        '..WWWwWWWW..',
        '...WWrWWW...',
        '....WWWW....',
        '...WWWWWW...',
        '..WWwWWwWW..',
        '.WW..WW..WW.',
        '....WW.WW...',
        '....WW.WW...',
      ],
      walk:[
        '....WWWW....',
        '...WBWWBWw..',
        '..WWWwWWWW..',
        '...WWrWWW...',
        '....WWWW....',
        '...WWWWWW...',
        '..WWwWWwWW..',
        '.WW..WW..WW.',
        '...wWW.WW...',
        '....WW.WWw..',
      ],
      die:[
        '............',
        '..WWWW......',
        '.WBWWBWw....',
        'WWWwWWWW....',
        'WWrWWWWW....',
        '.WWWWWW.....',
        'WWwWWwWWWW..',
        'W..WW..WW...',
        '....WW.WW...',
        '....WW.WW...',
      ],
    }
  },
  dragon:{
    palette:{ D:'#9b2020', d:'#7a1818', F:'#ff6600', f:'#ff9900', E:'#ffd700', e:'#ffaa00', W:'#fff', s:'#c04000' },
    size:[14,12],
    frames:{
      idle:[
        '..dDDDDDDDd.',
        '.DDDDDDDDDDD',
        'DDEDDDDEDDsD',
        'DDDDDDDDDDdD',
        '.DDDDDDDDDDD',
        '..DDDDDDDDD.',
        '..dDDDDDDDd.',
        '.DDDDDDDDDDD',
        'DDDDDDDDDDDD',
        '.DDDDDDDDDDD',
        '..dDD....DDd',
        '..DD......DD',
      ],
      attack:[
        '..dDDDDDDDd.',
        '.DDDDDDDDDDD',
        'DDEDDDDEDDsD',
        'DDDDDDDDDDdD',
        '.DDDDDDDDDDDfffF',
        '..DDDDDDDDDffFF.',
        '..dDDDDDDDfFF...',
        '.DDDDDDDDdD.....',
        'DDDDDDDDDDDD....',
        '.DDDDDDDDDDD....',
        '..dDD....DDd....',
        '..DD......DD....',
      ],
      hurt:[
        '..dDWDDDWDd.',
        '.DDDDDDDDDDD',
        'DDEDWDDEDDsD',
        'DDDDDWDDDDdD',
        '.DDDDDDDDDDD',
        '..DDDDDDDDD.',
        '..dDDDDDDDd.',
        '.DDDDDDDDDDD',
        'DDDDDDDDDDDD',
        '.DDDDDDDDDDD',
        '..dDD....DDd',
        '..DD......DD',
      ],
      walk:[
        '..dDDDDDDDd.',
        '.DDDDDDDDDDD',
        'DDEDDDDEDDsD',
        'DDDDDDDDDDdD',
        '.DDDDDDDDDDD',
        '..DDDDDDDDD.',
        '..dDDDDDDDd.',
        '.DDDDDDDDDDD',
        'DDDDDDDDDDDD',
        '.DDDDDDDDDdD',
        '..dDD....dDD',
        '..DD.......D',
      ],
      die:[
        '............',
        '..dDDDDDDDd.',
        '.DDDDDDDDDDD',
        'DDEDDDDEDDsD',
        'DDDDDDDDDDdD',
        '.DDDDDDDDDDD',
        '.DDDDDDDDDDD',
        'DDDDDDDDDDDD',
        '.DDDDDDDDDdD',
        '..dDD....dDD',
        '....DD......',
        '............',
      ],
    }
  },
  slime_king:{
    palette:{ S:'#1a5fa3', s:'#0d3d6b', C:'#fff', c:'#aad4ff', G:'#ffd700', E:'#44eeff' },
    size:[12,10],
    frames:{
      idle:[
        '...SSSSSS...',
        '..SSSSsSSSS.',
        '.SCSSsSCSSS.',
        '.SSSSsSSSSSS',
        '.SSGSSSGSSS.',
        '..SSSSSSSS..',
        '...SSSSSS...',
        '..SSSSSSSSS.',
        '.SSSSSSSSSS.',
        'SSSSSSSSSSS.',
      ],
      attack:[
        '...SSSSSS...',
        '..SSSSSSSSS.',
        '.SCSSsSCSSS.',
        '.SSSSsSSSSSS',
        '.SSGSSSGSSS.',
        'SSSSSSSSSSS.',
        'SSSSSSSSSSSS',
        'SSSSSSSSSSSS',
        'SSSSSSSSSSSS',
        '.SSSSSSSSSS.',
      ],
      hurt:[
        '...SSSSSS...',
        '..SCCCCSsSS.',
        '.SCSSsSCSSS.',
        '.SSCCSsSSSSS',
        '.SSGSSSGSSS.',
        '..SSSSSSSS..',
        '...SSSSSS...',
        '..SSSSSSSSS.',
        '.SSSSSSSSSS.',
        'SSSSSSSSSSS.',
      ],
      walk:[
        '...SSSSSS...',
        '..SSSSsSSSS.',
        '.SCSSsSCSSS.',
        '.SSSSsSSSSSS',
        '.SSGSSSGSSS.',
        '..SSSSSSSS..',
        '..SSSSSSSSS.',
        '.SSSSSSSSSS.',
        'SSSSSSSSSSS.',
        '.SSSSSSSSSS.',
      ],
      die:[
        '............',
        '...SSSSSS...',
        '..SSSSsSSSS.',
        '.SCSSsSCSSS.',
        '.SSSSsSSSSSS',
        '..SSGSSSGSSS',
        '...SSSSSSSS.',
        '....SSSSSS..',
        '.....SSSS...',
        '......SS....',
      ],
    }
  },
  wizard:{
    palette:{ P:'#5a1f99', p:'#3d1466', R:'#c0392b', G:'#ffd700', g:'#ccaa00', W:'#fff', B:'#00ccff', b:'#0088bb', H:'#8b4513' },
    size:[12,12],
    frames:{
      idle:[
        '....PPPP....',
        '..PPGGPPPP..',
        '.PPPGGPpPPp.',
        '.PPpWPWpPPp.',
        '..PPRRRPPp..',
        '...PPPPPP...',
        '...PPPPPPp..',
        '..PPpPPpPPP.',
        '.PPp.PP.pPPp',
        'PPp..PP..pPP',
        '....PP......',
        '....HH......',
      ],
      attack:[
        '....PPPP....',
        '..PPGGPPPP..',
        '.PPPGGPpPPp.',
        '.PPpWPWpPPp.',
        '..PPRRRPPpBBBB',
        '...PPPPPPBBbb.',
        '...PPPPPPPBb..',
        '..PPpPPpPPP...',
        '.PPp.PP.pPPp..',
        'PPp..PP..pPP..',
        '....PP........',
        '....HH........',
      ],
      hurt:[
        '....PPPP....',
        '..PPWGPPPp..',
        '.PPPWGPpPPp.',
        '.PPpWPWpPPp.',
        '..PPRWRPPp..',
        '...PPPPPP...',
        '...PPPPPPp..',
        '..PPpPPpPPP.',
        '.PPp.PP.pPPp',
        'PPp..PP..pPP',
        '....PP......',
        '....HH......',
      ],
      walk:[
        '....PPPP....',
        '..PPGGPPPP..',
        '.PPPGGPpPPp.',
        '.PPpWPWpPPp.',
        '..PPRRRPPp..',
        '...PPPPPP...',
        '...PPPPPPp..',
        '..PPpPPpPPP.',
        '.PPp.PP.pPPp',
        'PPp..pPP.pPP',
        '....pPP.....',
        '....HH......',
      ],
      die:[
        '....PPPP....',
        '..PPGGPPPP..',
        '.PPPGGPpPPp.',
        '.PPpWPWpPPp.',
        '...PPRRPPp..',
        '....PPPPp...',
        '....PPPp....',
        '.....PPp....',
        '......Pp....',
        '......P.....',
        '............',
        '............',
      ],
    }
  },
};

// 몬스터 스프라이트 렌더러
function drawMonsterSprite(ctx, mKey, frameName, x, y, cellSize, alpha=1) {
  const def = M[mKey];
  if (!def) return;
  const frame = def.frames[frameName] || def.frames.idle;
  const pal = def.palette;
  ctx.save();
  ctx.globalAlpha = alpha;
  frame.forEach((row, ry) => {
    [...row].forEach((ch, cx) => {
      if (ch === '.' || !ch) return;
      const color = pal[ch];
      if (!color) return;
      ctx.fillStyle = color;
      ctx.fillRect(x + cx * cellSize, y + ry * cellSize, cellSize - 0.5, cellSize - 0.5);
    });
  });
  ctx.restore();
}

// ═══════════════════════════════════════════════════════
// 배경 렌더러 (패럴랙스 레이어)
// ═══════════════════════════════════════════════════════
class Background {
  constructor(W, H, theme='forest') {
    this.W=W; this.H=H; this.theme=theme;
    this.t=0;
    this.clouds = Array.from({length:5}, (_,i)=>({
      x: Math.random()*W, y: 20+Math.random()*H*0.25,
      w: 60+Math.random()*80, spd: 0.15+Math.random()*0.2, alpha:0.4+Math.random()*0.3,
    }));
    this.stars = Array.from({length:40},()=>({
      x:Math.random()*W, y:Math.random()*H*0.5, r:0.5+Math.random()*1.5, twinkle:Math.random()*Math.PI*2,
    }));
    this.particles=[];
  }

  update() {
    this.t++;
    this.clouds.forEach(c => { c.x += c.spd; if (c.x > this.W + 100) c.x = -120; });
    if (this.t % 8 === 0 && this.theme==='magic') {
      this.particles.push({ x:Math.random()*this.W, y:this.H*0.6+Math.random()*this.H*0.2, vx:(Math.random()-0.5)*0.5, vy:-0.5-Math.random(), life:60, r:1+Math.random()*2, color:`hsl(${200+Math.random()*60},80%,70%)` });
    }
    this.particles = this.particles.filter(p=>{ p.x+=p.vx; p.y+=p.vy; p.life--; return p.life>0; });
  }

  draw(ctx) {
    const {W,H,t,theme} = this;
    // 하늘 그라데이션
    const skyColors = {
      forest:['#0d1b4b','#1a2f7a','#0a3060'],
      dungeon:['#0a0a1a','#1a0a2a','#0a0a1a'],
      magic:  ['#0d0030','#1a0050','#0a0020'],
      castle: ['#1a0a0a','#3a1010','#1a0505'],
      void:   ['#000000','#0a0a2a','#000000'],
    };
    const sc = skyColors[theme] || skyColors.forest;
    const skyG = ctx.createLinearGradient(0,0,0,H);
    skyG.addColorStop(0, sc[0]); skyG.addColorStop(0.5, sc[1]); skyG.addColorStop(1, sc[2]);
    ctx.fillStyle = skyG; ctx.fillRect(0,0,W,H);

    // 별
    if (theme !== 'forest') {
      this.stars.forEach(s=>{
        const a = 0.4 + 0.4*Math.sin(s.twinkle + t*0.03);
        s.twinkle+=0.02;
        ctx.save(); ctx.globalAlpha=a; ctx.fillStyle='#fff';
        ctx.beginPath(); ctx.arc(s.x,s.y,s.r,0,Math.PI*2); ctx.fill();
        ctx.restore();
      });
    }

    // 산/구름 - 원경
    if (theme==='forest' || theme==='castle') {
      ctx.save(); ctx.globalAlpha=0.15;
      ctx.fillStyle = theme==='castle'?'#2a1010':'#1a2a4a';
      for(let i=0;i<6;i++){
        const mx = W*(i/5); const mh = H*(0.3+0.1*Math.sin(i*1.7));
        ctx.beginPath(); ctx.moveTo(mx-60,H*0.55); ctx.lineTo(mx,H*0.55-mh); ctx.lineTo(mx+60,H*0.55); ctx.fill();
      }
      ctx.restore();
    }

    // 구름
    this.clouds.forEach(c=>{
      ctx.save(); ctx.globalAlpha=c.alpha*0.5; ctx.fillStyle='#fff';
      ctx.beginPath(); ctx.ellipse(c.x,c.y,c.w*0.5,c.w*0.2,0,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(c.x-c.w*0.2,c.y+4,c.w*0.3,c.w*0.15,0,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(c.x+c.w*0.2,c.y+4,c.w*0.25,c.w*0.12,0,0,Math.PI*2); ctx.fill();
      ctx.restore();
    });

    // 배경 파티클 (magic 테마)
    this.particles.forEach(p=>{
      const a = p.life/60;
      ctx.save(); ctx.globalAlpha=a; ctx.fillStyle=p.color;
      ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fill();
      ctx.restore();
    });

    // 지면 레이어
    const groundY = H*0.75;
    const groundColors = { forest:['#1a4a1a','#0d2d0d'], dungeon:['#1a0a0a','#0d0505'], magic:['#1a0a3a','#0d0520'], castle:['#2a1a1a','#1a0d0d'], void:['#0a0a1a','#05050d'] };
    const gc = groundColors[theme]||groundColors.forest;
    const gG = ctx.createLinearGradient(0,groundY,0,H);
    gG.addColorStop(0,gc[0]); gG.addColorStop(1,gc[1]);
    ctx.fillStyle=gG; ctx.fillRect(0,groundY,W,H-groundY);

    // 지면 경계선 글로우
    const edgeColors = { forest:'rgba(50,180,50', dungeon:'rgba(180,50,50', magic:'rgba(150,50,255', castle:'rgba(200,100,50', void:'rgba(50,50,180' };
    const ec = (edgeColors[theme]||edgeColors.forest) + ',';
    const edgeG = ctx.createLinearGradient(0,groundY-4,0,groundY+12);
    edgeG.addColorStop(0,ec+'0.0)'); edgeG.addColorStop(0.3,ec+'0.6)'); edgeG.addColorStop(1,ec+'0.0)');
    ctx.fillStyle=edgeG; ctx.fillRect(0,groundY-4,W,16);

    // 바닥 반사 글로우
    const reflG = ctx.createRadialGradient(W/2,groundY,0,W/2,groundY,W*0.45);
    reflG.addColorStop(0,ec+'0.08)'); reflG.addColorStop(1,ec+'0.0)');
    ctx.fillStyle=reflG; ctx.fillRect(0,groundY-20,W,60);

    // 테마별 장식
    if (theme==='dungeon') {
      // 벽 금 균열
      ctx.save(); ctx.strokeStyle='rgba(180,50,50,0.15)'; ctx.lineWidth=1;
      [[W*0.1,0],[W*0.5,0],[W*0.85,0]].forEach(([x])=>{
        ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x+20,H*0.4); ctx.lineTo(x-10,H*0.75); ctx.stroke();
      });
      ctx.restore();
    }
    if (theme==='magic') {
      // 룬 문자 장식
      ctx.save(); ctx.globalAlpha=0.08; ctx.font=`${H*0.12}px serif`; ctx.fillStyle='#aa88ff';
      ['✦','✧','⬡','⬢'].forEach((r,i)=>ctx.fillText(r, W*(0.1+i*0.25), H*0.5+10*Math.sin(t*0.02+i)));
      ctx.restore();
    }
  }
}

// ═══════════════════════════════════════════════════════
// 파티클 시스템
// ═══════════════════════════════════════════════════════
class ParticleSystem {
  constructor() { this.list=[]; }

  emit(type, x, y, opts={}) {
    const n = opts.n||10;
    for (let i=0;i<n;i++) {
      const angle = (Math.PI*2*i/n) + (Math.random()-0.5)*0.5;
      const spd   = (opts.speed||3) + Math.random()*2;
      const life  = (opts.life||50) + Math.random()*20;
      this.list.push({
        type, x, y,
        vx: Math.cos(angle)*spd * (opts.spreadX||1),
        vy: Math.sin(angle)*spd * (opts.spreadY||1) - (opts.upBias||1.5),
        life, maxLife:life,
        color: Array.isArray(opts.color) ? opts.color[Math.floor(Math.random()*opts.color.length)] : (opts.color||'#fff'),
        size: (opts.size||3) + Math.random()*2,
        gravity: opts.gravity!==undefined ? opts.gravity : 0.12,
        alpha:1, rot:Math.random()*Math.PI*2, rotV:(Math.random()-0.5)*0.2,
        data: opts.data||{},
      });
    }
  }

  // 슬래시 이펙트
  slash(x, y, angle, color, len=70) {
    this.list.push({ type:'slash', x, y, angle, color, len, life:18, maxLife:18, alpha:1 });
    this.list.push({ type:'slash', x:x-8, y:y+6, angle:angle+0.2, color, len:len*0.6, life:14, maxLife:14, alpha:0.6 });
  }

  // 투사체
  projectile(x1,y1,x2,y2,color,kind='magic') {
    const dx=x2-x1, dy=y2-y1, dist=Math.sqrt(dx*dx+dy*dy);
    const steps=28;
    this.list.push({ type:'projectile', x:x1, y:y1, tx:x2, ty:y2, vx:dx/steps, vy:dy/steps, life:steps, maxLife:steps, color, kind, trail:[], size:kind==='magic'?7:4 });
  }

  // 링
  ring(x,y,color,maxR=80) {
    this.list.push({ type:'ring', x, y, color, r:4, maxR, life:22, maxLife:22 });
  }

  // 텍스트
  text(msg, x, y, color, size=14) {
    this.list.push({ type:'text', msg, x, y:y, vy:-1.8, color, size, life:55, maxLife:55, alpha:1 });
  }

  // 충격파 (연속 링)
  shockwave(x,y,color,n=3) {
    for(let i=0;i<n;i++) {
      const delay = i*6;
      setTimeout(()=>this.ring(x,y,color,60+i*20), delay*16);
    }
  }

  // 스파크
  sparks(x,y,color,n=16) {
    this.emit('spark', x, y, { n, color, speed:4+Math.random()*2, size:1.5, life:30, gravity:0.2, spreadY:0.8 });
  }

  // 폭발
  explosion(x,y,colors=['#ffd700','#ff6600','#ff3300']) {
    colors.forEach(c=>this.emit('circle',x,y,{n:8,color:c,speed:3+Math.random()*3,size:4,life:40,gravity:0.08}));
    this.ring(x,y,'#ff9900',90);
    this.sparks(x,y,'#fff',12);
  }

  update() {
    this.list = this.list.filter(p=>{
      p.life--;
      if (p.type==='projectile') { p.trail.push({x:p.x,y:p.y}); if(p.trail.length>10)p.trail.shift(); p.x+=p.vx; p.y+=p.vy; }
      else if (p.type==='ring')  { p.r = p.maxR*(1-p.life/p.maxLife); }
      else if (p.type==='text' || p.type==='slash') { p.y += (p.vy||0); }
      else { p.x+=p.vx; p.y+=p.vy; p.vy+=p.gravity; p.vx*=0.97; p.rot+=p.rotV; p.alpha=p.life/p.maxLife; }
      return p.life>0;
    });
  }

  draw(ctx) {
    this.list.forEach(p=>{
      const a = p.type==='text'||p.type==='ring' ? p.life/p.maxLife : (p.alpha||p.life/p.maxLife);
      ctx.save(); ctx.globalAlpha = Math.max(0,a);
      ctx.shadowBlur = 0;

      if (p.type==='projectile') {
        p.trail.forEach((pt,i)=>{
          const ta = (i/p.trail.length)*0.7;
          ctx.globalAlpha = ta*a;
          ctx.fillStyle = p.color; ctx.shadowColor=p.color; ctx.shadowBlur=8;
          ctx.beginPath(); ctx.arc(pt.x,pt.y,p.size*(i/p.trail.length)*0.8,0,Math.PI*2); ctx.fill();
        });
        ctx.globalAlpha = a; ctx.fillStyle='#fff'; ctx.shadowColor=p.color; ctx.shadowBlur=18;
        ctx.beginPath(); ctx.arc(p.x,p.y,p.size,0,Math.PI*2); ctx.fill();
        // 마법 투사체 외곽
        if(p.kind==='magic'){ctx.globalAlpha=a*0.5;ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,p.size+3,0,Math.PI*2);ctx.fill();}

      } else if (p.type==='slash') {
        ctx.strokeStyle=p.color; ctx.lineWidth=3; ctx.shadowColor=p.color; ctx.shadowBlur=14;
        ctx.lineCap='round';
        for(let k=0;k<3;k++){
          ctx.globalAlpha=a*(1-k*0.3);
          ctx.beginPath();
          ctx.translate(p.x+k*4, p.y+k*6);
          ctx.rotate(p.angle);
          ctx.moveTo(-p.len*0.4,0); ctx.quadraticCurveTo(0,-p.len*0.15,p.len*0.5,p.len*0.1); ctx.stroke();
          ctx.setTransform(1,0,0,1,0,0);
        }
      } else if (p.type==='ring') {
        ctx.strokeStyle=p.color; ctx.lineWidth=2.5*(1-p.life/p.maxLife)+0.5; ctx.shadowColor=p.color; ctx.shadowBlur=14;
        ctx.beginPath(); ctx.arc(p.x,p.y,Math.max(1,p.r),0,Math.PI*2); ctx.stroke();

      } else if (p.type==='text') {
        ctx.font=`900 ${p.size}px 'Malgun Gothic',sans-serif`;
        ctx.textAlign='center'; ctx.shadowColor=p.color; ctx.shadowBlur=16;
        ctx.strokeStyle='#000'; ctx.lineWidth=3; ctx.strokeText(p.msg,p.x,p.y);
        ctx.fillStyle=p.color; ctx.fillText(p.msg,p.x,p.y);

      } else if (p.type==='spark') {
        ctx.fillStyle=p.color; ctx.shadowColor=p.color; ctx.shadowBlur=6;
        ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.rot);
        ctx.fillRect(-p.size*0.5,-p.size*2,p.size,p.size*4); ctx.restore();

      } else {
        ctx.fillStyle=p.color; ctx.shadowColor=p.color; ctx.shadowBlur=8;
        ctx.beginPath(); ctx.arc(p.x,p.y,p.size*a,0,Math.PI*2); ctx.fill();
      }
      ctx.restore();
    });
  }
}

// ═══════════════════════════════════════════════════════
// 화면 전환 / 오버레이
// ═══════════════════════════════════════════════════════
class Overlay {
  constructor() { this.active=false; this.type=''; this.t=0; this.dur=0; this.alpha=0; this.msg=''; this.sub=''; this.color='#fff'; }

  show(type, msg, sub, dur=90) {
    this.active=true; this.type=type; this.t=0; this.dur=dur; this.msg=msg; this.sub=sub||''; this.alpha=0;
    const colors = { stageclear:'#ffd700', gameover:'#ef4444', ultimate:'#a855f7', stagein:'#60a5fa', levelup:'#4ade80' };
    this.color = colors[type]||'#fff';
  }

  update() { if (!this.active) return; this.t++; if (this.t>=this.dur) { this.active=false; return; } const h=this.dur/2; this.alpha = this.t<h ? this.t/h : (this.dur-this.t)/h; }

  draw(ctx, W, H) {
    if (!this.active) return;
    ctx.save();
    // 배경 블러 효과
    ctx.globalAlpha = this.alpha * 0.55;
    ctx.fillStyle = this.type==='gameover' ? '#200000' : (this.type==='ultimate' ? '#1a0030' : '#000020');
    ctx.fillRect(0,0,W,H);

    // 중앙 글로우
    const gR = Math.min(W,H)*0.4;
    const radG = ctx.createRadialGradient(W/2,H/2,0,W/2,H/2,gR);
    radG.addColorStop(0,this.color.replace('#',`rgba(${parseInt(this.color.slice(1,3),16)},${parseInt(this.color.slice(3,5),16)},${parseInt(this.color.slice(5,7),16)},`)+`${this.alpha*0.25})`);
    radG.addColorStop(1,'rgba(0,0,0,0)');
    ctx.globalAlpha=1; ctx.fillStyle=radG; ctx.fillRect(0,0,W,H);

    // 텍스트
    ctx.globalAlpha = this.alpha;
    ctx.textAlign='center'; ctx.shadowColor=this.color; ctx.shadowBlur=30;
    ctx.font=`900 ${Math.round(H*0.12)}px 'Malgun Gothic',sans-serif`;
    ctx.strokeStyle='#000'; ctx.lineWidth=5; ctx.strokeText(this.msg,W/2,H*0.45);
    ctx.fillStyle=this.color; ctx.fillText(this.msg,W/2,H*0.45);

    if (this.sub) {
      ctx.font=`700 ${Math.round(H*0.055)}px 'Malgun Gothic',sans-serif`;
      ctx.shadowBlur=15; ctx.strokeText(this.sub,W/2,H*0.6);
      ctx.fillStyle='#fff'; ctx.fillText(this.sub,W/2,H*0.6);
    }
    ctx.restore();
  }
}

// ═══════════════════════════════════════════════════════
// BattleEngine 메인 클래스
// ═══════════════════════════════════════════════════════
class BattleEngine {
  constructor(canvas, opts={}) {
    this.canvas=canvas; this.ctx=canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled=false;
    this.W=canvas.width; this.H=canvas.height;
    this.opts=Object.assign({ groundY:0.75, heroX:0.22, enemyX:0.72, theme:'forest' }, opts);

    this._equipped=null; this._heroCached=null;
    this._monster=null; this._mKey='goblin'; this._mFrame='idle';
    this._heroState={x:0,y:0,shakeX:0,shakeY:0,alpha:1,flipX:1};
    this._monState={x:0,y:0,shakeX:0,shakeY:0,alpha:1};
    this._chargeLevel=0; // 0~1 필살기 게이지
    this._cb={};
    this._busy=false;

    this._bg=new Background(this.W,this.H,this.opts.theme);
    this._ps=new ParticleSystem();
    this._ov=new Overlay();

    // 히어로 오프스크린 캐시 (128×128)
    this._heroOff=document.createElement('canvas');
    this._heroOff.width=128; this._heroOff.height=128;

    this._raf=null;
    this._loop=this._loop.bind(this);
    this._raf=requestAnimationFrame(this._loop);

    // 셀 사이즈 (몬스터 렌더 크기)
    this._cellSize=Math.max(3,Math.floor(Math.min(this.W,this.H*1.4)/28));
  }

  // ── 공개 API ────────────────────────────────────────────
  setHero(equipped) {
    this._equipped=equipped;
    this._buildHeroCache();
  }

  setMonster(def) {
    // def: { id, name, hpPct, theme? }
    this._monster=def; this._mKey=def.id||'goblin';
    this._mFrame='idle'; this._monState={x:0,y:0,shakeX:0,shakeY:0,alpha:1};
    if (def.theme && def.theme!==this.opts.theme) {
      this.opts.theme=def.theme;
      this._bg=new Background(this.W,this.H,def.theme);
    }
  }

  on(ev,cb){ this._cb[ev]=cb; }
  _emit(ev,d){ if(this._cb[ev]) this._cb[ev](d); }

  /** 히어로 공격. skill: 'auto'|'slash'|'magic'|'arrow'|'book'|'shield'|'ultimate' */
  playHeroAttack(skill='auto', opts={}) {
    if (this._busy && skill!=='ultimate') return;
    const resolved = this._resolveSkill(skill);

    // 필살기 처리
    if (skill==='ultimate' || this._chargeLevel>=1) {
      this._runUltimate(opts); return;
    }

    // 차지 증가
    this._chargeLevel = Math.min(1, this._chargeLevel + 0.25);
    SFX.charge(this._chargeLevel);

    this._busy=true;
    const hs=this._heroState, ms=this._monState;
    const heroX=this.W*this.opts.heroX, enemyX=this.W*this.opts.enemyX, gY=this.H*this.opts.groundY;

    const tl = this._timeline();

    if (resolved.type==='slash') {
      SFX.slash();
      tl.at(0,   ()=>this._tweenX(hs,0,(enemyX-heroX)*0.65,160));
      tl.at(170, ()=>{
        this._ps.slash(enemyX-18, gY-55, -0.5, resolved.color);
        this._ps.sparks(enemyX, gY-50, resolved.color, 14);
        this._ps.ring(enemyX, gY-50, resolved.color, 55);
        this._ps.text(opts.dmgText||'SLASH!', enemyX, gY-100, resolved.color, 16);
        this._shake(ms,20,220); this._mFrame='hurt'; SFX.hit();
        if(this._monster) this._monster.hpPct=Math.max(0,(this._monster.hpPct||1)-0.12);
      });
      tl.at(280, ()=>this._tweenX(hs,(enemyX-heroX)*0.65,0,180));
      tl.at(460, ()=>{ this._mFrame='idle'; this._busy=false; this._emit('attackEnd',resolved); });

    } else if (resolved.type==='magic') {
      SFX.magic();
      tl.at(0,   ()=>{ hs.y=-8; });
      tl.at(80,  ()=>{ this._ps.projectile(heroX+30,gY-65,enemyX,gY-58,resolved.color,'magic'); });
      tl.at(330, ()=>{
        this._ps.explosion(enemyX,gY-55,[resolved.color,'#fff','#ffd700']);
        this._ps.ring(enemyX,gY-55,resolved.color,70); this._ps.ring(enemyX,gY-55,'#fff',40);
        this._ps.text(opts.dmgText||'MAGIC!', enemyX, gY-105, resolved.color, 16);
        this._shake(ms,16,260); this._mFrame='hurt'; SFX.hit();
        if(this._monster) this._monster.hpPct=Math.max(0,(this._monster.hpPct||1)-0.14);
      });
      tl.at(380, ()=>{ hs.y=0; });
      tl.at(520, ()=>{ this._mFrame='idle'; this._busy=false; this._emit('attackEnd',resolved); });

    } else if (resolved.type==='arrow') {
      SFX.arrow();
      tl.at(0,   ()=>{ this._ps.projectile(heroX+30,gY-70,enemyX-5,gY-60,resolved.color,'arrow'); });
      tl.at(260, ()=>{
        this._ps.sparks(enemyX,gY-55,resolved.color,18);
        this._ps.text(opts.dmgText||'CRITICAL!', enemyX, gY-105, resolved.color, 14);
        this._shake(ms,14,240); this._mFrame='hurt'; SFX.hit();
        if(this._monster) this._monster.hpPct=Math.max(0,(this._monster.hpPct||1)-0.13);
      });
      tl.at(450, ()=>{ this._mFrame='idle'; this._busy=false; this._emit('attackEnd',resolved); });

    } else if (resolved.type==='book') {
      SFX.magic();
      tl.at(0,   ()=>this._ps.shockwave(heroX+30,gY-45,resolved.color,3));
      tl.at(280, ()=>{
        this._ps.shockwave(enemyX,gY-50,resolved.color,2);
        this._ps.text(opts.dmgText||'WISDOM!', enemyX, gY-105, resolved.color, 14);
        this._shake(ms,18,280); this._mFrame='hurt'; SFX.hit();
        if(this._monster) this._monster.hpPct=Math.max(0,(this._monster.hpPct||1)-0.11);
      });
      tl.at(500, ()=>{ this._mFrame='idle'; this._busy=false; this._emit('attackEnd',resolved); });

    } else {
      // shield / default punch
      SFX.slash();
      tl.at(0,   ()=>this._tweenX(hs,0,(enemyX-heroX)*0.5,140));
      tl.at(150, ()=>{
        this._ps.sparks(enemyX,gY-50,'#fff',8);
        this._ps.text(opts.dmgText||'HIT!', enemyX, gY-95, resolved.color, 14);
        this._shake(ms,12,200); this._mFrame='hurt'; SFX.hit();
      });
      tl.at(240, ()=>this._tweenX(hs,(enemyX-heroX)*0.5,0,150));
      tl.at(400, ()=>{ this._mFrame='idle'; this._busy=false; this._emit('attackEnd',resolved); });
    }
  }

  playMonsterAttack() {
    const ms=this._monState, hs=this._heroState;
    const heroX=this.W*this.opts.heroX, enemyX=this.W*this.opts.enemyX, gY=this.H*this.opts.groundY;
    const tl=this._timeline();
    SFX.hit();
    tl.at(0,   ()=>{ this._mFrame='attack'; this._tweenX(ms,0,-(enemyX-heroX)*0.55,160); });
    tl.at(180, ()=>{
      this._shake(hs,20,260);
      this._ps.sparks(heroX+24,gY-45,'#ef4444',12);
      this._ps.ring(heroX+24,gY-45,'#f87171',50);
      this._ps.text('ATTACK!',heroX+24,gY-98,'#f87171',14);
      SFX.hurt();
    });
    tl.at(270, ()=>this._tweenX(ms,-(enemyX-heroX)*0.55,0,180));
    tl.at(460, ()=>{ this._mFrame='idle'; this._emit('monsterAttackEnd'); });
  }

  playMonsterDeath(onEnd) {
    const ms=this._monState;
    const enemyX=this.W*this.opts.enemyX, gY=this.H*this.opts.groundY;
    const tl=this._timeline();
    SFX.death();
    tl.at(0,   ()=>{ this._mFrame='die'; this._shake(ms,22,120); });
    tl.at(120, ()=>{
      this._ps.explosion(enemyX,gY-50,['#ffd700','#ff6600','#ff3300','#fff']);
      this._ps.ring(enemyX,gY-50,'#ffd700',100);
    });
    tl.at(200, ()=>this._tweenAlpha(ms,1,0,400));
    tl.at(260, ()=>{ SFX.item(); this._ps.text('⭐ CLEAR!',enemyX,gY-110,'#ffd700',18); });
    tl.at(600, ()=>{
      ms.alpha=1;
      this._ov.show('stageclear','🏆 STAGE CLEAR','다음 스테이지!',80);
      if(onEnd) onEnd();
      this._emit('monsterDead');
    });
  }

  playHeroDamage(dmg) {
    const gY=this.H*this.opts.groundY, heroX=this.W*this.opts.heroX;
    this._ps.text(`-${dmg}`, heroX+24, gY-90, '#f87171', 15);
    this._shake(this._heroState,14,200);
    this._ps.sparks(heroX+24,gY-40,'#ef4444',8);
  }

  playHeroHeal(hp) {
    const gY=this.H*this.opts.groundY, heroX=this.W*this.opts.heroX;
    this._ps.text(`+${hp} ❤️`, heroX+24, gY-90, '#4ade80', 14);
    this._ps.emit('circle',heroX+24,gY-50,{n:10,color:'#4ade80',speed:2,upBias:2,gravity:0.05,life:40});
  }

  playGameOver() {
    SFX.gameover();
    this._ov.show('gameover','💀 GAME OVER','다시 도전하세요',100);
    const heroX=this.W*this.opts.heroX, gY=this.H*this.opts.groundY;
    this._ps.explosion(heroX+24,gY-50,['#ef4444','#c0392b','#922b21']);
    this._tweenAlpha(this._heroState,1,0,600);
  }

  playStageClear() {
    SFX.clear();
    for(let i=0;i<25;i++) {
      const delay=i*40;
      setTimeout(()=>{
        const x=Math.random()*this.W, y=Math.random()*this.H*0.65;
        const colors=['#ffd700','#ff6b9d','#a855f7','#06b6d4','#4ade80'];
        this._ps.emit('circle',x,y,{n:6,color:colors[Math.floor(Math.random()*colors.length)],speed:2+Math.random()*2,life:45});
      },delay);
    }
  }

  playLevelUp() {
    SFX.levelup();
    const heroX=this.W*this.opts.heroX, gY=this.H*this.opts.groundY;
    this._ov.show('levelup','⬆️ LEVEL UP!','더 강해졌다!',70);
    this._ps.emission=true;
    ['#ffd700','#4ade80','#60a5fa','#f472b6'].forEach((c,i)=>{
      setTimeout(()=>this._ps.ring(heroX+24,gY-50,c,60+i*15),i*50);
    });
  }

  playUltimateCharge() {
    // 게이지가 가득 찬 걸 알려주는 연출
    const heroX=this.W*this.opts.heroX, gY=this.H*this.opts.groundY;
    this._ps.ring(heroX+24,gY-55,'#a855f7',70);
    this._ps.ring(heroX+24,gY-55,'#ffd700',45);
    this._ps.text('READY!',heroX+24,gY-100,'#ffd700',13);
  }

  get chargeLevel() { return this._chargeLevel; }

  destroy() { cancelAnimationFrame(this._raf); }

  // ── 내부 메서드 ─────────────────────────────────────────
  _buildHeroCache() {
    const oc=this._heroOff; oc.width=128; oc.height=128;
    if (this._equipped && window.LearningHub?.renderCharacter) {
      window.LearningHub.renderCharacter(oc,this._equipped,8);
      this._heroCached=oc;
    }
  }

  _resolveSkill(type) {
    const EFFECTS = {
      slash:  {color:'#e0e8ff',type:'slash'},
      magic:  {color:'#a855f7',type:'magic'},
      arrow:  {color:'#fbbf24',type:'arrow'},
      book:   {color:'#34d399',type:'book'},
      shield: {color:'#60a5fa',type:'shield'},
      punch:  {color:'#f97316',type:'punch'},
    };
    if (type && EFFECTS[type]) return EFFECTS[type];
    if (this._equipped?.weapon && window.LearningHub?.getItemById) {
      const w=window.LearningHub.getItemById(this._equipped.weapon);
      if (w) {
        const s=w.sprite||'';
        if(['검','창','성검','번개창'].some(x=>s.includes(x))) return EFFECTS.slash;
        if(['마법지팡이','마법봉'].some(x=>s.includes(x))) return EFFECTS.magic;
        if(['활','무지개활'].some(x=>s.includes(x))) return EFFECTS.arrow;
        if(['책','지도'].some(x=>s.includes(x))) return EFFECTS.book;
        if(['방패','나침반'].some(x=>s.includes(x))) return EFFECTS.shield;
      }
    }
    return EFFECTS.slash;
  }

  _runUltimate(opts={}) {
    const heroX=this.W*this.opts.heroX, enemyX=this.W*this.opts.enemyX, gY=this.H*this.opts.groundY;
    this._chargeLevel=0; this._busy=true;
    SFX.ultimate();
    this._ov.show('ultimate','💥 ULTIMATE!!','필살기 발동!',70);
    const tl=this._timeline();
    tl.at(0,   ()=>{ this._heroState.y=-15; });
    tl.at(80,  ()=>{ this._ps.ring(heroX+24,gY-60,'#a855f7',80); this._ps.ring(heroX+24,gY-60,'#ffd700',50); });
    tl.at(200, ()=>{
      this._tweenX(this._heroState,0,(enemyX-heroX)*0.7,120);
      ['#ffd700','#a855f7','#60a5fa','#f472b6'].forEach((c,i)=>{ setTimeout(()=>{ this._ps.ring(enemyX,gY-55,c,80+i*25); this._ps.slash(enemyX-10+i*8,gY-55+i*5,-0.4-i*0.15,c); },i*30); });
    });
    tl.at(340, ()=>{
      this._ps.explosion(enemyX,gY-55,['#ffd700','#a855f7','#ff6b9d','#fff']);
      this._ps.explosion(enemyX-30,gY-40,['#f97316','#fff']);
      this._ps.explosion(enemyX+20,gY-65,['#60a5fa','#fff']);
      this._ps.text(opts.dmgText||'ULTIMATE!', enemyX, gY-110, '#ffd700', 20);
      this._shake(this._monState,30,400); this._mFrame='die';
      SFX.hit();
      if(this._monster) this._monster.hpPct=Math.max(0,(this._monster.hpPct||1)-0.35);
    });
    tl.at(450, ()=>{ this._tweenX(this._heroState,(enemyX-heroX)*0.7,0,200); this._heroState.y=0; });
    tl.at(640, ()=>{ this._mFrame='idle'; this._busy=false; this._emit('attackEnd',{type:'ultimate',color:'#ffd700'}); this._emit('ultimate'); });
  }

  // RAF 기반 타임라인
  _timeline() {
    const start=performance.now();
    const tasks=[];
    const schedule=(t,fn)=>tasks.push({t,fn,done:false});
    let id;
    const tick=(now)=>{
      const elapsed=now-start;
      let any=false;
      tasks.forEach(task=>{ if(!task.done && elapsed>=task.t){ task.fn(); task.done=true; } if(!task.done) any=true; });
      if(any) id=requestAnimationFrame(tick); else cancelAnimationFrame(id);
    };
    id=requestAnimationFrame(tick);
    return { at:schedule };
  }

  _tweenX(state,from,to,dur) {
    const s=performance.now();
    const tick=(now)=>{ const t=Math.min(1,(now-s)/dur); const e=t<0.5?2*t*t:-1+(4-2*t)*t; state.x=from+(to-from)*e; if(t<1) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }
  _tweenAlpha(state,from,to,dur) {
    const s=performance.now();
    const tick=(now)=>{ const t=Math.min(1,(now-s)/dur); state.alpha=from+(to-from)*t; if(t<1) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }
  _shake(state,amp,dur) {
    const s=performance.now();
    const tick=(now)=>{ const t=(now-s)/dur; if(t>=1){state.shakeX=0;state.shakeY=0;return;} const d=1-t; state.shakeX=(Math.random()-0.5)*amp*d*2; state.shakeY=(Math.random()-0.5)*amp*d; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }

  // ── 메인 렌더 루프 ──────────────────────────────────────
  _loop() {
    this._raf=requestAnimationFrame(this._loop);
    const ctx=this.ctx, W=this.W, H=this.H;
    const gY=H*this.opts.groundY;
    const heroX=W*this.opts.heroX, enemyX=W*this.opts.enemyX;

    this._bg.update();
    this._bg.draw(ctx);
    this._ps.update();

    // 그림자
    [
      [heroX+24+this._heroState.x, gY, 22, 0.25*this._heroState.alpha],
      [enemyX+this._monState.x, gY, 28, 0.22*this._monState.alpha],
    ].forEach(([sx,sy,sr,sa])=>{
      ctx.save(); ctx.globalAlpha=sa; ctx.fillStyle='#000';
      ctx.scale(1,0.2); ctx.beginPath(); ctx.ellipse(sx,sy/0.2,sr,sr*0.5,0,0,Math.PI*2); ctx.fill(); ctx.restore();
    });

    // 히어로 스프라이트 (캐시 사용)
    const hs=this._heroState;
    if (this._heroCached) {
      ctx.save();
      ctx.globalAlpha=hs.alpha;
      ctx.translate(heroX+hs.x+hs.shakeX, gY-105+hs.y+hs.shakeY);
      ctx.scale(1,1);
      ctx.drawImage(this._heroCached,-40,-8,105,110);
      ctx.restore();
    }

    // 몬스터
    const ms=this._monState;
    const mDrawX = enemyX+ms.x+ms.shakeX - this._cellSize*6;
    const mDrawY = gY - this._cellSize*14 + ms.shakeY;
    const mDef = M[this._mKey];
    if (mDef) {
      // 피격 발광
      if (this._mFrame==='hurt') {
        ctx.save(); ctx.globalAlpha=0.25*ms.alpha; ctx.fillStyle='#ff4444';
        ctx.shadowColor='#ff0000'; ctx.shadowBlur=25;
        ctx.beginPath(); ctx.ellipse(enemyX+ms.x, gY-this._cellSize*7, this._cellSize*7, this._cellSize*9, 0, 0, Math.PI*2); ctx.fill();
        ctx.restore();
      }
      // ultimate 발광
      if (this._ov.type==='ultimate' && this._ov.active) {
        ctx.save(); ctx.globalAlpha=this._ov.alpha*0.3; ctx.fillStyle='#a855f7';
        ctx.shadowColor='#a855f7'; ctx.shadowBlur=40;
        ctx.beginPath(); ctx.ellipse(enemyX+ms.x, gY-this._cellSize*7, this._cellSize*8, this._cellSize*10, 0, 0, Math.PI*2); ctx.fill();
        ctx.restore();
      }
      drawMonsterSprite(ctx, this._mKey, this._mFrame, mDrawX, mDrawY, this._cellSize, ms.alpha);

      // 몬스터 HP바
      if (this._monster?.hpPct !== undefined) {
        const bw=this._cellSize*12, bx=enemyX+ms.x-bw/2, by=mDrawY-12;
        ctx.fillStyle='rgba(0,0,0,0.55)'; ctx.beginPath(); ctx.roundRect(bx-1,by-1,bw+2,8,3); ctx.fill();
        const pct=Math.max(0,Math.min(1,this._monster.hpPct));
        ctx.fillStyle=pct>0.5?'#22c55e':pct>0.25?'#f59e0b':'#ef4444';
        ctx.shadowColor=ctx.fillStyle; ctx.shadowBlur=6;
        if(pct>0){ ctx.beginPath(); ctx.roundRect(bx,by,bw*pct,6,2); ctx.fill(); }
        ctx.shadowBlur=0;
      }
    }

    // 차지 게이지
    if (this._chargeLevel>0) {
      const gw=90, gh=8, gx=heroX-gw/2+24, gy2=gY-115;
      ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.beginPath(); ctx.roundRect(gx-1,gy2-1,gw+2,gh+2,4); ctx.fill();
      const chargeColor = this._chargeLevel>=1 ? '#ffd700' : '#a855f7';
      ctx.fillStyle=chargeColor; ctx.shadowColor=chargeColor; ctx.shadowBlur=this._chargeLevel>=1?14:6;
      ctx.beginPath(); ctx.roundRect(gx,gy2,gw*this._chargeLevel,gh,3); ctx.fill();
      ctx.shadowBlur=0;
      if (this._chargeLevel>=1) {
        ctx.font=`700 9px sans-serif`; ctx.fillStyle='#ffd700'; ctx.textAlign='center';
        ctx.fillText('⚡ READY', gx+gw/2, gy2-3);
      }
    }

    // 파티클 (상단 레이어)
    this._ps.draw(ctx);

    // 오버레이
    this._ov.update();
    this._ov.draw(ctx, W, H);
  }
}

// ── 정적 데이터 ──────────────────────────────────────────
BattleEngine.MONSTERS=[
  {id:'goblin',     name:'고블린',      color:'#4a7c3f', hp:80,  theme:'forest', expIcon:'🧮'},
  {id:'skeleton',   name:'해골 전사',   color:'#e8dcc8', hp:100, theme:'dungeon', expIcon:'📐'},
  {id:'wizard',     name:'마법사 적',   color:'#5b2d8e', hp:90,  theme:'magic',   expIcon:'✨'},
  {id:'slime_king', name:'슬라임 왕',   color:'#1565c0', hp:120, theme:'dungeon', expIcon:'👑'},
  {id:'dragon',     name:'미니 드래곤', color:'#9b2020', hp:150, theme:'void',    expIcon:'🐉'},
];
BattleEngine.SFX=SFX;

global.BattleEngine=BattleEngine;
})(window);
