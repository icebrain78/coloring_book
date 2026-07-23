# 📱 컬러링 — 안드로이드 앱 (Capacitor)

웹앱을 그대로 감싸 **오프라인에서도 동작하는 독립 안드로이드 앱**으로 만듭니다.
웹 버전 파일은 전혀 건드리지 않아요(이 폴더만 추가).

## 가장 쉬운 길: GitHub Actions로 APK 자동 빌드 (설치 도구 불필요)

1. GitHub 저장소 → **Actions** 탭
2. 왼쪽에서 **"안드로이드 APK 빌드"** 선택
3. 오른쪽 **Run workflow** → 초록 버튼 → `main` 선택 → 실행
4. 5~10분 뒤 완료되면, 그 실행 결과 페이지 **맨 아래 Artifacts** 에서
   `coloring-app-debug-apk` 다운로드 (zip 안에 `app-debug.apk`)
5. APK를 폰으로 옮겨 설치
   - 설정에서 **"출처를 알 수 없는 앱 설치 허용"** 한 번 켜야 합니다
   - (main에 푸시할 때마다 자동으로도 새 APK가 빌드됩니다)

> 이 APK는 **디버그 서명**이라 내 폰/가족·지인에게 나눠주기엔 충분합니다.
> Play 스토어 정식 등록은 아래 "배포" 참고.

## 내 컴퓨터에서 직접 빌드하려면

Android Studio + JDK 17 설치 후:

```bash
cd android-app
# 웹 자산을 www/로 복사(리눅스/맥)
rsync -a --delete --exclude android-app --exclude .git --exclude .github \
  --exclude docs --exclude README.md ../ ./www/
npm install
npx cap add android
npx @capacitor/assets generate --android   # 아이콘/스플래시
npx cap sync android
npx cap open android                        # Android Studio에서 실행/빌드
```

## 앱 정보 바꾸기

- 패키지 ID / 앱 이름: `capacitor.config.json`의 `appId` / `appName`
- 아이콘·스플래시 원본: `assets/icon.png`(1024) · `assets/splash.png`(2732)
  수정 후 `npx @capacitor/assets generate --android` 재실행

## 배포(Play 스토어)

1. 릴리스 서명 키 생성:
   `keytool -genkey -v -keystore my.keystore -alias key -keyalg RSA -keysize 2048 -validity 10000`
2. `android/app/build.gradle`에 서명 설정 추가 후
   `./gradlew bundleRelease` → `app-release.aab` 생성
3. [Play Console](https://play.google.com/console)(등록비 $25 1회)에 `.aab` 업로드
   — 개인정보처리방침 URL, 스크린샷 등 필요

## 참고

- 앱은 웹 자산을 **내장**하므로 인터넷 없이도 실행됩니다
  (클라우드 로그인·동기화만 인터넷 필요).
- 광고(AdMob) 넣는 법은 저장소 루트 README의 "광고 붙이기" 절 참고.
