import NextAuth from "next-auth"
import GitHub from "next-auth/providers/github"
import { DrizzleAdapter } from "@auth/drizzle-adapter"
import { createDb, Db } from "./db"
import { accounts, users, roles, userRoles } from "./schema"
import { eq } from "drizzle-orm"
import { getRequestContext } from "@cloudflare/next-on-pages"
import { Permission, hasPermission, ROLES, Role } from "./permissions"
import { generateAvatarUrl } from "./avatar"
import { getUserId } from "./apiKey"

/**
 * 站点已改为私有：仅允许所有者本人通过 GitHub 登录/注册。
 * 其他任何账号（包括密码注册）一律拒绝。
 */
const OWNER_GITHUB_IDS = ["249290191"]
const OWNER_EMAILS = ["hi@zhangyang.dev"]

/** 判断某个 Auth.js 用户是否为所有者本人 */
export function isOwnerUser(user: { email?: string | null } | null | undefined, account?: { provider?: string; providerAccountId?: string | null } | null) {
  const githubId = String(account?.providerAccountId ?? "")
  if (githubId && OWNER_GITHUB_IDS.includes(githubId)) return true

  const email = (user?.email ?? "").toLowerCase()
  return email.length > 0 && OWNER_EMAILS.includes(email)
}

const ROLE_DESCRIPTIONS: Record<Role, string> = {
  [ROLES.EMPEROR]: "皇帝（网站所有者）",
  [ROLES.DUKE]: "公爵（超级用户）",
  [ROLES.KNIGHT]: "骑士（高级用户）",
  [ROLES.CIVILIAN]: "平民（普通用户）",
}

const getDefaultRole = async (): Promise<Role> => {
  const defaultRole = await getRequestContext().env.SITE_CONFIG.get("DEFAULT_ROLE")

  if (
    defaultRole === ROLES.DUKE ||
    defaultRole === ROLES.KNIGHT ||
    defaultRole === ROLES.CIVILIAN
  ) {
    return defaultRole as Role
  }

  return ROLES.CIVILIAN
}

async function findOrCreateRole(db: Db, roleName: Role) {
  let role = await db.query.roles.findFirst({
    where: eq(roles.name, roleName),
  })

  if (!role) {
    const [newRole] = await db.insert(roles)
      .values({
        name: roleName,
        description: ROLE_DESCRIPTIONS[roleName],
      })
      .returning()
    role = newRole
  }

  return role
}

export async function assignRoleToUser(db: Db, userId: string, roleId: string) {
  await db.delete(userRoles)
    .where(eq(userRoles.userId, userId))

  await db.insert(userRoles)
    .values({
      userId,
      roleId,
    })
}

export async function getUserRole(userId: string) {
  const db = createDb()
  const userRoleRecords = await db.query.userRoles.findMany({
    where: eq(userRoles.userId, userId),
    with: { role: true },
  })
  return userRoleRecords[0].role.name
}

export async function checkPermission(permission: Permission) {
  const userId = await getUserId()

  if (!userId) return false

  const db = createDb()
  const userRoleRecords = await db.query.userRoles.findMany({
    where: eq(userRoles.userId, userId),
    with: { role: true },
  })

  const userRoleNames = userRoleRecords.map(ur => ur.role.name)
  return hasPermission(userRoleNames as Role[], permission)
}

/**
 * 临时诊断（用完即删）：Cloudflare Pages 此部署无法 tail 日志，
 * 所以把 Auth.js 的错误对象（含 cause.err 原始堆栈）写进 KV 供排查。
 */
const AUTH_DEBUG_KEY = "_AUTH_DEBUG"

function truncate(v: unknown, max = 800): unknown {
  return typeof v === "string" && v.length > max ? v.slice(0, max) + "…" : v
}

function recordAuthError(error: Error) {
  try {
    const { env, ctx } = getRequestContext()
    const anyErr = error as unknown as Record<string, any>
    const cause = anyErr?.cause
    const inner = cause?.err

    const entry = {
      t: new Date().toISOString(),
      type: anyErr?.type ?? anyErr?.name,
      message: truncate(anyErr?.message),
      causeType: cause?.type,
      causeMessage: truncate(cause?.message),
      innerName: inner?.name,
      innerMessage: truncate(inner?.message),
      innerStatus: inner?.status,
      innerCode: inner?.code,
      innerError: inner?.error,
      innerErrorDescription: truncate(inner?.error_description),
      innerStack: truncate(inner?.stack, 2500),
      stack: truncate(anyErr?.stack, 2500),
    }

    const write = Promise.resolve(env.SITE_CONFIG.get(AUTH_DEBUG_KEY))
      .then((prev) => {
        let list: unknown[] = []
        try {
          list = prev ? JSON.parse(prev) : []
        } catch {
          list = []
        }
        list.push(entry)
        return env.SITE_CONFIG.put(AUTH_DEBUG_KEY, JSON.stringify(list.slice(-10)))
      })
      .catch(() => undefined)

    ctx?.waitUntil?.(write)
  } catch {
    // 诊断失败不能影响正常流程
  }
}

export const {
  handlers: { GET, POST },
  auth,
  signIn,
  signOut
} = NextAuth(() => ({
  secret: process.env.AUTH_SECRET,
  logger: {
    error(error) {
      recordAuthError(error)
    },
  },
  adapter: DrizzleAdapter(createDb(), {
    usersTable: users,
    accountsTable: accounts,
  }),
  providers: [
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET,
      allowDangerousEmailAccountLinking: true,
      // GitHub 从 2026-04 起会在 OAuth 回调里带上 iss 参数（RFC 9207）。
      // @auth/core 的 GitHub provider 没有配置 issuer，校验时会拿占位值
      // "https://authjs.dev" 去比对，于是抛 CallbackRouteError:
      //   unexpected "iss" (issuer) response parameter value
      // 显式声明 issuer 即可通过校验。authorization/token/userinfo 三个端点
      // 仍取 GitHub 默认值，不会被 issuer 覆盖（见 normalizeOAuth/normalizeEndpoint：
      // scope 已由 GitHub provider 的 params 写入 searchParams，故不会被改成
      // "openid profile email"）。
      issuer: "https://github.com/login/oauth",
    }),
  ],
  events: {
    async signIn({ user }) {
      if (!user.id) return

      try {
        const db = createDb()
        const existingRole = await db.query.userRoles.findFirst({
          where: eq(userRoles.userId, user.id),
        })

        if (existingRole) return

        const defaultRole = await getDefaultRole()
        const role = await findOrCreateRole(db, defaultRole)
        await assignRoleToUser(db, user.id, role.id)
      } catch (error) {
        console.error('Error assigning role:', error)
      }
    },
  },
  callbacks: {
    async signIn({ user, account, profile }) {
      // 只允许所有者本人的 GitHub 账号登录，其他一律拒绝（返回 false 会跳到 AccessDenied）
      if (account?.provider !== "github") return false

      const githubId = String(account.providerAccountId ?? "")
      const profileEmail = (profile as { email?: string } | undefined)?.email
      const email = (user.email ?? profileEmail ?? "").toLowerCase()

      if (!isOwnerUser(user, account)) {
        console.warn(`[auth] blocked sign-in attempt: githubId=${githubId || "?"} email=${email || "?"}`)
        return false
      }

      return true
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.name = user.name || user.username
        token.username = user.username
        token.image = user.image || generateAvatarUrl(token.name as string)
      }
      return token
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string
        session.user.name = token.name as string
        session.user.username = token.username as string
        session.user.image = token.image as string

        const db = createDb()
        let userRoleRecords = await db.query.userRoles.findMany({
          where: eq(userRoles.userId, session.user.id),
          with: { role: true },
        })

        if (!userRoleRecords.length) {
          const defaultRole = await getDefaultRole()
          const role = await findOrCreateRole(db, defaultRole)
          await assignRoleToUser(db, session.user.id, role.id)
          userRoleRecords = [{
            userId: session.user.id,
            roleId: role.id,
            createdAt: new Date(),
            role: role
          }]
        }

        session.user.roles = userRoleRecords.map(ur => ({
          name: ur.role.name,
        }))

        const userAccounts = await db.query.accounts.findMany({
          where: eq(accounts.userId, session.user.id),
        })

        session.user.providers = userAccounts.map(account => account.provider)
      }

      return session
    },
  },
  session: {
    strategy: "jwt",
  },
}))

export async function register() {
  // 站点已私有化：不再开放用户名/密码注册，仅所有者本人可通过 GitHub 登录
  throw new Error("注册已关闭")
}
