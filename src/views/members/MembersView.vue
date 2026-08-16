<script setup lang="ts">
import AyudaPagina from '@/components/AyudaPagina.vue'
import { AYUDA_MIEMBROS } from '@/ayudaContenidos'
import { computed, onMounted, reactive, ref } from 'vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import Tag from 'primevue/tag'
import Menu from 'primevue/menu'
import type { MenuItem } from 'primevue/menuitem'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { feathersClient } from '@/services/feathers'
import { useAuthStore } from '@/stores/auth'
import type { Member, Role } from '@/types'

// No usa useResource: el servicio `organization-members` no es un CRUD
// genérico (find no pagina, create es "invitar" con campos propios, patch
// solo toca role/estado, remove identifica por userId no por un _id propio
// de una colección) — ver server/src/services/organization-members.service.ts.
const auth = useAuthStore()
const confirm = useConfirm()
const toast = useToast()

const items = ref<Member[]>([])
const loading = ref(false)

async function fetchAll(): Promise<void> {
  loading.value = true
  try {
    items.value = (await feathersClient.service('organization-members').find()) as unknown as Member[]
  } catch (e) {
    toast.add({
      severity: 'error',
      summary: 'Error al cargar los miembros',
      detail: e instanceof Error ? e.message : undefined,
      life: 4000
    })
  } finally {
    loading.value = false
  }
}

const ROLES: { label: string; value: Role }[] = [
  { label: 'Propietario', value: 'owner' },
  { label: 'Administrador', value: 'admin' },
  { label: 'Contador', value: 'contador' },
  { label: 'Vendedor', value: 'vendedor' }
]

function roleLabel(role: Role): string {
  return ROLES.find((r) => r.value === role)?.label ?? role
}

// Solo el propietario puede invitar/editar/quitar miembros (el servidor lo
// exige igual — ver require-role.ts — esto es solo para no mostrar botones
// que van a terminar en un 403).
const canManage = computed(() => auth.currentRole === 'owner')

// --- Invitar ---
const inviteVisible = ref(false)
const inviting = ref(false)
const inviteDraft = reactive({ email: '', nombre: '', role: 'vendedor' as Role })

function openInvite(): void {
  inviteDraft.email = ''
  inviteDraft.nombre = ''
  inviteDraft.role = 'vendedor'
  inviteVisible.value = true
}

// Se muestra UNA sola vez, cuando invitar crea un usuario nuevo (no hay
// envío de correo todavía) — ver el comentario en el servicio del servidor.
const tempPasswordResult = ref<{ email: string; tempPassword: string } | null>(null)

async function confirmInvite(): Promise<void> {
  inviting.value = true
  try {
    const result = (await feathersClient
      .service('organization-members')
      .create(inviteDraft)) as unknown as Member
    items.value = [...items.value, result]
    inviteVisible.value = false
    toast.add({ severity: 'success', summary: 'Miembro agregado', life: 2500 })

    if (result.tempPassword) {
      tempPasswordResult.value = { email: result.email, tempPassword: result.tempPassword }
    }
  } catch (e) {
    toast.add({
      severity: 'error',
      summary: 'Error al invitar',
      detail: e instanceof Error ? e.message : undefined,
      life: 4000
    })
  } finally {
    inviting.value = false
  }
}

// --- Cambiar rol ---
const roleDialogVisible = ref(false)
const roleDialogMember = ref<Member | null>(null)
const roleDialogValue = ref<Role>('vendedor')
const savingRole = ref(false)

function openChangeRole(member: Member): void {
  roleDialogMember.value = member
  roleDialogValue.value = member.role
  roleDialogVisible.value = true
}

async function confirmChangeRole(): Promise<void> {
  const member = roleDialogMember.value
  if (!member) return

  savingRole.value = true
  try {
    const updated = (await feathersClient
      .service('organization-members')
      .patch(member.userId, { role: roleDialogValue.value })) as unknown as Member
    items.value = items.value.map((m) => (m.userId === updated.userId ? updated : m))
    roleDialogVisible.value = false
    toast.add({ severity: 'success', summary: 'Rol actualizado', life: 2500 })
  } catch (e) {
    toast.add({
      severity: 'error',
      summary: 'Error al cambiar el rol',
      detail: e instanceof Error ? e.message : undefined,
      life: 4000
    })
  } finally {
    savingRole.value = false
  }
}

// --- Activar/desactivar ---
async function toggleEstado(member: Member): Promise<void> {
  const nextEstado = member.estado === 'activo' ? 'invitado' : 'activo'
  try {
    const updated = (await feathersClient
      .service('organization-members')
      .patch(member.userId, { estado: nextEstado })) as unknown as Member
    items.value = items.value.map((m) => (m.userId === updated.userId ? updated : m))
    toast.add({ severity: 'success', summary: nextEstado === 'activo' ? 'Miembro activado' : 'Miembro desactivado', life: 2500 })
  } catch (e) {
    toast.add({
      severity: 'error',
      summary: 'Error al cambiar el estado',
      detail: e instanceof Error ? e.message : undefined,
      life: 4000
    })
  }
}

// --- Quitar ---
function confirmRemove(member: Member): void {
  confirm.require({
    message: `¿Quitar a ${member.nombre} de la organización?`,
    header: 'Confirmar',
    icon: 'pi pi-exclamation-triangle',
    acceptProps: { severity: 'danger' },
    accept: async () => {
      try {
        await feathersClient.service('organization-members').remove(member.userId)
        items.value = items.value.filter((m) => m.userId !== member.userId)
        toast.add({ severity: 'success', summary: 'Miembro quitado', life: 2500 })
      } catch (e) {
        toast.add({
          severity: 'error',
          summary: 'Error al quitar el miembro',
          detail: e instanceof Error ? e.message : undefined,
          life: 4000
        })
      }
    }
  })
}

const rowMenu = ref()
const menuMember = ref<Member | null>(null)

const rowMenuItems = computed<MenuItem[]>(() => {
  const member = menuMember.value
  if (!member) return []
  return [
    { label: 'Cambiar rol', icon: 'pi pi-shield', command: () => openChangeRole(member) },
    {
      label: member.estado === 'activo' ? 'Desactivar' : 'Activar',
      icon: member.estado === 'activo' ? 'pi pi-ban' : 'pi pi-check',
      command: () => toggleEstado(member)
    },
    { label: 'Quitar', icon: 'pi pi-trash', command: () => confirmRemove(member) }
  ]
})

function toggleRowMenu(event: Event, member: Member): void {
  menuMember.value = member
  rowMenu.value?.toggle(event)
}

onMounted(fetchAll)
</script>

<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">Miembros <AyudaPagina titulo="Miembros" :secciones="AYUDA_MIEMBROS" /></h1>
      <Button v-if="canManage" label="Invitar miembro" icon="pi pi-user-plus" @click="openInvite" />
    </div>

    <p v-if="!canManage" class="hint">
      <i class="pi pi-info-circle" /> Solo el propietario de la organización puede invitar, cambiar roles o quitar miembros.
    </p>

    <DataTable :value="items" :loading="loading" data-key="userId" striped-rows>
      <Column header="Miembro">
        <template #body="{ data }">
          <div class="stacked-cell">
            <strong>{{ data.nombre }}</strong>
            <span class="muted">{{ data.email }}</span>
          </div>
        </template>
      </Column>
      <Column header="Rol">
        <template #body="{ data }">
          <Tag severity="info" :value="roleLabel(data.role)" />
        </template>
      </Column>
      <Column header="Estado">
        <template #body="{ data }">
          <Tag :severity="data.estado === 'activo' ? 'success' : 'warn'" :value="data.estado" />
        </template>
      </Column>
      <Column v-if="canManage" header="" style="width: 3.5rem">
        <template #body="{ data }">
          <Button icon="pi pi-ellipsis-v" text @click="toggleRowMenu($event, data)" />
        </template>
      </Column>
    </DataTable>

    <Menu ref="rowMenu" :model="rowMenuItems" :popup="true" />

    <Dialog v-model:visible="inviteVisible" modal header="Invitar miembro" style="width: 440px">
      <form class="form-grid" @submit.prevent="confirmInvite">
        <label class="field">
          <span>Email</span>
          <InputText v-model="inviteDraft.email" type="email" required />
        </label>
        <label class="field">
          <span>Nombre (solo si es un usuario nuevo)</span>
          <InputText v-model="inviteDraft.nombre" />
        </label>
        <label class="field">
          <span>Rol</span>
          <Select v-model="inviteDraft.role" :options="ROLES" option-label="label" option-value="value" />
        </label>

        <div class="form-actions">
          <Button label="Cancelar" text @click="inviteVisible = false" />
          <Button type="submit" label="Invitar" :loading="inviting" />
        </div>
      </form>
    </Dialog>

    <Dialog v-model:visible="roleDialogVisible" modal header="Cambiar rol" style="width: 400px">
      <form class="form-grid" @submit.prevent="confirmChangeRole">
        <p v-if="roleDialogMember">{{ roleDialogMember.nombre }} ({{ roleDialogMember.email }})</p>
        <label class="field">
          <span>Rol</span>
          <Select v-model="roleDialogValue" :options="ROLES" option-label="label" option-value="value" />
        </label>

        <div class="form-actions">
          <Button label="Cancelar" text @click="roleDialogVisible = false" />
          <Button type="submit" label="Guardar" :loading="savingRole" />
        </div>
      </form>
    </Dialog>

    <Dialog
      :visible="!!tempPasswordResult"
      modal
      header="Contraseña temporal"
      style="width: 460px"
      :closable="false"
    >
      <div v-if="tempPasswordResult" class="temp-password">
        <p>
          Se creó una cuenta nueva para <strong>{{ tempPasswordResult.email }}</strong
          >. Esta contraseña solo se muestra una vez — cópiala y compártela con la persona por un canal seguro:
        </p>
        <code class="temp-password-value">{{ tempPasswordResult.tempPassword }}</code>
      </div>
      <template #footer>
        <Button label="Listo" @click="tempPasswordResult = null" />
      </template>
    </Dialog>
  </div>
</template>

<style scoped>
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1.25rem;
}

.page-title {
  margin: 0;
  font-size: 1.4rem;
}

.hint {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.85rem;
  color: var(--text-secondary);
  margin: -0.5rem 0 1rem;
}

.stacked-cell {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.muted {
  font-size: 0.78rem;
  color: var(--text-secondary);
  font-weight: 400;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: #334155;
}

.form-grid {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.temp-password {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  font-size: 0.9rem;
  color: var(--text-secondary);
}

.temp-password-value {
  display: block;
  padding: 0.75rem 1rem;
  background: var(--page-bg);
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--text-primary);
  text-align: center;
  user-select: all;
}
</style>
