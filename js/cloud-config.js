/*
 * 클라우드 동기화 설정 (Supabase).
 * 비워두면 클라우드 기능이 숨겨지고 로컬 저장만 사용합니다.
 *
 * 설정 방법은 README의 "클라우드 동기화(회원가입) 설정" 절 참고:
 *  1) supabase.com 무료 프로젝트 생성
 *  2) SQL 한 번 실행(테이블+보안규칙)
 *  3) 아래 두 값을 채워서 커밋
 *
 * anonKey는 공개되어도 되는 키입니다(행 단위 보안규칙이 데이터를 보호).
 */
window.CLOUD_CONFIG = {
  url: "https://ifjikwpmyfvzwetppnfx.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlmamlrd3BteWZ2endldHBwbmZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2OTg2MDYsImV4cCI6MjEwMDI3NDYwNn0._p1Bq0P7sG9H929OpC29beOZ2XymHsF5SJyYC6Tb3hw",
  // 네이버 로그인용 Client ID (공개돼도 됨). 네이버 개발자센터에서 발급 후 넣기.
  // 비워두면 "네이버로 계속하기" 버튼이 숨겨짐.
  naverClientId: "OIxZ4S_Fa5pmSvllvp6A",
};
