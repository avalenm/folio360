<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Menu from 'primevue/menu'
import type { MenuItem } from 'primevue/menuitem'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { useResource } from '@/composables/useResource'
import { feathersClient } from '@/services/feathers'
import type { Supplier, SituacionTributaria } from '@/types'

const { items, loading, fetchAll, create, update, remove } = useResource<Supplier>('suppliers')
const confirm = useConfirm()
const toast = useToast()

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(' ')
    .map((word) => (word.length > 0 ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ')
}

const buscandoRut = ref(false)

// Autocompleta razón social/giro consultando la "Situación Tributaria" pública
// del SII por RUT — endpoint no oficial (no documentado por el SII), ver
// sii/rut-lookup.ts para el detalle y por qué se decidió usar igual.
async function buscarPorRut(): Promise<void> {
  if (!draft.rut || !draft.rut.includes('-')) {
    toast.add({ severity: 'warn', summary: 'Ingresa un RUT completo (con guión y dígito verificador)', life: 3000 })
    return
  }

  buscandoRut.value = true
  try {
    const result = (await feathersClient.service('rut-lookup').create({ rut: draft.rut })) as SituacionTributaria
    if (!result.registrado || !result.nombre) {
      toast.add({ severity: 'warn', summary: 'No se encontraron datos para ese RUT', life: 3000 })
      return
    }

    draft.razonSocial = titleCase(result.nombre)
    if (result.giros.length > 0) {
      draft.giros = result.giros.map((g) => titleCase(g.descripcion))
      draft.giro = draft.giros[0]
    }
    toast.add({ severity: 'success', summary: 'Datos completados desde el SII', life: 2500 })
  } catch (e) {
    toast.add({
      severity: 'error',
      summary: 'Error al consultar el RUT',
      detail: e instanceof Error ? e.message : undefined,
      life: 4000
    })
  } finally {
    buscandoRut.value = false
  }
}

const filterText = ref('')

const filteredItems = computed(() => {
  const needle = filterText.value.trim().toLowerCase()
  if (!needle) return items.value
  return items.value.filter(
    (s) => s.razonSocial.toLowerCase().includes(needle) || s.rut.toLowerCase().includes(needle)
  )
})

const selectedItems = ref<Supplier[]>([])

function confirmDeleteSelected(): void {
  confirm.require({
    message: `¿Eliminar ${selectedItems.value.length} proveedor(es) seleccionados?`,
    header: 'Confirmar eliminación',
    icon: 'pi pi-exclamation-triangle',
    acceptProps: { severity: 'danger' },
    accept: async () => {
      try {
        await Promise.all(selectedItems.value.map((s) => remove(s._id)))
        selectedItems.value = []
        toast.add({ severity: 'success', summary: 'Eliminados', life: 2500 })
      } catch (e) {
        toast.add({
          severity: 'error',
          summary: 'Error al eliminar',
          detail: e instanceof Error ? e.message : undefined,
          life: 4000
        })
      }
    }
  })
}

const dialogVisible = ref(false)
const editingId = ref<string | null>(null)
const saving = ref(false)

function emptyDraft(): Partial<Supplier> {
  return { rut: '', razonSocial: '', giro: '', direccion: '', comuna: '', ciudad: '', email: '' }
}

const draft = reactive<Partial<Supplier>>(emptyDraft())

function openCreate(): void {
  editingId.value = null
  Object.assign(draft, emptyDraft())
  dialogVisible.value = true
}

function openEdit(supplier: Supplier): void {
  editingId.value = supplier._id
  Object.assign(draft, supplier)
  dialogVisible.value = true
}

async function handleSave(): Promise<void> {
  saving.value = true
  try {
    if (editingId.value) {
      await update(editingId.value, draft)
    } else {
      await create(draft)
    }
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

function confirmDelete(supplier: Supplier): void {
  confirm.require({
    message: `¿Eliminar a ${supplier.razonSocial}?`,
    header: 'Confirmar eliminación',
    icon: 'pi pi-exclamation-triangle',
    acceptProps: { severity: 'danger' },
    accept: async () => {
      try {
        await remove(supplier._id)
        toast.add({ severity: 'success', summary: 'Eliminado', life: 2500 })
      } catch (e) {
        toast.add({
          severity: 'error',
          summary: 'Error al eliminar',
          detail: e instanceof Error ? e.message : undefined,
          life: 4000
        })
      }
    }
  })
}

const rowMenu = ref()
const menuSupplier = ref<Supplier | null>(null)

const rowMenuItems = computed<MenuItem[]>(() => {
  const supplier = menuSupplier.value
  if (!supplier) return []
  return [
    { label: 'Editar', icon: 'pi pi-pencil', command: () => openEdit(supplier) },
    { label: 'Eliminar', icon: 'pi pi-trash', command: () => confirmDelete(supplier) }
  ]
})

function toggleRowMenu(event: Event, supplier: Supplier): void {
  menuSupplier.value = supplier
  rowMenu.value?.toggle(event)
}

onMounted(fetchAll)
</script>

<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">Proveedores</h1>
      <Button label="Nuevo proveedor" icon="pi pi-plus" @click="openCreate" />
    </div>

    <div class="filters surface-card">
      <label class="field field-grow">
        <span>Buscar</span>
        <InputText v-model="filterText" placeholder="Nombre o RUT" />
      </label>
    </div>

    <div v-if="selectedItems.length > 0" class="bulk-bar surface-card">
      <span>{{ selectedItems.length }} seleccionado(s)</span>
      <Button label="Eliminar seleccionados" icon="pi pi-trash" severity="danger" text @click="confirmDeleteSelected" />
    </div>

    <DataTable v-model:selection="selectedItems" :value="filteredItems" :loading="loading" data-key="_id" striped-rows>
      <Column selection-mode="multiple" style="width: 3rem" />
      <Column header="Proveedor">
        <template #body="{ data }">
          <div class="stacked-cell">
            <strong>{{ data.razonSocial }}</strong>
            <span class="muted">{{ data.rut }}</span>
          </div>
        </template>
      </Column>
      <Column field="giro" header="Giro" />
      <Column field="email" header="Email" />
      <Column header="" style="width: 3.5rem">
        <template #body="{ data }">
          <Button icon="pi pi-ellipsis-v" text @click="toggleRowMenu($event, data)" />
        </template>
      </Column>
    </DataTable>

    <Menu ref="rowMenu" :model="rowMenuItems" :popup="true" />

    <Dialog v-model:visible="dialogVisible" modal :header="editingId ? 'Editar proveedor' : 'Nuevo proveedor'" style="width: 480px">
      <form class="form-grid" @submit.prevent="handleSave">
        <label class="field">
          <span>RUT</span>
          <div class="rut-row">
            <InputText v-model="draft.rut" required />
            <Button
              icon="pi pi-search"
              text
              :loading="buscandoRut"
              title="Buscar/actualizar datos desde el SII"
              @click="buscarPorRut"
            />
          </div>
        </label>
        <label class="field">
          <span>Razón social</span>
          <InputText v-model="draft.razonSocial" required />
        </label>
        <label class="field">
          <span>Giro</span>
          <InputText v-model="draft.giro" />
        </label>
        <label class="field">
          <span>Dirección</span>
          <InputText v-model="draft.direccion" />
        </label>
        <label class="field">
          <span>Comuna</span>
          <InputText v-model="draft.comuna" />
        </label>
        <label class="field">
          <span>Ciudad</span>
          <InputText v-model="draft.ciudad" />
        </label>
        <label class="field">
          <span>Email</span>
          <InputText v-model="draft.email" type="email" />
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

.filters {
  display: flex;
  align-items: flex-end;
  gap: 1rem;
  padding: 1rem 1.25rem;
  margin-bottom: 1rem;
}

.bulk-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.6rem 1.25rem;
  margin-bottom: 1rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-secondary);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: #334155;
}

.field-grow {
  flex: 1;
  min-width: 220px;
}

.rut-row {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.rut-row .p-inputtext {
  flex: 1;
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
</style>
