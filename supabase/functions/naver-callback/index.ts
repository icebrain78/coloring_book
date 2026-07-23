// 네이버 로그인용 Supabase Edge Function
//
// 흐름:
//   1) 클라이언트가 네이버 authorize 로 이동(redirect_uri = 이 함수)
//   2) 네이버가 code 를 들고 이 함수로 돌아옴
//   3) code → 네이버 토큰 → 네이버 프로필(email, nickname) 조회
//   4) service_role 로 해당 이메일의 Supabase 유저를 생성/확인
//   5) 매직링크를 발급 → 그 링크로 302 리다이렉트하면
//      브라우저가 앱으로 #access_token=... 을 실어 복귀(웹/앱 공통 처리)
//
// 배포(둘 중 하나):
//   - 대시보드: Edge Functions → Deploy a new function → 이름 naver-callback
//     → 이 코드 붙여넣기 → "Verify JWT" 끄기(OFF) → Deploy
//   - CLI: supabase functions deploy naver-callback --no-verify-jwt
//
// 시크릿 설정(대시보드 Edge Functions → Secrets, 또는 supabase secrets set):
//   NAVER_CLIENT_ID, NAVER_CLIENT_SECRET
//   (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 는 자동 주입됨)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") || "";
  // state 에 우리가 넣어둔 "앱으로 돌아갈 최종 주소"
  const finalRedirect = state || "https://icebrain78.github.io/coloring_book/";

  const back = (hash: string) => Response.redirect(finalRedirect + "#" + hash, 302);

  try {
    if (!code) return back("error=missing_code");

    const NAVER_ID = Deno.env.get("NAVER_CLIENT_ID")!;
    const NAVER_SECRET = Deno.env.get("NAVER_CLIENT_SECRET")!;
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // 1) code → 네이버 액세스 토큰
    const tokenRes = await fetch(
      "https://nid.naver.com/oauth2.0/token?" +
        new URLSearchParams({
          grant_type: "authorization_code",
          client_id: NAVER_ID,
          client_secret: NAVER_SECRET,
          code,
          state,
        }),
    );
    const token = await tokenRes.json();
    if (!token.access_token) return back("error=naver_token_failed");

    // 2) 네이버 프로필
    const meRes = await fetch("https://openapi.naver.com/v1/nid/me", {
      headers: { Authorization: "Bearer " + token.access_token },
    });
    const me = await meRes.json();
    const p = (me && me.response) || {};
    const email: string = p.email || "naver_" + p.id + "@naver.local";
    const name: string = p.nickname || p.name || "네이버 사용자";

    // 3) 유저 생성(있으면 무시)
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await admin.auth.admin
      .createUser({
        email,
        email_confirm: true,
        user_metadata: { name, provider: "naver", naver_id: p.id },
      })
      .catch(() => {}); // 이미 있으면 무시

    // 4) 매직링크 발급 → 그 링크로 리다이렉트하면 세션이 붙어 앱으로 복귀
    const { data, error } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo: finalRedirect },
    });
    if (error || !data?.properties?.action_link) {
      return back("error=session_failed");
    }
    return Response.redirect(data.properties.action_link, 302);
  } catch (_e) {
    return back("error=naver_login_failed");
  }
});
