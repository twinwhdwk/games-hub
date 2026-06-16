import json

b = json.load(open('blank_bank.json'))

# 영어 blank 보강 (구동사 포함)
b['영어'].extend([
  {"grade":4,"unit":"동사","word":"jump","blankIdx":[0],"choices":["j","h","b","g"]},
  {"grade":4,"unit":"동사","word":"swim","blankIdx":[1],"choices":["w","h","m","p"]},
  {"grade":5,"unit":"구동사","word":"give","blankIdx":[2],"choices":["v","b","f","n"]},
  {"grade":5,"unit":"구동사","word":"wake","blankIdx":[0],"choices":["w","b","m","h"]},
  {"grade":5,"unit":"형용사","word":"brave","blankIdx":[1],"choices":["r","l","n","d"]},
  {"grade":6,"unit":"구동사","word":"turn","blankIdx":[3],"choices":["n","m","k","r"]},
  {"grade":6,"unit":"형용사","word":"clever","blankIdx":[2],"choices":["e","a","i","o"]},
  {"grade":6,"unit":"형용사","word":"strong","blankIdx":[2],"choices":["r","l","n","m"]},
])

# 국어 blank 보강
b['국어'].extend([
  {"grade":4,"unit":"맞춤법","sentence":"나는 학교에 ___ 갔다.","answer":"일찍","choices":["일찍","이쪽","이찍","일측"]},
  {"grade":4,"unit":"맞춤법","sentence":"그는 공부를 ___ 했다.","answer":"열심히","choices":["열심히","열심이","여심히","열싱히"]},
  {"grade":5,"unit":"높임말","sentence":"할아버지께서 진지를 ___.","answer":"드신다","choices":["드신다","먹는다","먹으신다","잡수신다"]},
  {"grade":5,"unit":"맞춤법","sentence":"꽃이 아주 ___ 피었다.","answer":"활짝","choices":["활짝","활착","확짝","활쭉"]},
  {"grade":6,"unit":"맞춤법","sentence":"그 문제는 생각보다 ___.","answer":"어렵지 않았다","choices":["어렵지 않았다","어렵지 않었다","어렵지 않았었다","어렵지 않았나"]},
  {"grade":6,"unit":"문법","sentence":"나는 책을 읽는 ___ 을 좋아한다.","answer":"것","choices":["것","거","게","겟"]},
])

json.dump(b, open('blank_bank.json','w'), ensure_ascii=False, indent=1)
print("blank_bank 완성:")
for k,v in b.items(): print(f"  {k}: {len(v)}문항")
