<script setup lang="ts">
import LogoFolio360 from '@/components/LogoFolio360.vue'
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import InputText from 'primevue/inputtext'
import Password from 'primevue/password'
import Button from 'primevue/button'
import Message from 'primevue/message'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const auth = useAuthStore()

const email = ref('')
const password = ref('')
const loading = ref(false)
const error = ref<string | null>(null)

async function handleSubmit(): Promise<void> {
  loading.value = true
  error.value = null

  try {
    await auth.login(email.value, password.value)
    router.push(auth.organizations.length === 1 ? '/' : { name: 'select-organization' })
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudo iniciar sesión'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <form class="login-card" @submit.prevent="handleSubmit">
      <div class="login-brand">
        <!-- Variante clara: acá el fondo es blanco, así que la tinta vuelve a
             ser azul marino como en el logo original. -->
        <LogoFolio360 variante="claro" :alto="38" />
        <p class="login-subtitle">Inicia sesión para continuar</p>
      </div>

      <Message v-if="error" severity="error" :closable="false">{{ error }}</Message>

      <label class="field">
        <span>Email</span>
        <InputText v-model="email" type="email" required autofocus placeholder="tu@empresa.cl" />
      </label>

      <label class="field">
        <span>Contraseña</span>
        <Password v-model="password" :feedback="false" toggle-mask required fluid placeholder="••••••••" />
      </label>

      <Button type="submit" label="Iniciar sesión" :loading="loading" fluid />
    </form>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(circle at 20% 20%, rgba(79, 70, 229, 0.25), transparent 45%),
    radial-gradient(circle at 80% 0%, rgba(37, 99, 235, 0.2), transparent 40%),
    var(--sidebar-bg);
}

.login-card {
  width: 380px;
  background: #fff;
  border-radius: 16px;
  padding: 2.25rem 2.25rem 2rem;
  display: flex;
  flex-direction: column;
  gap: 1.15rem;
  box-shadow:
    0 20px 25px -5px rgb(0 0 0 / 0.2),
    0 8px 10px -6px rgb(0 0 0 / 0.15);
}

.login-brand {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.5rem;
  margin-bottom: 1.25rem;
}

.login-subtitle {
  margin: 0.1rem 0 0;
  color: var(--text-secondary);
  font-size: 0.85rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: #334155;
}
</style>
