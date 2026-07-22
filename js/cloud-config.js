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
  url: "",     // 예: "https://abcdefghij.supabase.co"
  anonKey: "", // 예: "eyJhbGciOiJIUzI1NiIs..."
};
