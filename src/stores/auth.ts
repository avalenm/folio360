import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { feathersClient } from '@/services/feathers'
import type { Organization, Role, User } from '@/types'

interface TokenPayload {
  organizationId?: string
  role?: Role
  sub: string
  [key: string]: unknown
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  const payload = ref<TokenPayload | null>(null)
  const organizations = ref<Organization[]>([])
  const restoring = ref(true)

  const isAuthenticated = computed(() => !!user.value)
  const hasOrganization = computed(() => !!payload.value?.organizationId)
  const currentOrganization = computed(() =>
    organizations.value.find((org) => org._id === payload.value?.organizationId)
  )
  const currentRole = computed(() => payload.value?.role)

  // Espejo de hooks/require-role.ts en el servidor — solo para
  // mostrar/ocultar UI (el servidor es quien realmente exige el permiso en
  // cada request, esto nunca reemplaza esa validación).
  const ROLE_LEVEL: Record<Role, number> = { vendedor: 1, contador: 2, admin: 3, owner: 4 }

  function hasMinRole(minRole: Role): boolean {
    const role = currentRole.value
    return !!role && ROLE_LEVEL[role] >= ROLE_LEVEL[minRole]
  }

  function applyAuthResult(result: { user: User; authentication: { payload: TokenPayload } }): void {
    user.value = result.user
    payload.value = result.authentication.payload
  }

  async function loadMyOrganizations(): Promise<void> {
    if (!user.value) {
      organizations.value = []
      return
    }

    const memberships = user.value.memberships.filter((m) => m.estado === 'activo')
    organizations.value = await Promise.all(
      memberships.map((m) => feathersClient.service('organizations').get(m.organizationId) as Promise<Organization>)
    )
  }

  async function login(email: string, password: string): Promise<void> {
    const result = await feathersClient.authenticate({ strategy: 'local', email, password })
    applyAuthResult(result as { user: User; authentication: { payload: TokenPayload } })
    await loadMyOrganizations()
  }

  // No usa `feathersClient.authenticate({ strategy: 'jwt', ... })`: esa
  // estrategia solo *verifica* un token existente, y @feathersjs/authentication
  // hace return temprano sin generar uno nuevo cuando el resultado ya trae
  // accessToken (ver server/src/authentication.ts). Por eso el servidor expone
  // `switch-organization`, que emite un token nuevo con el organizationId
  // elegido; acá solo lo guardamos y re-verificamos con `authenticate('jwt')`
  // (ese sí solo verifica, que es exactamente lo que corresponde acá).
  async function selectOrganization(organizationId: string): Promise<void> {
    const { accessToken } = (await feathersClient
      .service('switch-organization')
      .create({ organizationId })) as { accessToken: string }

    const result = await feathersClient.authenticate({ strategy: 'jwt', accessToken })
    applyAuthResult(result as { user: User; authentication: { payload: TokenPayload } })
  }

  async function restore(): Promise<void> {
    restoring.value = true
    try {
      const result = await feathersClient.reAuthenticate()
      applyAuthResult(result as { user: User; authentication: { payload: TokenPayload } })
      await loadMyOrganizations()
    } catch {
      user.value = null
      payload.value = null
    } finally {
      restoring.value = false
    }
  }

  async function logout(): Promise<void> {
    await feathersClient.logout()
    user.value = null
    payload.value = null
    organizations.value = []
  }

  return {
    user,
    organizations,
    restoring,
    isAuthenticated,
    hasOrganization,
    currentOrganization,
    currentRole,
    hasMinRole,
    login,
    selectOrganization,
    restore,
    logout
  }
})
