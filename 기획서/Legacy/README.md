# AI 타자 코치

Windows 데스크톱 타자 연습 앱입니다. 연습 기록은 이 PC의 브라우저 저장소에 보관됩니다. 앱 설정에서 기존 Gemini 또는 Multi AI 제공자와 모델을 고르고, API 키를 Windows 계정 암호화 기능으로 저장할 수 있습니다.

## 개발 실행

1. Node.js 20 이상을 설치합니다.
2. 프로젝트 폴더에서 `npm install`을 실행합니다.
3. `npm run desktop:dev`를 실행합니다.
4. 시작 화면의 **AI 코치 API 키 설정**에서 제공자와 모델을 선택하고 해당 API 키를 저장합니다. Gemini 개발 키는 `.env`의 `GEMINI_API_KEY`로도 읽습니다. Multi AI는 `https://api.baze.co/v1/gateway` OpenAI 호환 API를 사용합니다.

## Windows 설치 파일 만들기

`npm run dist:win`을 실행하면 `release` 폴더에 설치 파일이 생성됩니다. 설치 파일에는 API 키가 포함되지 않습니다. 설치 후 앱 시작 화면의 **AI 코치 API 키 설정**에서 제공자, 모델과 키를 입력하세요.

코드를 수정한 뒤에는 `npm run desktop:dev`로 확인하고 `npm run dist:win`으로 새 설치 파일을 만들면 됩니다. 새 설치 파일을 실행해 기존 앱 위에 설치할 수 있습니다.

일반 브라우저 개발 실행은 `npm run dev`입니다.
