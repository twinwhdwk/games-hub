/**
 * @file js/game-registry.js  v2
 * 게임 플랫폼 단일 진실 소스 + 런타임 쿼리 API.
 * 새 게임 추가 = GAME_REGISTRY 배열에 항목 하나 추가.
 */
'use strict';
(function(global) {

// ── 학교급 정의 ──────────────────────────────────────────
const SCHOOL_TIERS = {
  elementary: { id:'elementary', label:'초등학교', grades:[3,4,5,6], color:'#2ecc71', icon:'🌿', continent:'에메랄드 제도' },
  middle:     { id:'middle',     label:'중등학교', grades:[7,8,9],   color:'#3498db', icon:'🌊', continent:'사파이어 군도' },
  high:       { id:'high',       label:'고등학교', grades:[10,11,12],color:'#9b59b6', icon:'🌌', continent:'크리스탈 제국' },
};

// ── 과목 정의 ────────────────────────────────────────────
const SUBJECT_REGISTRY = [
  { id:'수학', icon:'📐', color:'#f39c12', tiers:['elementary','middle','high'] },
  { id:'영어', icon:'🔤', color:'#e74c3c', tiers:['elementary','middle','high'] },
  { id:'국어', icon:'📖', color:'#27ae60', tiers:['elementary','middle','high'] },
  { id:'사회', icon:'🏛', color:'#2980b9', tiers:['elementary','middle','high'] },
  { id:'과학', icon:'🔬', color:'#8e44ad', tiers:['elementary','middle','high'] },
];

// ── 게임 레지스트리 ──────────────────────────────────────
const GAME_REGISTRY = [
  // ── 초등 ────────────────────────────────────────────────
  {
    id:'구구단', url:'구구단게임.html', icon:'🤖', tier:'elementary',
    name:'구구단 대작전', subjects:['수학'], format:'action',
    desc:'우주군단과 싸우며 구구단을 마스터! 보스전 3번',
    tags:['수학','곱셈','액션'],
    worldmap:{ x:120, y:260, color:'#e67e22', size:72 },
  },
  {
    id:'분수계단', url:'분수계단게임.html', icon:'🧊', tier:'elementary',
    name:'분수 계단 탈출', subjects:['수학'], format:'platformer',
    desc:'5개 관문의 계단을 올라라! 4지선다 분수 퀴즈 50문항',
    tags:['수학','분수','플랫폼'],
    worldmap:{ x:300, y:180, color:'#2980b9', size:68 },
  },
  {
    id:'영단어정벌', url:'영어단어게임.html', icon:'⚔️', tier:'elementary',
    name:'수양대군의 영어 정벌', subjects:['영어'], format:'rpg',
    desc:'12스테이지 타워디펜스 영어 전쟁! 구동사·형용사 포함',
    tags:['영어','어휘','구동사','RPG'],
    worldmap:{ x:100, y:480, color:'#c0392b', size:66 },
  },
  {
    id:'한국사탐험', url:'역사탐험게임.html', icon:'🏯', tier:'elementary',
    name:'한국사 시간탐험대', subjects:['사회'], format:'quiz',
    desc:'6개 시대를 넘나들며 한국사를 정복! 49문항',
    tags:['사회','역사','퀴즈'],
    worldmap:{ x:200, y:440, color:'#7f5b0a', size:66 },
  },
  {
    id:'총알피하기', url:'총알피하기.html', icon:'🚀', tier:'elementary',
    name:'총알 피하기', subjects:['과학','사회','국어','수학'], format:'arcade',
    desc:'총알을 피하며 퀴즈 풀기! 아케이드+퀴즈',
    tags:['전과목','아케이드','액션'],
    worldmap:{ x:650, y:510, color:'#c0392b', size:64 },
  },
  {
    id:'지식탐험', url:'지식탐험.html', icon:'🧭', tier:'elementary',
    name:'지식 탐험대', subjects:['사회','과학','국어','영어','수학'], format:'quiz',
    desc:'5개 과목 316문항! 학년에 맞게 자동 조절',
    tags:['전과목','퀴즈','학년적응'],
    worldmap:{ x:450, y:480, color:'#1a7a2a', size:78 },
  },
  {
    id:'짝꿍찾기', url:'짝꿍찾기.html', icon:'🃏', tier:'elementary',
    name:'짝꿍 찾기', subjects:['국어','영어','과학','사회'], format:'matching',
    desc:'카드를 뒤집어 짝을 찾아라! 4개 과목 101쌍',
    tags:['국어','영어','카드','매칭'],
    worldmap:{ x:500, y:240, color:'#c0392b', size:64 },
  },
  {
    id:'빈칸마법사', url:'빈칸마법사.html', icon:'🪄', tier:'elementary',
    name:'빈칸 마법사', subjects:['국어','영어'], format:'fill',
    desc:'빈 칸을 채워라! 맞춤법·스펠링 51문항',
    tags:['국어','영어','맞춤법','스펠링'],
    worldmap:{ x:680, y:310, color:'#6c3483', size:62 },
  },
  // ── 중등 ────────────────────────────────────────────────
  {
    id:'방정식배틀', url:'방정식배틀.html', icon:'⚡', tier:'middle',
    name:'방정식 배틀', subjects:['수학'], format:'battle',
    desc:'중등 수학 방정식·함수·삼각비 배틀! 학년 자동 조절',
    tags:['수학','방정식','배틀','전투'],
    worldmap:{ x:160, y:220, color:'#6366f1', size:68 },
  },
  {
    id:'영문법마스터', url:'영문법마스터.html', icon:'🔤', tier:'middle',
    name:'영문법 마스터', subjects:['영어'], format:'quiz',
    desc:'수동태·관계대명사·가정법 중등 영문법 집중 훈련',
    tags:['영어','문법','수동태','가정법'],
    worldmap:{ x:360, y:160, color:'#06b6d4', size:68 },
  },
  {
    id:'중등탐구왕', url:'중등탐구왕.html', icon:'🔭', tier:'middle',
    name:'중등 탐구왕', subjects:['과학','사회','국어'], format:'quiz',
    desc:'과학·사회·국어 통합 타이머 퀴즈! 30초 안에 풀어라',
    tags:['과학','사회','국어','타이머'],
    worldmap:{ x:280, y:370, color:'#10b981', size:72 },
  },
];

// ── 쿼리 API ──────────────────────────────────────────────
const GameRegistry = {
  // 전체 목록
  all() { return GAME_REGISTRY.slice(); },

  // ID로 단건 조회
  get(id) { return GAME_REGISTRY.find(g => g.id === id) || null; },

  // 필터 쿼리
  query(pred) { return GAME_REGISTRY.filter(pred); },

  // 학교급 필터
  byTier(tier) { return GAME_REGISTRY.filter(g => g.tier === tier); },

  // 과목 필터
  bySubject(subject) { return GAME_REGISTRY.filter(g => g.subjects.includes(subject)); },

  // 태그 필터
  byTag(tag) { return GAME_REGISTRY.filter(g => g.tags?.includes(tag)); },

  // 포맷 필터
  byFormat(format) { return GAME_REGISTRY.filter(g => g.format === format); },

  // 학년 범위 내 플레이 가능한 게임
  byGrade(grade) {
    const tier = grade <= 6 ? 'elementary' : grade <= 9 ? 'middle' : 'high';
    return GameRegistry.byTier(tier);
  },

  // 학교급 메타
  tier(id) { return SCHOOL_TIERS[id] || null; },
  tiers()  { return Object.values(SCHOOL_TIERS); },

  // 과목 메타
  subject(id) { return SUBJECT_REGISTRY.find(s => s.id === id) || { id, icon:'📘', color:'#666' }; },
  subjects()  { return SUBJECT_REGISTRY.slice(); },

  SCHOOL_TIERS,
  SUBJECT_REGISTRY,
  GAME_REGISTRY,
};

if (global.Container) Container.register('GameRegistry', GameRegistry);
global.GameRegistry = GameRegistry;

// Node.js 지원
if (typeof module !== 'undefined') module.exports = GameRegistry;
})(typeof window !== 'undefined' ? window : global);
