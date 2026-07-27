import { createMiddleware } from '@tanstack/react-start'
import { getRequestHeader } from '@tanstack/react-start/server'
import { apiClient, ApiError } from '@/lib/api-client'

export type SessionUser = {
  id: string
  email: string
  name: string | null
  displayName: string | null
  availability: string
  isSuperAdmin: boolean
  createdAt: string
}

export type SessionMembership = {
  accountId: string
  role: 'admin' | 'agent'
}

// Server functions run in Node, not the browser — `apiClient`'s
// `credentials: "include"` has nothing to attach to there, so the session
// cookie from the original incoming request has to be forwarded by hand.
function fetchSession() {
  const cookie = getRequestHeader('cookie')
  return apiClient.get<{ profile: SessionUser; membership: SessionMembership | null }>(
    '/auth/me',
    cookie ? { cookie } : undefined,
  )
}

export const requireSessionAuth = createMiddleware({ type: 'function' }).server(
  async ({ next }) => {
    let user: SessionUser
    let membership: SessionMembership | null

    try {
      const data = await fetchSession()
      user = data.profile
      membership = data.membership
    } catch (error) {
      // Throwing here must produce a real Error, never a raw Response: the
      // client-side server-fn pipeline treats a thrown Response as a
      // successful (non-error) result, so callers would see it as `data`
      // instead of `error` and crash trying to read fields off it.
      if (error instanceof ApiError) throw error
      throw error instanceof Error ? error : new Error('Auth check failed')
    }

    return next({
      context: {
        user,
        userId: user.id,
        membership,
        accountId: membership?.accountId ?? null,
      },
    })
  },
)

export const optionalSessionAuth = createMiddleware({ type: 'function' }).server(
  async ({ next }) => {
    let user: SessionUser | null = null
    let membership: SessionMembership | null = null

    try {
      const data = await fetchSession()
      user = data.profile
      membership = data.membership
    } catch {
      // unauthenticated is ok for optional auth
    }

    return next({
      context: {
        user,
        userId: user?.id ?? null,
        membership,
        accountId: membership?.accountId ?? null,
      },
    })
  },
)
