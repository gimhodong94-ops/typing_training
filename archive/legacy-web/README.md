# 웹 개발판 보관본

이 폴더는 일반 브라우저에서 개발하던 기존 웹판 소스입니다.
현재 주력 프로그램은 프로젝트 루트의 Electron 데스크톱 앱입니다.

## 실행

```powershell
npm install
npm run dev
```

데스크톱 전용 코드(`desktop/` 및 Electron 패키징 설정)는 포함하지 않습니다.
AI API는 Vite 개발 서버의 `/api` 미들웨어가 처리하며, API 키는 `.env`에서 읽습니다.
