# AI 타자 코치

Windows 데스크톱 타자 연습 앱입니다. 연습 기록은 이 PC의 브라우저 저장소에 보관되고, Gemini 키는 앱 프로세스의 `GEMINI_API_KEY` 환경 변수에서 읽습니다.

## 개발 실행

1. Node.js 20 이상을 설치합니다.
2. 프로젝트 폴더에서 `npm install`을 실행합니다.
3. `npm run desktop:dev`를 실행합니다.
4. 시작 화면의 **AI 코치 API 키 설정**에서 Gemini 키를 입력하고 저장합니다. 앱이 Windows 계정 암호화 기능으로 키를 저장합니다. 개발 중에는 `.env`의 `GEMINI_API_KEY`도 읽습니다.

## Windows 설치 파일 만들기

`npm run dist:win`을 실행하면 `release` 폴더에 설치 파일이 생성됩니다. 설치 파일에는 Gemini 키가 포함되지 않습니다. 설치 후 앱 시작 화면의 **AI 코치 API 키 설정**에서 키를 입력하세요.

코드를 수정한 뒤에는 `npm run desktop:dev`로 확인하고 `npm run dist:win`으로 새 설치 파일을 만들면 됩니다. 새 설치 파일을 실행해 기존 앱 위에 설치할 수 있습니다.

일반 브라우저 개발 실행은 `npm run dev`입니다.
