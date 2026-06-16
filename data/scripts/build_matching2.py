import json

m = json.load(open('matching_bank.json'))

# 영어 matching 대폭 보강 (구동사 + 어휘)
m['영어'].extend([
  {"grade":4,"unit":"동사","term":"run","def":"달리다"},
  {"grade":4,"unit":"동사","term":"jump","def":"뛰어오르다"},
  {"grade":4,"unit":"동사","term":"swim","def":"수영하다"},
  {"grade":4,"unit":"동사","term":"sing","def":"노래하다"},
  {"grade":5,"unit":"구동사","term":"give up","def":"포기하다"},
  {"grade":5,"unit":"구동사","term":"look for","def":"찾다"},
  {"grade":5,"unit":"구동사","term":"wake up","def":"일어나다"},
  {"grade":5,"unit":"구동사","term":"put on","def":"입다"},
  {"grade":6,"unit":"구동사","term":"turn on","def":"켜다"},
  {"grade":6,"unit":"구동사","term":"run out","def":"다 떨어지다"},
  {"grade":6,"unit":"형용사","term":"brave","def":"용감한"},
  {"grade":6,"unit":"형용사","term":"clever","def":"영리한"},
])

# 국어 보강 (속담, 관용어)
m['국어'].extend([
  {"grade":5,"unit":"관용어","term":"눈이 높다","def":"기준이나 이상이 높다"},
  {"grade":5,"unit":"관용어","term":"발이 넓다","def":"아는 사람이 많다"},
  {"grade":5,"unit":"속담","term":"일석이조","def":"한 가지로 두 가지 이득"},
  {"grade":6,"unit":"관용어","term":"식은 죽 먹기","def":"매우 쉬운 일"},
  {"grade":6,"unit":"한자어","term":"명심(銘心)","def":"마음에 새겨 잊지 않음"},
])

# 과학 보강
m['과학'].extend([
  {"grade":4,"unit":"물의 상태 변화","term":"응고","def":"액체→고체 변화"},
  {"grade":4,"unit":"물의 상태 변화","term":"융해","def":"고체→액체 변화"},
  {"grade":5,"unit":"용해와 용액","term":"용매","def":"다른 물질을 녹이는 물질"},
  {"grade":5,"unit":"열과 우리 생활","term":"전도","def":"열이 고체에서 직접 전달됨"},
  {"grade":6,"unit":"산과 염기","term":"중화","def":"산과 염기가 만나 반응함"},
])

# 사회 보강
m['사회'].extend([
  {"grade":5,"unit":"옛사람들의 삶과 문화","term":"한글","def":"세종대왕이 창제한 우리 문자"},
  {"grade":5,"unit":"국토와 우리 생활","term":"독도","def":"우리나라 동쪽 끝 섬"},
  {"grade":6,"unit":"우리나라의 정치 발전","term":"3.1 운동","def":"1919년 일어난 독립운동"},
])

json.dump(m, open('matching_bank.json','w'), ensure_ascii=False, indent=1)
print("matching_bank 완성:")
for k,v in m.items(): print(f"  {k}: {len(v)}쌍")
