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
        { path: 'cotizaciones', name: 'cotizaciones', component: () => import('@/views/cotizaciones/CotizacionesView.vue') },
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

// Un chunk que ya no existe deja la pantalla EN BLANCO, y no es un bug del
// código: pasa cuando se despliega una versión nueva mientras el navegador
// todavía tiene en caché el index.html anterior (GitHub Pages lo sirve con
// max-age=600). Ese HTML viejo pide archivos con los hashes viejos, que el
// despliegue ya borró, el import dinámico falla y no se monta nada.
//
// Se recarga UNA sola vez: al pedir el documento de nuevo el navegador
// revalida, llega el index.html nuevo y los nombres de chunk vuelven a
// existir. La marca en sessionStorage evita quedar en un bucle de recargas si
// el fallo fuera por otra causa (sin red, por ejemplo).
const MARCA_RECARGA = 'folio360:recargado-por-chunk'

const ES_CHUNK_PERDIDO =
  /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed/i

router.onError((error: Error, to) => {
  if (!ES_CHUNK_PERDIDO.test(error.message)) return
  if (sessionStorage.getItem(MARCA_RECARGA)) return

  sessionStorage.setItem(MARCA_RECARGA, '1')
  // El hash se fija antes de recargar para no perder la ruta a la que se
  // estaba yendo.
  window.location.hash = to.fullPath
  window.location.reload()
})

// Una navegación que sí completó significa que la versión cargada está sana:
// se limpia la marca para que la próxima vez se pueda volver a recargar.
router.afterEach(() => sessionStorage.removeItem(MARCA_RECARGA))

export default router
