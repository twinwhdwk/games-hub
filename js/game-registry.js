/**
 * @file js/game-registry.js
 * 게임 플랫폼의 단일 진실 소스(Single Source of Truth)
 * 새 게임 추가 시 이 파일만 수정하면 index, worldmap, 성장일지, 오답노트에 자동 반영
 */

'use strict';

// ── 학교급 정의 ──────────────────────────────────────────
const SCHOOL_TIERS = {
  elementary: { id: 'elementary', label: '초등학교', grades: [3,4,5,6], color: '#2ecc71' },
  middle:     { id: 'middle',     label: '중등학교', grades: [1,2,3],   color: '#3498db' },
  high:       { id: 'high',       label: '고등학교', grades: [1,2,3],   color: '#9b59b6' },
};

// ── 과목 정의 ─────────────────────────────────────────────
const SUBJECT_REGISTRY = [
  { id: '수학', icon: '📐', color: '#f39c12', tier: 'elementary' },
  { id: '영어', icon: '🔤', color: '#e74c3c', tier: 'elementary' },
  { id: '국어', icon: '📖', color: '#27ae60', tier: 'elementary' },
  { id: '사회', icon: '🏛', color: '#2980b9', tier: 'elementary' },
  { id: '과학', icon: '🔬', color: '#8e44ad', tier: 'elementary' },
];

// ── 게임 레지스트리 ───────────────────────────────────────
const GAME_REGISTRY = [
  {
    id: '구구단',
    url: '구구단게임.html',
    icon: '🤖',
    name: '트랜스포머 구구단 대작전',
    subjects: ['수학'],
    tier: 'elementary',
    format: 'action',          // 게임 형식: action | quiz | matching | fill | rpg | arcade
    description: '우주군단과 싸우며 구구단을 마스터! 보스전 3번, 30문제',
    worldmap: { x: 120, y: 260, color: '#e67e22' },
  },
  {
    id: '분수계단',
    url: '분수계단게임.html',
    icon: '🧊',
    name: '분수 계단 탈출',
    subjects: ['수학'],
    tier: 'elementary',
    format: 'platformer',
    description: '5개 관문의 계단을 올라라! 4지선다 분수 퀴즈 50문항',
    worldmap: { x: 300, y: 180, color: '#2980b9' },
  },
  {
    id: '영단어정벌',
    url: '영어단어게임.html',
    icon: '⚔️',
    name: '수양대군의 영어 정벌',
    subjects: ['영어'],
    tier: 'elementary',
    format: 'rpg',
    description: '12스테이지 타워디펜스 영어 전쟁! 구동사·형용사 포함',
    worldmap: { x: 100, y: 480, color: '#c0392b' },
  },
  {
    id: '한국사탐험',
    url: '역사탐험게임.html',
    icon: '🏯',
    name: '한국사 시간탐험대',
    subjects: ['사회'],
    tier: 'elementary',
    format: 'quiz',
    description: '6개 시대를 넘나들며 한국사를 정복! 49문항',
    worldmap: { x: 200, y: 440, color: '#7f5b0a' },
  },
  {
    id: '총알피하기',
    url: '총알피하기.html',
    icon: '🚀',
    name: '총알 피하기',
    subjects: ['과학', '사회', '국어', '수학'],
    tier: 'elementary',
    format: 'arcade',
    description: '총알을 피하며 퀴즈 풀기! 209개 문제 아케이드',
    worldmap: { x: 650, y: 510, color: '#c0392b' },
  },
  {
    id: '지식탐험',
    url: '지식탐험.html',
    icon: '🧭',
    name: '지식 탐험대',
    subjects: ['사회', '과학', '국어', '영어', '수학'],
    tier: 'elementary',
    format: 'quiz',
    description: '5개 과목 209문항! 학년에 맞게 자동 조절',
    worldmap: { x: 450, y: 480, color: '#1a7a2a' },
  },
  {
    id: '짝꿍찾기',
    url: '짝꿍찾기.html',
    icon: '🃏',
    name: '짝꿍 찾기',
    subjects: ['국어', '영어', '과학', '사회'],
    tier: 'elementary',
    format: 'matching',
    description: '카드를 뒤집어 짝을 찾아라! 4개 과목 101쌍',
    worldmap: { x: 500, y: 240, color: '#c0392b' },
  },
  {
    id: '빈칸마법사',
    url: '빈칸마법사.html',
    icon: '🪄',
    name: '빈칸 마법사',
    subjects: ['국어', '영어'],
    tier: 'elementary',
    format: 'fill',
    description: '빈 칸을 채워라! 맞춤법·스펠링 51문항',
    worldmap: { x: 680, y: 310, color: '#6c3483' },
  },

  // ── 중등학교 ─────────────────────────────────────────────
  {
    id: '방정식배틀',
    url: '방정식배틀.html',
    icon: '⚡',
    name: '방정식 배틀',
    subjects: ['수학'],
    tier: 'middle',
    format: 'battle',
    description: '중등 수학 방정식·함수·삼각비를 배틀로! 학년 자동 조절',
    worldmap: { x: 160, y: 220, color: '#6366f1' },
  },
  {
    id: '영문법마스터',
    url: '영문법마스터.html',
    icon: '🔤',
    name: '영문법 마스터',
    subjects: ['영어'],
    tier: 'middle',
    format: 'quiz',
    description: '수동태·관계대명사·가정법 등 중등 영문법 집중 훈련',
    worldmap: { x: 360, y: 160, color: '#06b6d4' },
  },
  {
    id: '중등탐구왕',
    url: '중등탐구왕.html',
    icon: '🔭',
    name: '중등 탐구왕',
    subjects: ['과학', '사회', '국어'],
    tier: 'middle',
    format: 'quiz',
    description: '과학·사회·국어 통합! 타이머 도전 퀴즈',
    worldmap: { x: 280, y: 370, color: '#10b981' },
  },
];

// ── 유틸리티 ─────────────────────────────────────────────
function getGame(id) {
  return GAME_REGISTRY.find(g => g.id === id) || null;
}

function getGamesByTier(tier) {
  return GAME_REGISTRY.filter(g => g.tier === tier);
}

function getGamesBySubject(subject) {
  return GAME_REGISTRY.filter(g => g.subjects.includes(subject));
}

function getSubjectInfo(id) {
  return SUBJECT_REGISTRY.find(s => s.id === id) || { id, icon: '📘', color: '#666' };
}

// ── 내보내기 ──────────────────────────────────────────────
if (typeof module !== 'undefined') {
  module.exports = { SCHOOL_TIERS, SUBJECT_REGISTRY, GAME_REGISTRY, getGame, getGamesByTier, getGamesBySubject, getSubjectInfo };
}
if (typeof window !== 'undefined') {
  window.GameRegistry = { SCHOOL_TIERS, SUBJECT_REGISTRY, GAME_REGISTRY, getGame, getGamesByTier, getGamesBySubject, getSubjectInfo };
}
