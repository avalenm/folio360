import { createRouter, createWebHashHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

// Hash history (no server rewrite support needed) — GitHub Pages es hosting
// estático puro, un refresh o link directo a una ruta con historial normal
// (p.ej. /documents) daría 404 porque no hay servidor que redirija todo a
// index.html.
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { public: true }
    },
    {
      path: '/select-organization',
      name: 'select-organization',
      component: () => import('@/views/SelectOrganizationView.vue')
    },
    {
      path: '/',
      component: () => import('@/layouts/AppLayout.vue'),
      children: [
        { path: '', name: 'dashboard', component: () => import('@/views/DashboardView.vue') },
        { path: 'finanzas', name: 'finanzas', component: () => import('@/views/finanzas/FinanzasView.vue') },
        { path: 'customers', name: 'customers', component: () => import('@/views/customers/CustomersView.vue') },
        { path: 'products', name: 'products', component: () => import('@/views/products/ProductsView.vue') },
        { path: 'caf', name: 'caf', component: () => import('@/views/caf/CafView.vue'), meta: { minRole: 'admin' } },
        {
          path: 'certificates',
          name: 'certificates',
          component: () => import('@/views/certificates/CertificatesView.vue'),
          meta: { minRole: 'admin' }
        },
        { path: 'documents', name: 'documents', component: () => import('@/views/documents/DocumentsView.vue') },
        {
          path: 'libros',
          name: 'libros',
          component: () => import('@/views/libros/LibrosView.vue'),
          meta: { minRole: 'contador' }
        },
        { path: 'suppliers', name: 'suppliers', component: () => import('@/views/suppliers/SuppliersView.vue') },
        {
          path: 'purchases',
          name: 'purchases',
          component: () => import('@/views/purchases/PurchasesView.vue'),
          meta: { minRole: 'contador' }
        },
        {
          path: 'facturas-recibidas',
          name: 'facturas-recibidas',
          component: () => import('@/views/purchases/FacturasRecibidasView.vue'),
          meta: { minRole: 'contador' }
        },
        {
          path: 'casilla-intercambio',
          name: 'casilla-intercambio',
          component: () => import('@/views/settings/CasillaIntercambioView.vue'),
          meta: { minRole: 'admin' }
        },
        {
          path: 'organizations',
          name: 'organizations',
          component: () => import('@/views/organizations/OrganizationsView.vue')
        },
        { path: 'users', name: 'users', component: () => import('@/views/users/UsersView.vue') },
        {
          path: 'members',
          name: 'members',
          component: () => import('@/views/members/MembersView.vue'),
          meta: { minRole: 'admin' }
        }
      ]
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('@/views/NotFoundView.vue'),
      meta: { public: true }
    }
  ]
})

router.beforeEach((to) => {
  const auth = useAuthStore()

  if (to.meta.public) {
    return true
  }

  if (!auth.isAuthenticated) {
    return { name: 'login' }
  }

  if (to.name !== 'select-organization' && !auth.hasOrganization) {
    return { name: 'select-organization' }
  }

  // Espejo liviano de lo que ya exige el servidor (require-role.ts) — evita
  // que alguien sin el rol navegue a una pantalla que solo le va a mostrar
  // errores 403; el servidor sigue siendo quien realmente lo impide.
  const minRole = to.meta.minRole as import('@/types').Role | undefined
  if (minRole && !auth.hasMinRole(minRole)) {
    return { name: 'dashboard' }
  }

  return true
})

export default router
