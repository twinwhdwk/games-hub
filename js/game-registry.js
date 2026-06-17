/**
 * @file js/game-registry.js  v3
 * 학습+캐릭터 육성 플랫폼 — 게임 단일 진실 소스
 * 남긴 게임: 플랫폼 정체성에 맞는 퀴즈/학습 게임만
 */
'use strict';
(function(global) {

const SCHOOL_TIERS = {
  elementary: { id:'elementary', label:'초등학교', grades:[3,4,5,6], color:'#2ecc71', icon:'🌿', continent:'에메랄드 제도' },
  middle:     { id:'middle',     label:'중등학교', grades:[7,8,9],   color:'#3498db', icon:'🌊', continent:'사파이어 군도' },
  high:       { id:'high',       label:'고등학교', grades:[10,11,12],color:'#9b59b6', icon:'🌌', continent:'크리스탈 제국' },
};

const SUBJECT_REGISTRY = [
  { id:'수학', icon:'📐', color:'#f39c12' },
  { id:'영어', icon:'🔤', color:'#e74c3c' },
  { id:'국어', icon:'📖', color:'#27ae60' },
  { id:'사회', icon:'🏛',  color:'#2980b9' },
  { id:'과학', icon:'🔬', color:'#8e44ad' },
];

const GAME_REGISTRY = [
  // ── 초등 ────────────────────────────────────────────────
  {
    id:'지식탐험', url:'지식탐험.html', icon:'🧭', tier:'elementary',
    name:'지식 탐험대', subjects:['수학','영어','국어','사회','과학'], format:'quiz',
    desc:'5개 과목 퀴즈! 학년에 맞게 자동 조절 · 캐릭터 EXP 획득',
    tags:['전과목','퀴즈','학년적응'],
    worldmap:{ x:200, y:300, color:'#1a7a2a', size:78 },
  },
  {
    id:'짝꿍찾기', url:'짝꿍찾기.html', icon:'🃏', tier:'elementary',
    name:'짝꿍 찾기', subjects:['국어','영어','과학','사회'], format:'matching',
    desc:'카드를 뒤집어 짝을 찾아라! 4개 과목 101쌍',
    tags:['카드','매칭','시각학습'],
    worldmap:{ x:450, y:220, color:'#c0392b', size:64 },
  },
  {
    id:'빈칸마법사', url:'빈칸마법사.html', icon:'🪄', tier:'elementary',
    name:'빈칸 마법사', subjects:['국어','영어'], format:'fill',
    desc:'빈 칸을 채워라! 맞춤법·스펠링 마스터',
    tags:['국어','영어','맞춤법'],
    worldmap:{ x:400, y:420, color:'#6c3483', size:62 },
  },
  // ── 중등 ────────────────────────────────────────────────
  {
    id:'방정식배틀', url:'방정식배틀.html', icon:'⚡', tier:'middle',
    name:'방정식 배틀', subjects:['수학'], format:'battle',
    desc:'수학 문제를 풀며 몬스터를 물리쳐라! 캐릭터 전투 씬',
    tags:['수학','배틀','캐릭터'],
    worldmap:{ x:160, y:220, color:'#6366f1', size:68 },
  },
  {
    id:'영문법마스터', url:'영문법마스터.html', icon:'🔤', tier:'middle',
    name:'영문법 마스터', subjects:['영어'], format:'quiz',
    desc:'수동태·관계대명사·가정법 집중 훈련',
    tags:['영어','문법'],
    worldmap:{ x:360, y:160, color:'#06b6d4', size:68 },
  },
  {
    id:'중등탐구왕', url:'중등탐구왕.html', icon:'🔭', tier:'middle',
    name:'중등 탐구왕', subjects:['과학','사회','국어'], format:'quiz',
    desc:'30초 타이머 도전! 과학·사회·국어 통합 퀴즈',
    tags:['과학','사회','국어','타이머'],
    worldmap:{ x:280, y:370, color:'#10b981', size:72 },
  },
  // ── 고등 ────────────────────────────────────────────────
  {
    id:'고등탐구왕', url:'고등탐구왕.html', icon:'🌌', tier:'high',
    name:'고등 탐구왕', subjects:['수학','영어','과학','사회'], format:'quiz',
    desc:'미적분·구문·물리·역사 고등 종합 퀴즈',
    tags:['수학','영어','과학','사회','고등'],
    worldmap:{ x:200, y:250, color:'#9b59b6', size:72 },
  },
];

const GameRegistry = {
  all()           { return GAME_REGISTRY.slice(); },
  get(id)         { return GAME_REGISTRY.find(g => g.id === id) || null; },
  query(pred)     { return GAME_REGISTRY.filter(pred); },
  byTier(tier)    { return GAME_REGISTRY.filter(g => g.tier === tier); },
  bySubject(subj) { return GAME_REGISTRY.filter(g => g.subjects.includes(subj)); },
  byTag(tag)      { return GAME_REGISTRY.filter(g => g.tags?.includes(tag)); },
  byGrade(grade)  { const t = grade<=6?'elementary':grade<=9?'middle':'high'; return GameRegistry.byTier(t); },
  tier(id)        { return SCHOOL_TIERS[id] || null; },
  tiers()         { return Object.values(SCHOOL_TIERS); },
  subject(id)     { return SUBJECT_REGISTRY.find(s => s.id === id) || { id, icon:'📘', color:'#666' }; },
  subjects()      { return SUBJECT_REGISTRY.slice(); },
  SCHOOL_TIERS, SUBJECT_REGISTRY, GAME_REGISTRY,
};

if (global.Container) Container.register('GameRegistry', GameRegistry);
global.GameRegistry = GameRegistry;
if (typeof module !== 'undefined') module.exports = GameRegistry;
})(typeof window !== 'undefined' ? window : global);
