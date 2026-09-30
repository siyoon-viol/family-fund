# 우리집 공금통장

가족 7명이 함께 쓰는 공금 장부입니다.

- **주소**: https://family-fund.sy-oh.workers.dev
- **구성**: Cloudflare Workers(화면과 API) + Cloudflare D1(데이터베이스). 무료 요금제로 운영합니다.

## 기능

- 현재 잔액, 이번 달 입금·출금, 회비 낸 인원
- 통장 형식의 거래내역(날짜, 적요, 찾으신 금액, 맡기신 금액, 잔액)과 CSV 내려받기
- 회비 현황표(구성원 × 최근 6개월). 미납 칸을 누르면 바로 기록할 수 있습니다.
- 최근 6개월 입출금과 지출 분류 통계

## 가족이 쓰는 법

주소를 열고 가족 비밀번호를 한 번만 입력하면 그 기기에서 기억합니다. 휴대폰에서는 브라우저 메뉴의 **홈 화면에 추가**를 누르면 앱처럼 쓸 수 있습니다.

## 파일 구성

| 파일 | 역할 |
|---|---|
| `public/index.html` | 화면 |
| `src/worker.js` | `/api` 처리. 비밀번호를 확인하고 D1에 읽고 씁니다 |
| `schema.sql` | D1 테이블 정의 (`tx`, `members`, `settings`) |
| `wrangler.jsonc` | Cloudflare 배포 설정 |

## 관리

아래 명령은 이 폴더에서 실행합니다. 처음이라면 `npx wrangler login`을 먼저 하세요.

```sh
# 코드를 고친 뒤 다시 배포
npx wrangler deploy

# 가족 비밀번호 바꾸기 (입력창에 새 비밀번호 입력)
npx wrangler secret put PASSCODE

# 백업: 데이터베이스 전체를 SQL 파일로 내보내기
npx wrangler d1 export family-fund --remote --output=backup.sql

# 거래내역 직접 보기
npx wrangler d1 execute family-fund --remote --command "SELECT date, type, category, amount, memo FROM tx ORDER BY date DESC LIMIT 20"
```

D1은 최근 30일 안의 어느 시점으로든 되돌릴 수 있습니다(Time Travel). 자세한 내용은 `npx wrangler d1 time-travel --help`를 참고하세요.

## 보안

- 가족 비밀번호는 Cloudflare Secret으로만 보관합니다. 코드와 저장소에는 없습니다.
- 비밀번호가 없으면 장부를 볼 수도 쓸 수도 없습니다. 비밀번호가 틀리면 응답이 늦게 가서 무작정 맞춰 보기가 어렵습니다.
- 나중에 가족 각자 이메일 인증으로 로그인하게 하려면 Cloudflare Zero Trust의 Access를 붙이면 됩니다.
