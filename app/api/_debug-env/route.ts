import { NextResponse } from "next/server"

export const runtime = "edge"

// 临时诊断端点：仅报告环境变量是否存在及其长度/前缀，不返回完整值
export async function GET() {
  const probe = (v: string | undefined) => ({
    present: Boolean(v),
    length: v?.length ?? 0,
    prefix: v ? v.slice(0, 6) : "",
    looksLikeGithubId: Boolean(v && /^(Iv1\.|Ov23)/.test(v)),
  })

  return NextResponse.json({
    AUTH_GITHUB_ID: probe(process.env.AUTH_GITHUB_ID),
    AUTH_GITHUB_SECRET: probe(process.env.AUTH_GITHUB_SECRET),
    AUTH_SECRET: probe(process.env.AUTH_SECRET),
    AUTH_GOOGLE_ID: probe(process.env.AUTH_GOOGLE_ID),
    NODE_ENV: process.env.NODE_ENV ?? null,
  })
}
