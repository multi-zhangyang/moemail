import { NextResponse } from "next/server"

export const runtime = "edge"

// 临时诊断端点（用完即删）：
// 用应用自身配置的 GitHub OAuth 凭据向 GitHub token 端点发一次请求，
// 只回传 HTTP 状态与 GitHub 的错误信息，不泄露任何密钥内容。
const TOKEN = "4HWChB5AJ3JD2CcpZGhrGPHR"

export async function GET(request: Request) {
  const url = new URL(request.url)
  if (url.searchParams.get("k") !== TOKEN) {
    return NextResponse.json({ error: "未授权" }, { status: 401 })
  }

  const clientId = process.env.AUTH_GITHUB_ID
  const clientSecret = process.env.AUTH_GITHUB_SECRET

  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      Authorization: "Basic " + btoa(`${clientId}:${clientSecret}`),
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code: "invalid-diagnostic-code",
      grant_type: "authorization_code",
      redirect_uri: "https://mail.2go.live/api/auth/callback/github",
      code_verifier: "decoy",
    }),
  })

  const text = await res.text()
  let github: unknown = text
  try {
    github = JSON.parse(text)
  } catch {
    // 保持原始文本
  }

  return NextResponse.json({
    httpStatus: res.status,
    github,
    clientIdPresent: Boolean(clientId),
    clientIdLength: clientId?.length ?? 0,
    clientSecretPresent: Boolean(clientSecret),
    clientSecretLength: clientSecret?.length ?? 0,
  })
}
