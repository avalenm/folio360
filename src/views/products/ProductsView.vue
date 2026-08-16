<script setup lang="ts">
import AyudaPagina from '@/components/AyudaPagina.vue'
import { AYUDA_PRODUCTOS } from '@/ayudaContenidos'
import { computed, onMounted, reactive, ref } from 'vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import Select from 'primevue/select'
import ToggleSwitch from 'primevue/toggleswitch'
import Menu from 'primevue/menu'
import type { MenuItem } from 'primevue/menuitem'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { useResource } from '@/composables/useResource'
import type { Moneda, Product } from '@/types'

const { items, loading, fetchAll, create, update, remove } = useResource<Product>('products')
const confirm = useConfirm()
const toast = useToast()

const monedas: { label: string; value: Moneda }[] = [
  { label: 'CLP', value: 'CLP' },
  { label: 'UF', value: 'UF' }
]

const filterText = ref('')

const filteredItems = computed(() => {
  const needle = filterText.value.trim().toLowerCase()
  if (!needle) return items.value
  return items.value.filter(
    (p) => p.nombre.toLowerCase().includes(needle) || p.sku.toLowerCase().includes(needle)
  )
})

const selectedItems = ref<Product[]>([])

function confirmDeleteSelected(): void {
  confirm.require({
    message: `¿Eliminar ${selectedItems.value.length} producto(s) seleccionados?`,
    header: 'Confirmar eliminación',
    icon: 'pi pi-exclamation-triangle',
    acceptProps: { severity: 'danger' },
    accept: async () => {
      try {
        await Promise.all(selectedItems.value.map((p) => remove(p._id)))
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

function emptyDraft(): Partial<Product> {
  return { sku: '', nombre: '', precio: 0, moneda: 'CLP', unidad: 'UN', exento: false, impuestoAdicional: 0 }
}

const draft = reactive<Partial<Product>>(emptyDraft())

function openCreate(): void {
  editingId.value = null
  Object.assign(draft, emptyDraft())
  dialogVisible.value = true
}

function openEdit(product: Product): void {
  editingId.value = product._id
  Object.assign(draft, product)
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

function confirmDelete(product: Product): void {
  confirm.require({
    message: `¿Eliminar ${product.nombre}?`,
    header: 'Confirmar eliminación',
    icon: 'pi pi-exclamation-triangle',
    acceptProps: { severity: 'danger' },
    accept: async () => {
      try {
        await remove(product._id)
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
const menuProduct = ref<Product | null>(null)

const rowMenuItems = computed<MenuItem[]>(() => {
  const product = menuProduct.value
  if (!product) return []
  return [
    { label: 'Editar', icon: 'pi pi-pencil', command: () => openEdit(product) },
    { label: 'Eliminar', icon: 'pi pi-trash', command: () => confirmDelete(product) }
  ]
})

function toggleRowMenu(event: Event, product: Product): void {
  menuProduct.value = product
  rowMenu.value?.toggle(event)
}

onMounted(fetchAll)
</script>

<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">Productos <AyudaPagina titulo="Productos" :secciones="AYUDA_PRODUCTOS" /></h1>
      <Button label="Nuevo producto" icon="pi pi-plus" @click="openCreate" />
    </div>

    <div class="filters surface-card">
      <label class="field field-grow">
        <span>Buscar</span>
        <InputText v-model="filterText" placeholder="Nombre o SKU" />
      </label>
    </div>

    <div v-if="selectedItems.length > 0" class="bulk-bar surface-card">
      <span>{{ selectedItems.length }} seleccionado(s)</span>
      <Button label="Eliminar seleccionados" icon="pi pi-trash" severity="danger" text @click="confirmDeleteSelected" />
    </div>

    <DataTable v-model:selection="selectedItems" :value="filteredItems" :loading="loading" data-key="_id" striped-rows>
      <Column selection-mode="multiple" style="width: 3rem" />
      <Column header="Producto">
        <template #body="{ data }">
          <div class="stacked-cell">
            <strong>{{ data.nombre }}</strong>
            <span class="muted">{{ data.sku }}</span>
          </div>
        </template>
      </Column>
      <Column header="Precio">
        <template #body="{ data }">
          {{ data.moneda === 'UF' ? `${data.precio.toLocaleString('es-CL')} UF` : `$${data.precio.toLocaleString('es-CL')}` }}
        </template>
      </Column>
      <Column field="unidad" header="Unidad" />
      <Column header="Exento">
        <template #body="{ data }">{{ data.exento ? 'Sí' : 'No' }}</template>
      </Column>
      <Column header="" style="width: 3.5rem">
        <template #body="{ data }">
          <Button icon="pi pi-ellipsis-v" text @click="toggleRowMenu($event, data)" />
        </template>
      </Column>
    </DataTable>

    <Menu ref="rowMenu" :model="rowMenuItems" :popup="true" />

    <Dialog v-model:visible="dialogVisible" modal :header="editingId ? 'Editar producto' : 'Nuevo producto'" style="width: 480px">
      <form class="form-grid" @submit.prevent="handleSave">
        <label class="field">
          <span>SKU</span>
          <InputText v-model="draft.sku" required />
        </label>
        <label class="field">
          <span>Nombre</span>
          <InputText v-model="draft.nombre" required />
        </label>
        <div class="form-row">
          <label class="field field-grow">
            <span>Precio</span>
            <!-- La UF se expresa con decimales (p.ej. 12,5 UF); los pesos no. -->
            <InputNumber
              v-model="draft.precio"
              mode="decimal"
              :min="0"
              :min-fraction-digits="draft.moneda === 'UF' ? 2 : 0"
              :max-fraction-digits="draft.moneda === 'UF' ? 4 : 0"
            />
          </label>
          <label class="field">
            <span>Moneda</span>
            <Select v-model="draft.moneda" :options="monedas" option-label="label" option-value="value" style="width: 110px" />
          </label>
        </div>
        <p v-if="draft.moneda === 'UF'" class="uf-hint">
          <i class="pi pi-info-circle" /> Al agregarlo a una factura se convierte a pesos usando la UF del día.
        </p>
        <label class="field">
          <span>Unidad</span>
          <InputText v-model="draft.unidad" />
        </label>
        <label class="field field-row">
          <span>Exento de IVA</span>
          <ToggleSwitch v-model="draft.exento" />
        </label>
        <label class="field">
          <span>Impuesto adicional</span>
          <InputNumber v-model="draft.impuestoAdicional" mode="decimal" :min="0" />
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

.field-row {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
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

.form-row {
  display: flex;
  gap: 0.75rem;
  align-items: flex-end;
}

.uf-hint {
  margin: -0.4rem 0 0;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.78rem;
  color: var(--text-secondary);
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.5rem;
}
</style>
