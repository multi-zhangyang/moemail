import { NextResponse } from "next/server"

export const runtime = "edge"

export async function POST() {
  // 站点已私有化：仅所有者本人可通过 GitHub 登录，不再开放注册
  return NextResponse.json(
    { error: "注册已关闭" },
    { status: 403 }
  )
}
