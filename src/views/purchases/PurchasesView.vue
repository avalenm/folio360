<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import Select from 'primevue/select'
import DatePicker from 'primevue/datepicker'
import ToggleSwitch from 'primevue/toggleswitch'
import Menu from 'primevue/menu'
import Tag from 'primevue/tag'
import type { MenuItem } from 'primevue/menuitem'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { useResource } from '@/composables/useResource'
import { feathersClient } from '@/services/feathers'
import type { Purchase, PurchaseAccionSii, PurchaseTipoDocumento, Supplier } from '@/types'

const { items: purchases, loading, fetchAll, create, update, remove } = useResource<Purchase>('purchases')
const { items: suppliers, fetchAll: fetchSuppliers } = useResource<Supplier>('suppliers')
const confirm = useConfirm()
const toast = useToast()

const tiposDocumento: { label: string; value: PurchaseTipoDocumento }[] = [
  { label: 'Factura', value: 'factura' },
  { label: 'Boleta', value: 'boleta' },
  { label: 'Nota de crédito', value: 'nota_credito' },
  { label: 'Nota de débito', value: 'nota_debito' }
]

const tipoDocumentoLabel: Record<PurchaseTipoDocumento, string> = {
  factura: 'Factura',
  boleta: 'Boleta',
  nota_credito: 'Nota de crédito',
  nota_debito: 'Nota de débito'
}

const accionesSii: { label: string; value: PurchaseAccionSii }[] = [
  { label: 'Aceptar contenido del documento', value: 'ACD' },
  { label: 'Reclamar contenido del documento', value: 'RCD' },
  { label: 'Acuse recibo de mercaderías/servicios', value: 'ERM' },
  { label: 'Reclamo por falta parcial de mercadería', value: 'RFP' },
  { label: 'Reclamo por falta total de mercadería', value: 'RFT' }
]

const accionSiiLabel: Record<PurchaseAccionSii, string> = {
  ACD: 'Aceptado',
  RCD: 'Reclamado',
  ERM: 'Acuse recibo',
  RFP: 'Reclamo falta parcial',
  RFT: 'Reclamo falta total'
}

const supplierOptions = computed(() => suppliers.value.map((s) => ({ label: s.razonSocial, value: s._id })))

function supplierOf(id: string): Supplier | undefined {
  return suppliers.value.find((s) => s._id === id)
}

// --- Filtros (client-side, mismo patrón que DocumentsView.vue) ---
const filterFolio = ref('')
const filterProveedor = ref('')
const filterTipo = ref<PurchaseTipoDocumento | null>(null)
const filterFechas = ref<Date[] | null>(null)

const tipoFilterOptions = tiposDocumento

const filteredPurchases = computed(() =>
  purchases.value.filter((purchase) => {
    if (filterFolio.value && !purchase.folio.includes(filterFolio.value.trim())) {
      return false
    }

    if (filterProveedor.value) {
      const supplier = supplierOf(purchase.supplierId)
      const needle = filterProveedor.value.trim().toLowerCase()
      const matches =
        supplier && (supplier.razonSocial.toLowerCase().includes(needle) || supplier.rut.toLowerCase().includes(needle))
      if (!matches) return false
    }

    if (filterTipo.value && purchase.tipoDocumento !== filterTipo.value) {
      return false
    }

    const [from, to] = filterFechas.value ?? []
    if (from) {
      const purchaseDate = new Date(purchase.fecha)
      if (purchaseDate < from) return false
      if (to && purchaseDate > new Date(to.getTime() + 86399999)) return false
    }

    return true
  })
)

function limpiarFiltros(): void {
  filterFolio.value = ''
  filterProveedor.value = ''
  filterTipo.value = null
  filterFechas.value = null
}

const selectedPurchases = ref<Purchase[]>([])

function confirmDeleteSelected(): void {
  confirm.require({
    message: `¿Eliminar ${selectedPurchases.value.length} documento(s) de compra seleccionados?`,
    header: 'Confirmar eliminación',
    icon: 'pi pi-exclamation-triangle',
    acceptProps: { severity: 'danger' },
    accept: async () => {
      try {
        await Promise.all(selectedPurchases.value.map((p) => remove(p._id)))
        selectedPurchases.value = []
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

interface PurchaseDraft {
  supplierId: string
  tipoDocumento: PurchaseTipoDocumento
  folio: string
  fecha: Date
  fechaVencimiento: Date | null
  glosa: string
  montoNeto: number
  montoIva: number
  montoExento: number
}

function emptyDraft(): PurchaseDraft {
  return {
    supplierId: '',
    tipoDocumento: 'factura',
    folio: '',
    fecha: new Date(),
    fechaVencimiento: null,
    glosa: '',
    montoNeto: 0,
    montoIva: 0,
    montoExento: 0
  }
}

const draft = reactive<PurchaseDraft>(emptyDraft())

const montoTotalPreview = computed(() => draft.montoNeto + draft.montoIva + draft.montoExento)

function openCreate(): void {
  editingId.value = null
  Object.assign(draft, emptyDraft())
  dialogVisible.value = true
}

function openEdit(purchase: Purchase): void {
  editingId.value = purchase._id
  Object.assign(draft, {
    supplierId: purchase.supplierId,
    tipoDocumento: purchase.tipoDocumento,
    folio: purchase.folio,
    fecha: new Date(purchase.fecha),
    fechaVencimiento: purchase.fechaVencimiento ? new Date(purchase.fechaVencimiento) : null,
    glosa: purchase.glosa ?? '',
    montoNeto: purchase.montoNeto,
    montoIva: purchase.montoIva,
    montoExento: purchase.montoExento
  })
  dialogVisible.value = true
}

async function handleSave(): Promise<void> {
  saving.value = true
  try {
    const payload = {
      supplierId: draft.supplierId,
      tipoDocumento: draft.tipoDocumento,
      folio: draft.folio,
      fecha: draft.fecha.toISOString(),
      fechaVencimiento: draft.fechaVencimiento ? draft.fechaVencimiento.toISOString() : undefined,
      glosa: draft.glosa || undefined,
      montoNeto: draft.montoNeto,
      montoIva: draft.montoIva,
      montoExento: draft.montoExento
    }

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

async function togglePagado(purchase: Purchase): Promise<void> {
  try {
    await update(purchase._id, { pagado: !purchase.pagado })
  } catch (e) {
    toast.add({
      severity: 'error',
      summary: 'Error al actualizar cobranza',
      detail: e instanceof Error ? e.message : undefined,
      life: 4000
    })
  }
}

function confirmDelete(purchase: Purchase): void {
  confirm.require({
    message: `¿Eliminar este documento de compra (folio ${purchase.folio})?`,
    header: 'Confirmar eliminación',
    icon: 'pi pi-exclamation-triangle',
    acceptProps: { severity: 'danger' },
    accept: async () => {
      try {
        await remove(purchase._id)
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

const acuseVisible = ref(false)
const acusePurchase = ref<Purchase | null>(null)
const acuseAccion = ref<PurchaseAccionSii>('ACD')
const acuseSending = ref(false)

function openAcuse(purchase: Purchase): void {
  acusePurchase.value = purchase
  acuseAccion.value = 'ACD'
  acuseVisible.value = true
}

function confirmAcuse(): void {
  const purchase = acusePurchase.value
  if (!purchase) return

  confirm.require({
    message:
      'Esto registra la acción ante el SII usando el certificado digital de la organización — es una acción legal real, no se puede deshacer. ¿Continuar?',
    header: 'Confirmar acuse/reclamo SII',
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Confirmar',
    acceptProps: { severity: 'danger' },
    accept: async () => {
      acuseSending.value = true
      try {
        await feathersClient
          .service('purchases-acuse-recibo')
          .create({ purchaseId: purchase._id, accion: acuseAccion.value })
        await fetchAll()
        acuseVisible.value = false
        toast.add({ severity: 'success', summary: 'Acción registrada ante el SII', life: 3000 })
      } catch (e) {
        toast.add({
          severity: 'error',
          summary: 'Error al registrar la acción',
          detail: e instanceof Error ? e.message : undefined,
          life: 5000
        })
      } finally {
        acuseSending.value = false
      }
    }
  })
}

// --- Menú de acciones por fila ---
const rowMenu = ref()
const menuPurchase = ref<Purchase | null>(null)

const rowMenuItems = computed<MenuItem[]>(() => {
  const purchase = menuPurchase.value
  if (!purchase) return []

  const items: MenuItem[] = [{ label: 'Editar', icon: 'pi pi-pencil', command: () => openEdit(purchase) }]

  if (purchase.tipoDocumento === 'factura') {
    items.push({ label: 'Acuse/reclamo SII', icon: 'pi pi-verified', command: () => openAcuse(purchase) })
  }

  items.push({ label: 'Eliminar', icon: 'pi pi-trash', command: () => confirmDelete(purchase) })

  return items
})

function toggleRowMenu(event: Event, purchase: Purchase): void {
  menuPurchase.value = purchase
  rowMenu.value?.toggle(event)
}

onMounted(async () => {
  await Promise.all([fetchAll(), fetchSuppliers()])
})
</script>

<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">Compras</h1>
      <Button label="Nuevo documento" icon="pi pi-plus" @click="openCreate" />
    </div>

    <div class="filters surface-card">
      <label class="field">
        <span>Folio</span>
        <InputText v-model="filterFolio" placeholder="N° folio" />
      </label>
      <label class="field">
        <span>Proveedor o RUT</span>
        <InputText v-model="filterProveedor" placeholder="Nombre o RUT" />
      </label>
      <label class="field">
        <span>Tipo</span>
        <Select
          v-model="filterTipo"
          :options="tipoFilterOptions"
          option-label="label"
          option-value="value"
          placeholder="Todos"
          show-clear
          style="width: 180px"
        />
      </label>
      <label class="field field-grow">
        <span>Fecha</span>
        <DatePicker v-model="filterFechas" selection-mode="range" date-format="dd/mm/yy" placeholder="Rango de fechas" show-icon icon-display="input" />
      </label>
      <Button label="Limpiar filtros" text @click="limpiarFiltros" />
    </div>

    <div v-if="selectedPurchases.length > 0" class="bulk-bar surface-card">
      <span>{{ selectedPurchases.length }} seleccionado(s)</span>
      <Button label="Eliminar seleccionados" icon="pi pi-trash" severity="danger" text @click="confirmDeleteSelected" />
    </div>

    <DataTable v-model:selection="selectedPurchases" :value="filteredPurchases" :loading="loading" data-key="_id" striped-rows>
      <Column selection-mode="multiple" style="width: 3rem" />

      <Column header="Proveedor">
        <template #body="{ data }">
          <div class="stacked-cell">
            <strong>{{ supplierOf(data.supplierId)?.razonSocial ?? data.supplierId }}</strong>
            <span class="muted">{{ supplierOf(data.supplierId)?.rut }}</span>
          </div>
        </template>
      </Column>

      <Column header="Folio / Tipo">
        <template #body="{ data }">
          <div class="stacked-cell">
            <strong>{{ data.folio }}</strong>
            <span class="muted">{{ tipoDocumentoLabel[data.tipoDocumento as PurchaseTipoDocumento] }}</span>
          </div>
        </template>
      </Column>

      <Column header="Fecha">
        <template #body="{ data }">{{ new Date(data.fecha).toLocaleDateString('es-CL') }}</template>
      </Column>

      <Column header="Total">
        <template #body="{ data }">${{ data.montoTotal.toLocaleString('es-CL') }}</template>
      </Column>

      <Column header="Pagado">
        <template #body="{ data }">
          <ToggleSwitch :model-value="data.pagado" @update:model-value="togglePagado(data)" />
        </template>
      </Column>

      <Column header="Acuse SII">
        <template #body="{ data }">
          <Tag
            v-if="data.siiAcuse"
            :severity="data.siiAcuse.codResp === 0 ? 'success' : 'danger'"
            :value="accionSiiLabel[data.siiAcuse.accion as PurchaseAccionSii]"
            :title="data.siiAcuse.descResp"
          />
          <span v-else-if="data.tipoDocumento === 'factura'" class="acuse-pendiente">Pendiente</span>
          <span v-else>—</span>
        </template>
      </Column>

      <Column header="" style="width: 3.5rem">
        <template #body="{ data }">
          <Button icon="pi pi-ellipsis-v" text @click="toggleRowMenu($event, data)" />
        </template>
      </Column>
    </DataTable>

    <Menu ref="rowMenu" :model="rowMenuItems" :popup="true" />

    <Dialog
      v-model:visible="dialogVisible"
      modal
      :header="editingId ? 'Editar documento de compra' : 'Nuevo documento de compra'"
      style="width: 560px"
    >
      <form class="form-grid" @submit.prevent="handleSave">
        <div class="form-row">
          <label class="field">
            <span>Tipo de documento</span>
            <Select v-model="draft.tipoDocumento" :options="tiposDocumento" option-label="label" option-value="value" />
          </label>
          <label class="field">
            <span>Folio</span>
            <InputText v-model="draft.folio" required />
          </label>
        </div>

        <label class="field">
          <span>Proveedor</span>
          <Select v-model="draft.supplierId" :options="supplierOptions" option-label="label" option-value="value" filter />
        </label>

        <div class="form-row">
          <label class="field field-grow">
            <span>Fecha</span>
            <DatePicker v-model="draft.fecha" date-format="dd/mm/yy" />
          </label>
          <label class="field field-grow">
            <span>Vencimiento</span>
            <DatePicker v-model="draft.fechaVencimiento" date-format="dd/mm/yy" show-icon icon-display="input" />
          </label>
        </div>

        <label class="field">
          <span>Glosa</span>
          <InputText v-model="draft.glosa" />
        </label>

        <div class="form-row">
          <label class="field">
            <span>Monto neto</span>
            <InputNumber v-model="draft.montoNeto" :min="0" />
          </label>
          <label class="field">
            <span>IVA</span>
            <InputNumber v-model="draft.montoIva" :min="0" />
          </label>
          <label class="field">
            <span>Exento</span>
            <InputNumber v-model="draft.montoExento" :min="0" />
          </label>
        </div>

        <div class="total-preview">Total: {{ montoTotalPreview.toLocaleString('es-CL') }}</div>

        <div class="form-actions">
          <Button label="Cancelar" text @click="dialogVisible = false" />
          <Button type="submit" label="Guardar" :loading="saving" />
        </div>
      </form>
    </Dialog>

    <Dialog v-model:visible="acuseVisible" modal header="Acuse/reclamo ante el SII" style="width: 480px">
      <div class="form-grid">
        <p class="acuse-hint">
          Documento: {{ acusePurchase?.folio }} — {{ supplierOf(acusePurchase?.supplierId ?? '')?.razonSocial }}
        </p>
        <label class="field">
          <span>Acción</span>
          <Select v-model="acuseAccion" :options="accionesSii" option-label="label" option-value="value" />
        </label>
        <div class="form-actions">
          <Button label="Cancelar" text @click="acuseVisible = false" />
          <Button label="Registrar ante el SII" severity="danger" :loading="acuseSending" @click="confirmAcuse" />
        </div>
      </div>
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
  flex-wrap: wrap;
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

.form-grid {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.form-row {
  display: flex;
  gap: 0.75rem;
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

.total-preview {
  text-align: right;
  font-weight: 700;
  color: #1e293b;
}

.acuse-pendiente {
  font-size: 0.8rem;
  color: #9aa5b5;
  font-weight: 600;
}

.acuse-hint {
  margin: 0;
  font-size: 0.85rem;
  color: #475569;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.5rem;
}
</style>
