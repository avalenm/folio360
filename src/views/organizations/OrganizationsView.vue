<script setup lang="ts">
import { reactive, ref } from 'vue'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Tag from 'primevue/tag'
import { useToast } from 'primevue/usetoast'
import { feathersClient } from '@/services/feathers'
import { useAuthStore } from '@/stores/auth'
import type { Organization } from '@/types'

// El servicio de control-plane `organizations` ahora filtra por membership
// (ver hooks de organizations.service.ts en el servidor) — esta pantalla de
// todos modos solo muestra las organizaciones a las que el usuario
// pertenece (vía auth.organizations), no depende de esa protección para su
// propio comportamiento.
const auth = useAuthStore()
const toast = useToast()

const dialogVisible = ref(false)
const editingId = ref<string | null>(null)
const saving = ref(false)
const draft = reactive<Partial<Organization>>({})

// Editar una organización exige admin+ EN ESA organización puntual — no
// necesariamente la que está activa ahora mismo (un usuario puede ser
// vendedor en una organización y owner en otra; auth.currentRole solo
// refleja la seleccionada). Se cruza contra las memberships del propio
// usuario en vez de asumir el rol activo.
function canEdit(org: Organization): boolean {
  const role = auth.user?.memberships.find((m) => m.organizationId === org._id)?.role
  return role === 'owner' || role === 'admin'
}

function openEdit(org: Organization): void {
  editingId.value = org._id
  Object.assign(draft, org)
  dialogVisible.value = true
}

async function handleSave(): Promise<void> {
  if (!editingId.value) return

  saving.value = true
  try {
    const updated = (await feathersClient
      .service('organizations')
      .patch(editingId.value, draft)) as Organization
    const index = auth.organizations.findIndex((o) => o._id === updated._id)
    if (index !== -1) auth.organizations[index] = updated
    dialogVisible.value = false
    toast.add({ severity: 'success', summary: 'Guardado', life: 2500 })
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
    <h1 class="page-title">Mis organizaciones</h1>

    <div class="org-grid">
      <div v-for="org in auth.organizations" :key="org._id" class="org-card">
        <div class="org-card-header">
          <div>
            <div class="org-name">{{ org.razonSocial }}</div>
            <div class="org-rut">{{ org.rut }}</div>
          </div>
          <Tag :severity="org.estado === 'activo' ? 'success' : 'warn'" :value="org.estado" />
        </div>
        <div class="org-detail">Giro: {{ org.giro || '—' }}</div>
        <div class="org-detail">Ambiente: {{ org.ambiente }}</div>
        <Button v-if="canEdit(org)" label="Editar" icon="pi pi-pencil" text @click="openEdit(org)" />
      </div>
    </div>

    <Dialog v-model:visible="dialogVisible" modal header="Editar organización" style="width: 460px">
      <form class="form-grid" @submit.prevent="handleSave">
        <label class="field">
          <span>Razón social</span>
          <InputText v-model="draft.razonSocial" required />
        </label>
        <label class="field">
          <span>Giro</span>
          <InputText v-model="draft.giro" />
        </label>

        <div class="form-actions">
          <Button label="Cancelar" text @click="dialogVisible = false" />
          <Button type="submit" label="Guardar" :loading="saving" />
        </div>
      </form>
    </Dialog>
  </div>
</template>

<style scoped>
.page-title {
  margin: 0 0 1.25rem;
  font-size: 1.4rem;
}

.org-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 1rem;
}

.org-card {
  background: #fff;
  border-radius: 10px;
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.org-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.org-name {
  font-weight: 700;
}

.org-rut {
  font-size: 0.8rem;
  color: #64748b;
}

.org-detail {
  font-size: 0.85rem;
  color: #475569;
}

.form-grid {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: #334155;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.5rem;
}
</style>
