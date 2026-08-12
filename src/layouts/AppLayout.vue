<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import type { Role } from '@/types'

const router = useRouter()
const auth = useAuthStore()

interface NavItem {
  to: string
  label: string
  icon: string
  minRole?: Role
}

// Agrupado por dominio (ventas / compras / configuración) en vez de una lista
// plana de 10 ítems: con la lista plana no se distinguía qué es operación
// diaria y qué es configuración que se toca una vez.
//
// `minRole` oculta el ítem completo si el usuario no alcanza — espejo de lo
// que el servidor ya exige por servicio (ver hooks/require-role.ts): CAF y
// Certificados son admin+, Compras es contador+ (vendedor no gestiona
// cuentas por pagar), Miembros es admin+ para verlo (solo owner puede
// editar, ver MembersView.vue).
const navGroups: { label: string | null; items: NavItem[] }[] = [
  {
    label: null,
    items: [{ to: '/', label: 'Panorama', icon: 'pi-chart-pie' }]
  },
  {
    label: 'Ventas',
    items: [
      { to: '/documents', label: 'Documentos', icon: 'pi-file' },
      { to: '/customers', label: 'Clientes', icon: 'pi-users' },
      { to: '/products', label: 'Productos', icon: 'pi-box' },
      { to: '/libros', label: 'Libros', icon: 'pi-book', minRole: 'contador' }
    ]
  },
  {
    label: 'Compras',
    items: [
      { to: '/purchases', label: 'Compras', icon: 'pi-shopping-cart', minRole: 'contador' },
      { to: '/facturas-recibidas', label: 'Facturas recibidas', icon: 'pi-inbox', minRole: 'contador' },
      { to: '/suppliers', label: 'Proveedores', icon: 'pi-truck' }
    ]
  },
  {
    label: 'Configuración',
    items: [
      { to: '/caf', label: 'CAF', icon: 'pi-key', minRole: 'admin' },
      { to: '/certificates', label: 'Certificados', icon: 'pi-shield', minRole: 'admin' },
      { to: '/casilla-intercambio', label: 'Casilla de Intercambio', icon: 'pi-envelope', minRole: 'admin' },
      { to: '/members', label: 'Miembros', icon: 'pi-user-plus', minRole: 'admin' },
      { to: '/organizations', label: 'Organizaciones', icon: 'pi-building' },
      { to: '/users', label: 'Mi perfil', icon: 'pi-user' }
    ]
  }
]

const visibleNavGroups = computed(() =>
  navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.minRole || auth.hasMinRole(item.minRole))
    }))
    .filter((group) => group.items.length > 0)
)

const userInitials = computed(() => {
  const nombre = auth.user?.nombre ?? ''
  return nombre
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
})

async function handleLogout(): Promise<void> {
  await auth.logout()
  router.push({ name: 'login' })
}

function handleSwitchOrganization(): void {
  router.push({ name: 'select-organization' })
}
</script>

<template>
  <div class="shell">
    <aside class="sidebar">
      <div class="sidebar-logo">
        <div class="sidebar-logo-mark"><i class="pi pi-file-check" /></div>
        <span class="sidebar-logo-title">Folio360</span>
      </div>

      <nav class="sidebar-nav">
        <div v-for="(group, index) in visibleNavGroups" :key="index" class="sidebar-group">
          <span v-if="group.label" class="sidebar-group-label">{{ group.label }}</span>
          <router-link
            v-for="item in group.items"
            :key="item.to"
            :to="item.to"
            class="sidebar-link"
            active-class="sidebar-link-active"
            :exact="item.to === '/'"
            exact-active-class="sidebar-link-active"
          >
            <i class="pi" :class="item.icon" />
            <span>{{ item.label }}</span>
          </router-link>
        </div>
      </nav>
    </aside>

    <div class="main">
      <header class="topbar">
        <button type="button" class="org-switch" title="Cambiar de organización" @click="handleSwitchOrganization">
          <span class="org-avatar">{{ auth.currentOrganization?.razonSocial?.[0] ?? '?' }}</span>
          <span class="org-meta">
            <span class="org-name">{{ auth.currentOrganization?.razonSocial ?? 'Sin organización' }}</span>
            <span class="org-rut">{{ auth.currentOrganization?.rut }}</span>
          </span>
          <i class="pi pi-chevron-down org-chevron" />
        </button>

        <div class="topbar-user">
          <span class="user-avatar">{{ userInitials }}</span>
          <span class="topbar-user-meta">
            <span class="topbar-user-name">{{ auth.user?.nombre }}</span>
            <span class="topbar-user-role">{{ auth.currentRole }}</span>
          </span>
          <button type="button" class="logout-button" title="Cerrar sesión" @click="handleLogout">
            <i class="pi pi-sign-out" />
          </button>
        </div>
      </header>

      <main class="content">
        <router-view />
      </main>
    </div>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  min-height: 100vh;
}

/* ---------- Sidebar ---------- */
.sidebar {
  width: 248px;
  flex-shrink: 0;
  background: var(--sidebar-bg);
  display: flex;
  flex-direction: column;
  padding: 1.25rem 0 1.5rem;
}

.sidebar-logo {
  padding: 0 1.25rem 1.5rem;
  display: flex;
  align-items: center;
  gap: 0.65rem;
}

.sidebar-logo-mark {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: linear-gradient(135deg, var(--accent), #7c6ff0);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.85rem;
  flex-shrink: 0;
}

.sidebar-logo-title {
  color: #fff;
  font-weight: 600;
  font-size: 0.975rem;
  letter-spacing: -0.01em;
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 1.35rem;
  padding: 0 0.625rem;
  overflow-y: auto;
}

.sidebar-group {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.sidebar-group-label {
  padding: 0 0.75rem 0.4rem;
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--sidebar-section);
}

.sidebar-link {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 0.5rem 0.75rem;
  border-radius: var(--radius-md);
  color: var(--sidebar-text);
  font-size: var(--text-md);
  font-weight: 500;
  transition:
    background-color 0.14s ease,
    color 0.14s ease;
}

.sidebar-link .pi {
  font-size: 1rem;
  width: 1.05rem;
  flex-shrink: 0;
  opacity: 0.85;
}

.sidebar-link:hover {
  background: var(--sidebar-bg-hover);
  color: var(--sidebar-text-active);
}

.sidebar-link-active {
  background: var(--sidebar-bg-active);
  color: var(--sidebar-text-active);
  font-weight: 550;
}

/* Barra de acento a la izquierda: refuerza el ítem activo sin depender
   solo del fondo, que sobre azul oscuro tiene poco contraste. */
.sidebar-link-active::before {
  content: '';
  position: absolute;
  left: -0.625rem;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 1.15rem;
  border-radius: 0 3px 3px 0;
  background: #818cf8;
}

.sidebar-link-active .pi {
  opacity: 1;
  color: #a5b4fc;
}

/* ---------- Main / topbar ---------- */
.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.topbar {
  height: 60px;
  flex-shrink: 0;
  background: #fff;
  border-bottom: 1px solid var(--card-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 1.5rem;
}

.org-switch {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  background: none;
  border: 1px solid transparent;
  cursor: pointer;
  padding: 0.3rem 0.6rem 0.3rem 0.35rem;
  border-radius: var(--radius-md);
  text-align: left;
  transition:
    background-color 0.14s ease,
    border-color 0.14s ease;
}

.org-switch:hover {
  background: #fafbfc;
  border-color: var(--card-border);
}

.org-avatar {
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  border-radius: var(--radius-sm);
  background: var(--accent-soft);
  color: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-sm);
  font-weight: 650;
}

.org-meta {
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}

.org-name {
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--text-primary);
}

.org-rut {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.org-chevron {
  font-size: 0.7rem;
  color: var(--text-tertiary);
}

.topbar-user {
  display: flex;
  align-items: center;
  gap: 0.65rem;
}

.user-avatar {
  width: 30px;
  height: 30px;
  border-radius: 999px;
  background: #f2f4f7;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-xs);
  font-weight: 650;
  letter-spacing: 0.02em;
}

.topbar-user-meta {
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}

.topbar-user-name {
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--text-primary);
}

.topbar-user-role {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  text-transform: capitalize;
}

.logout-button {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-tertiary);
  font-size: 1rem;
  padding: 0.45rem;
  margin-left: 0.25rem;
  border-radius: var(--radius-md);
  transition:
    background-color 0.14s ease,
    color 0.14s ease;
}

.logout-button:hover {
  background: #f2f4f7;
  color: var(--text-primary);
}

.content {
  flex: 1;
  padding: 2rem 2.25rem;
  overflow-y: auto;
}
</style>
