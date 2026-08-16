<script setup lang="ts">
import AyudaPagina from '@/components/AyudaPagina.vue'
import { AYUDA_USUARIOS } from '@/ayudaContenidos'
import { reactive, ref } from 'vue'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Password from 'primevue/password'
import Tag from 'primevue/tag'
import { useToast } from 'primevue/usetoast'
import { feathersClient } from '@/services/feathers'
import { useAuthStore } from '@/stores/auth'

// El servicio de control-plane `users` no filtra por organización (los
// usuarios son globales) — listar "todos los usuarios" expondría emails de
// toda la plataforma a cualquier organización. Sin un endpoint de gestión de
// membresías (ver memoria "facturacion-sii-progress"), esta pantalla se
// limita al perfil del usuario logueado.
const auth = useAuthStore()
const toast = useToast()

const saving = ref(false)
const draft = reactive({ nombre: auth.user?.nombre ?? '', email: auth.user?.email ?? '', password: '' })

async function handleSave(): Promise<void> {
  if (!auth.user) return

  saving.value = true
  try {
    const data: Record<string, unknown> = { nombre: draft.nombre, email: draft.email }
    if (draft.password) data.password = draft.password

    const updated = (await feathersClient.service('users').patch(auth.user._id, data)) as typeof auth.user
    auth.user = updated
    draft.password = ''
    toast.add({ severity: 'success', summary: 'Perfil actualizado', life: 2500 })
  } catch (e) {
    toast.add({
      severity: 'error',
      summary: 'Error al guardar',
      detail: e instanceof Error ? e.message : undefined,
      life: 4000
    })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div>
    <h1 class="page-title">Mi perfil <AyudaPagina titulo="Usuarios" :secciones="AYUDA_USUARIOS" /></h1>

    <form class="profile-card" @submit.prevent="handleSave">
      <label class="field">
        <span>Nombre</span>
        <InputText v-model="draft.nombre" required />
      </label>
      <label class="field">
        <span>Email</span>
        <InputText v-model="draft.email" type="email" required />
      </label>
      <label class="field">
        <span>Nueva contraseña (opcional)</span>
        <Password v-model="draft.password" :feedback="false" toggle-mask fluid />
      </label>

      <div class="memberships">
        <span class="memberships-title">Membresías</span>
        <div v-for="m in auth.user?.memberships" :key="m.organizationId" class="membership-row">
          <span>{{ auth.organizations.find((o) => o._id === m.organizationId)?.razonSocial ?? m.organizationId }}</span>
          <Tag :value="m.role" />
        </div>
      </div>

      <Button type="submit" label="Guardar" :loading="saving" style="align-self: flex-start" />
    </form>
  </div>
</template>

<style scoped>
.page-title {
  margin: 0 0 1.25rem;
  font-size: 1.4rem;
}

.profile-card {
  background: #fff;
  border-radius: 10px;
  padding: 1.5rem;
  max-width: 420px;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: #334155;
}

.memberships {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.memberships-title {
  font-size: 0.85rem;
  font-weight: 600;
  color: #334155;
}

.membership-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.85rem;
  color: #475569;
}
</style>
