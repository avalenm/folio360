import { createApp } from 'vue'
import { createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import Aura from '@primevue/themes/aura'
import { definePreset } from '@primevue/themes'
import ConfirmationService from 'primevue/confirmationservice'
import ToastService from 'primevue/toastservice'
import 'primeicons/primeicons.css'

import App from './App.vue'
import router from './router'
import { useAuthStore } from './stores/auth'
import './style.css'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)

// Restaura la sesión (si hay token guardado) antes de resolver la primera
// ruta, para que el guard del router ya sepa si hay usuario/organización.
const authStore = useAuthStore()
await authStore.restore()

// El acento de la marca (logo, sidebar) es índigo, pero Aura trae verde
// esmeralda como `primary` por defecto — eso dejaba tres colores de acento
// compitiendo (índigo de marca, verde en botones, naranja en links). Acá se
// unifica: índigo = acción/marca; verde/rojo/ámbar quedan solo para
// semántica de estado (pagado, error, advertencia). Ver style.css.
const AppTheme = definePreset(Aura, {
  semantic: {
    primary: {
      50: '#eef1ff',
      100: '#e0e5ff',
      200: '#c7cffe',
      300: '#a5affb',
      400: '#8b8bf7',
      500: '#4f46e5',
      600: '#4338ca',
      700: '#3730a3',
      800: '#312e81',
      900: '#2a2870',
      950: '#1b1a4b'
    }
  }
})

app.use(router)
app.use(PrimeVue, {
  theme: {
    preset: AppTheme,
    options: { darkModeSelector: false }
  }
})
app.use(ConfirmationService)
app.use(ToastService)

app.mount('#app')
