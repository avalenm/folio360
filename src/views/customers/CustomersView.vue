<script setup lang="ts">
import AyudaPagina from '@/components/AyudaPagina.vue'
import { AYUDA_CLIENTES } from '@/ayudaContenidos'
import { computed, onMounted, reactive, ref } from 'vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import Menu from 'primevue/menu'
import Select from 'primevue/select'
import ToggleSwitch from 'primevue/toggleswitch'
import type { MenuItem } from 'primevue/menuitem'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { useResource } from '@/composables/useResource'
import { feathersClient } from '@/services/feathers'
import { PAISES } from '@/codigosAduana'
import type { Customer, SituacionTributaria } from '@/types'

// RUT genérico que el SII asigna a receptores extranjeros — el que llevan
// los documentos de exportación (110/111/112).
const RUT_EXTRANJERO = '55555555-5'

const { items, loading, fetchAll, create, update, remove } = useResource<Customer>('customers')
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
    (c) => c.razonSocial.toLowerCase().includes(needle) || c.rut.toLowerCase().includes(needle)
  )
})

const selectedItems = ref<Customer[]>([])

function confirmDeleteSelected(): void {
  confirm.require({
    message: `¿Eliminar ${selectedItems.value.length} cliente(s) seleccionados?`,
    header: 'Confirmar eliminación',
    icon: 'pi pi-exclamation-triangle',
    acceptProps: { severity: 'danger' },
    accept: async () => {
      try {
        await Promise.all(selectedItems.value.map((c) => remove(c._id)))
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

function emptyDraft(): Partial<Customer> {
  return { rut: '', razonSocial: '', giro: '', direccion: '', comuna: '', ciudad: '', email: '', condicionPago: '' }
}

const draft = reactive<Partial<Customer>>(emptyDraft())

// Receptor extranjero (documentos de exportación): la zona <Extranjero> del
// DTE lleva su identificador nacional y su país (código de Aduana), y el
// RUT del cliente pasa a ser el genérico 55555555-5 — ver customer.model.ts
// en el servidor.
const esExtranjero = ref(false)
const extranjeroNumId = ref('')
const extranjeroNacionalidad = ref<number | null>(null)

// Al marcar extranjero se propone el RUT genérico (si no hay otro escrito);
// la búsqueda por RUT en el SII no aplica para extranjeros.
function onToggleExtranjero(value: boolean): void {
  if (value && !draft.rut) draft.rut = RUT_EXTRANJERO
}

function openCreate(): void {
  editingId.value = null
  Object.assign(draft, emptyDraft())
  esExtranjero.value = false
  extranjeroNumId.value = ''
  extranjeroNacionalidad.value = null
  dialogVisible.value = true
}

function openEdit(customer: Customer): void {
  editingId.value = customer._id
  Object.assign(draft, customer)
  esExtranjero.value = !!customer.extranjero
  extranjeroNumId.value = customer.extranjero?.numId ?? ''
  extranjeroNacionalidad.value = customer.extranjero?.nacionalidad ?? null
  dialogVisible.value = true
}

async function handleSave(): Promise<void> {
  saving.value = true
  try {
    // `null` borra la zona al des-marcar extranjero en una edición (un
    // patch ignora las claves undefined, así que undefined no bastaría).
    const extranjero = esExtranjero.value
      ? {
          numId: extranjeroNumId.value.trim() || undefined,
          nacionalidad: extranjeroNacionalidad.value ?? undefined
        }
      : null
    const payload = { ...draft, extranjero: extranjero as Customer['extranjero'] }

    if (editingId.value) {
      await update(editingId.value, payload)
    } else {
      await create(payload)
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

function confirmDelete(customer: Customer): void {
  confirm.require({
    message: `¿Eliminar a ${customer.razonSocial}?`,
    header: 'Confirmar eliminación',
    icon: 'pi pi-exclamation-triangle',
    acceptProps: { severity: 'danger' },
    accept: async () => {
      try {
        await remove(customer._id)
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
const menuCustomer = ref<Customer | null>(null)

const rowMenuItems = computed<MenuItem[]>(() => {
  const customer = menuCustomer.value
  if (!customer) return []
  return [
    { label: 'Editar', icon: 'pi pi-pencil', command: () => openEdit(customer) },
    { label: 'Eliminar', icon: 'pi pi-trash', command: () => confirmDelete(customer) }
  ]
})

function toggleRowMenu(event: Event, customer: Customer): void {
  menuCustomer.value = customer
  rowMenu.value?.toggle(event)
}

onMounted(fetchAll)
</script>

<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">Clientes <AyudaPagina titulo="Clientes" :secciones="AYUDA_CLIENTES" /></h1>
      <Button label="Nuevo cliente" icon="pi pi-plus" @click="openCreate" />
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
      <Column header="Cliente">
        <template #body="{ data }">
          <div class="stacked-cell">
            <strong>{{ data.razonSocial }}</strong>
            <span class="muted">{{ data.rut }}</span>
          </div>
        </template>
      </Column>
      <Column field="giro" header="Giro" />
      <Column field="email" header="Email" />
      <Column field="condicionPago" header="Condición de pago" />
      <Column header="" style="width: 3.5rem">
        <template #body="{ data }">
          <Button icon="pi pi-ellipsis-v" text @click="toggleRowMenu($event, data)" />
        </template>
      </Column>
    </DataTable>

    <Menu ref="rowMenu" :model="rowMenuItems" :popup="true" />

    <Dialog v-model:visible="dialogVisible" modal :header="editingId ? 'Editar cliente' : 'Nuevo cliente'" style="width: 480px">
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
        <label class="field">
          <span>Condición de pago</span>
          <InputText v-model="draft.condicionPago" />
        </label>
        <label class="field">
          <span>Plazo de pago (días) — vacío = 30 (Ley 21.131)</span>
          <InputNumber v-model="draft.plazoPagoDias" :min="0" :max="365" fluid />
        </label>

        <label class="field field-switch">
          <span>Cliente extranjero (para facturas de exportación)</span>
          <ToggleSwitch v-model="esExtranjero" @update:model-value="onToggleExtranjero" />
        </label>
        <template v-if="esExtranjero">
          <p class="extranjero-hint">
            El RUT debe ser el genérico de extranjeros ({{ RUT_EXTRANJERO }}); el identificador y el país van en
            la zona Extranjero del documento.
          </p>
          <label class="field">
            <span>Identificador en su país (tax ID, pasaporte...)</span>
            <InputText v-model="extranjeroNumId" :maxlength="20" />
          </label>
          <label class="field">
            <span>País (nacionalidad)</span>
            <Select
              v-model="extranjeroNacionalidad"
              :options="PAISES"
              option-label="label"
              option-value="value"
              placeholder="Selecciona el país"
              filter
              show-clear
            />
          </label>
        </template>

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

.field-switch {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.extranjero-hint {
  margin: 0;
  font-size: 0.78rem;
  font-weight: 400;
  color: var(--text-secondary);
}
</style>
