<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import Select from 'primevue/select'
import Message from 'primevue/message'
import Menu from 'primevue/menu'
import Tag from 'primevue/tag'
import type { MenuItem } from 'primevue/menuitem'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { useResource } from '@/composables/useResource'
import { feathersClient } from '@/services/feathers'
import type { IncomingInvoice, PurchaseAccionSii, Supplier } from '@/types'

const { items: incoming, loading, fetchAll, remove } = useResource<IncomingInvoice>('incoming-invoices')
const { items: suppliers, fetchAll: fetchSuppliers } = useResource<Supplier>('suppliers')
const confirm = useConfirm()
const toast = useToast()

const tipoDteLabel: Record<number, string> = {
  33: 'Factura',
  34: 'Factura exenta',
  56: 'Nota de débito',
  61: 'Nota de crédito'
}

interface AccionMeta {
  label: string
  shortLabel: string
  value: PurchaseAccionSii
  // Reclamar (a diferencia de aceptar/acusar recibo) no implica que se
  // acepte el documento — la compra igual queda registrada (para tener
  // rastro contable) pero marcada como disputada, no como una deuda
  // aceptada sin más. Ver registrar-acuse.ts en el server.
  disputa: boolean
  icon: string
}

// El webservice de acuse/reclamo (Ley 19.983) solo entiende Factura
// (tipoDoc SII 33) — ver la nota en confirm-incoming-invoice.service.ts. Son
// acciones DIRECTAS: cada una manda su propia acción al SII y registra la
// compra en el mismo paso, no un "Confirmar" genérico con una acción
// opcional escondida adentro.
const accionesSii: AccionMeta[] = [
  { label: 'Aceptar contenido del documento', shortLabel: 'Aceptar', value: 'ACD', disputa: false, icon: 'pi-check' },
  { label: 'Acuse recibo de mercaderías/servicios', shortLabel: 'Acuse recibo', value: 'ERM', disputa: false, icon: 'pi-verified' },
  { label: 'Reclamar contenido del documento', shortLabel: 'Reclamar', value: 'RCD', disputa: true, icon: 'pi-flag' },
  { label: 'Reclamo por falta parcial de mercadería', shortLabel: 'Reclamo falta parcial', value: 'RFP', disputa: true, icon: 'pi-flag' },
  { label: 'Reclamo por falta total de mercadería', shortLabel: 'Reclamo falta total', value: 'RFT', disputa: true, icon: 'pi-flag' }
]

function supplierMatch(rut: string): Supplier | undefined {
  return suppliers.value.find((s) => s.rut === rut)
}

const supplierOptions = computed(() => suppliers.value.map((s) => ({ label: `${s.razonSocial} (${s.rut})`, value: s._id })))

const confirmVisible = ref(false)
const confirmTarget = ref<IncomingInvoice | null>(null)
const confirmSupplierId = ref<string | null>(null)
const confirmAccion = ref<PurchaseAccionSii | null>(null)
const confirming = ref(false)

const confirmAccionMeta = computed(() => accionesSii.find((a) => a.value === confirmAccion.value) ?? null)
const confirmButtonLabel = computed(() =>
  confirmAccionMeta.value ? `${confirmAccionMeta.value.shortLabel} y registrar compra` : 'Registrar compra'
)

function openConfirm(invoice: IncomingInvoice, accion: PurchaseAccionSii | null): void {
  confirmTarget.value = invoice
  confirmSupplierId.value = supplierMatch(invoice.emisorRut)?._id ?? null
  confirmAccion.value = accion
  confirmVisible.value = true
}

async function handleConfirm(): Promise<void> {
  const invoice = confirmTarget.value
  if (!invoice) return

  confirming.value = true
  try {
    const result = await feathersClient.service('confirm-incoming-invoice').create({
      incomingInvoiceId: invoice._id,
      supplierId: confirmSupplierId.value ?? undefined,
      accion: confirmAccion.value ?? undefined
    })
    incoming.value = incoming.value.filter((i) => i._id !== invoice._id)
    confirmVisible.value = false

    if (result.acuseError) {
      toast.add({
        severity: 'warn',
        summary: 'Compra registrada, pero el aviso al SII falló',
        detail: result.acuseError,
        life: 6000
      })
    } else if (confirmAccionMeta.value?.disputa) {
      toast.add({ severity: 'warn', summary: 'Compra registrada como disputada, reclamo informado al SII', life: 3500 })
    } else if (result.acuse) {
      toast.add({ severity: 'success', summary: 'Compra registrada y aceptación informada al SII', life: 3000 })
    } else {
      toast.add({ severity: 'success', summary: 'Compra registrada', life: 2500 })
    }
  } catch (e) {
    toast.add({
      severity: 'error',
      summary: 'Error al registrar',
      detail: e instanceof Error ? e.message : undefined,
      life: 5000
    })
  } finally {
    confirming.value = false
  }
}

function confirmDiscard(invoice: IncomingInvoice): void {
  confirm.require({
    message: `¿Descartar la factura ${invoice.folio} de ${invoice.emisorRazonSocial ?? invoice.emisorRut}? No se registrará como compra.`,
    header: 'Descartar',
    icon: 'pi pi-exclamation-triangle',
    acceptProps: { severity: 'danger' },
    accept: async () => {
      try {
        await remove(invoice._id)
        toast.add({ severity: 'success', summary: 'Descartada', life: 2000 })
      } catch (e) {
        toast.add({
          severity: 'error',
          summary: 'Error al descartar',
          detail: e instanceof Error ? e.message : undefined,
          life: 4000
        })
      }
    }
  })
}

// --- Menú de acciones por fila ---
const rowMenu = ref()
const menuInvoice = ref<IncomingInvoice | null>(null)

const rowMenuItems = computed<MenuItem[]>(() => {
  const invoice = menuInvoice.value
  if (!invoice) return []

  const items: MenuItem[] =
    invoice.tipoDte === 33
      ? accionesSii.map((a) => ({ label: a.label, icon: `pi ${a.icon}`, command: () => openConfirm(invoice, a.value) }))
      : [{ label: 'Registrar compra', icon: 'pi pi-check', command: () => openConfirm(invoice, null) }]

  items.push({ label: 'Descartar', icon: 'pi pi-times', command: () => confirmDiscard(invoice) })
  return items
})

function toggleRowMenu(event: Event, invoice: IncomingInvoice): void {
  menuInvoice.value = invoice
  rowMenu.value?.toggle(event)
}

onMounted(async () => {
  await Promise.all([fetchAll(), fetchSuppliers()])
})
</script>

<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">Facturas recibidas</h1>
    </div>

    <p class="page-hint">
      Documentos detectados automáticamente en la
      <router-link to="/casilla-intercambio">Casilla de Intercambio</router-link>
      — elige la acción que corresponde (Aceptar, Reclamar, etc.) o descártalos si no corresponden. Cada acción manda
      la respuesta al SII y registra la compra en el mismo paso.
    </p>

    <DataTable :value="incoming" :loading="loading" data-key="_id" striped-rows>
      <Column header="Emisor">
        <template #body="{ data }">
          <div class="stacked-cell">
            <strong>{{ data.emisorRazonSocial ?? data.emisorRut }}</strong>
            <span class="muted">{{ data.emisorRut }}</span>
          </div>
        </template>
      </Column>

      <Column header="Folio / Tipo">
        <template #body="{ data }">
          <div class="stacked-cell">
            <strong>{{ data.folio }}</strong>
            <span class="muted">{{ tipoDteLabel[data.tipoDte as number] ?? `Tipo ${data.tipoDte}` }}</span>
          </div>
        </template>
      </Column>

      <Column header="Fecha emisión">
        <template #body="{ data }">{{ new Date(data.fechaEmision).toLocaleDateString('es-CL') }}</template>
      </Column>

      <Column header="Total">
        <template #body="{ data }">${{ data.montoTotal.toLocaleString('es-CL') }}</template>
      </Column>

      <Column header="Proveedor">
        <template #body="{ data }">
          <Tag v-if="supplierMatch(data.emisorRut)" severity="info" value="Ya registrado" />
          <span v-else class="muted">Se creará al confirmar</span>
        </template>
      </Column>

      <Column header="" style="width: 3.5rem">
        <template #body="{ data }">
          <Button icon="pi pi-ellipsis-v" text @click="toggleRowMenu($event, data)" />
        </template>
      </Column>

      <template #empty>No hay facturas pendientes de revisión.</template>
    </DataTable>

    <Menu ref="rowMenu" :model="rowMenuItems" :popup="true" />

    <Dialog
      v-model:visible="confirmVisible"
      modal
      :header="confirmAccionMeta ? confirmAccionMeta.label : 'Registrar compra'"
      style="width: 480px"
    >
      <div v-if="confirmTarget" class="form-grid">
        <p class="confirm-summary">
          {{ tipoDteLabel[confirmTarget.tipoDte] ?? `Tipo ${confirmTarget.tipoDte}` }} folio {{ confirmTarget.folio }} —
          {{ confirmTarget.emisorRazonSocial ?? confirmTarget.emisorRut }} — ${{ confirmTarget.montoTotal.toLocaleString('es-CL') }}
        </p>

        <Message v-if="confirmAccionMeta?.disputa" severity="warn" :closable="false">
          Vas a reclamar este documento ante el SII — la compra queda registrada como disputada (no aceptada), no
          como una deuda confirmada.
        </Message>

        <label class="field">
          <span>Proveedor</span>
          <Select
            v-model="confirmSupplierId"
            :options="supplierOptions"
            option-label="label"
            option-value="value"
            filter
            show-clear
            :placeholder="`Se creará uno nuevo con RUT ${confirmTarget.emisorRut}`"
          />
        </label>

        <div class="form-actions">
          <Button label="Cancelar" text @click="confirmVisible = false" />
          <Button
            :label="confirmButtonLabel"
            :severity="confirmAccionMeta?.disputa ? 'danger' : undefined"
            :loading="confirming"
            @click="handleConfirm"
          />
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
  margin-bottom: 0.5rem;
}

.page-title {
  margin: 0;
  font-size: 1.4rem;
}

.page-hint {
  margin: 0 0 1.25rem;
  font-size: 0.85rem;
  color: var(--text-secondary);
  max-width: 68ch;
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

.confirm-summary {
  margin: 0;
  font-size: 0.9rem;
  color: #334155;
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
