<script setup lang="ts">
import AyudaPagina from '@/components/AyudaPagina.vue'
import { AYUDA_FACTURAS_RECIBIDAS } from '@/ayudaContenidos'
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
  // Los reclamos van por otro flujo que las aceptaciones: una factura
  // reclamada NO es una deuda, así que no se registra como compra — se
  // registra el reclamo ante el SII, se le envía el rechazo comercial al
  // emisor por correo y el documento sale de la bandeja. Ver
  // reclamar-incoming-invoice.service.ts en el server.
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
const confirmButtonLabel = computed(() => {
  if (!confirmAccionMeta.value) return 'Registrar compra'
  return confirmAccionMeta.value.disputa
    ? 'Reclamar ante el SII'
    : `${confirmAccionMeta.value.shortLabel} y registrar compra`
})

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
    // Reclamo: flujo aparte — RCD al SII + rechazo comercial al emisor +
    // fuera de la bandeja, SIN registrar compra (una factura reclamada no
    // es una deuda).
    if (confirmAccionMeta.value?.disputa) {
      const result = await feathersClient.service('reclamar-incoming-invoice').create({
        incomingInvoiceId: invoice._id,
        accion: confirmAccion.value as PurchaseAccionSii
      })
      incoming.value = incoming.value.filter((i) => i._id !== invoice._id)
      confirmVisible.value = false
      if (result.emailEnviado) {
        toast.add({ severity: 'success', summary: 'Reclamo registrado en el SII y rechazo enviado al emisor', life: 3500 })
      } else {
        toast.add({
          severity: 'warn',
          summary: 'Reclamo registrado en el SII, pero no se pudo avisar al emisor por correo',
          detail: result.emailError,
          life: 6000
        })
      }
      return
    }

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

  if (invoice.tipoDte === 33) {
    // Con el plazo de reclamo vencido la factura ya quedó aceptada por la
    // vía tácita y el SII rechaza acuses fuera de plazo — registrar sin
    // aviso es la única acción que corresponde. Se ofrece siempre (también
    // sirve si el acuse ya se hizo por otra vía, p. ej. en sii.cl).
    items.push({
      label: 'Registrar compra (sin aviso al SII)',
      icon: 'pi pi-check',
      command: () => openConfirm(invoice, null)
    })
  }

  items.push({ label: 'Descartar', icon: 'pi pi-times', command: () => confirmDiscard(invoice) })
  return items
})

function toggleRowMenu(event: Event, invoice: IncomingInvoice): void {
  menuInvoice.value = invoice
  rowMenu.value?.toggle(event)
}

// --- Plazo de reclamo (Ley 19.983): 8 días desde la recepción ---
const PLAZO_RECLAMO_DIAS = 8

function diasRestantesReclamo(invoice: IncomingInvoice): number {
  const transcurridos = Math.floor((Date.now() - new Date(invoice.recibidoEn).getTime()) / 86_400_000)
  return PLAZO_RECLAMO_DIAS - transcurridos
}

function plazoTag(invoice: IncomingInvoice): { severity: string; value: string } {
  const dias = diasRestantesReclamo(invoice)
  if (dias <= 0) return { severity: 'secondary', value: 'Plazo vencido — aceptación tácita' }
  if (dias <= 2) return { severity: 'danger', value: `${dias} día${dias === 1 ? '' : 's'} para reclamar` }
  if (dias <= 4) return { severity: 'warn', value: `${dias} días para reclamar` }
  return { severity: 'info', value: `${dias} días para reclamar` }
}

// --- Sincronización manual del RCV ---
const syncingRcv = ref(false)

async function buscarEnRcv(): Promise<void> {
  syncingRcv.value = true
  try {
    const result = await feathersClient.service('rcv-sync').create({})
    await fetchAll()
    toast.add({
      severity: result.nuevas > 0 ? 'info' : 'success',
      summary:
        result.nuevas > 0
          ? `${result.nuevas} factura(s) del RCV que no habían llegado por correo`
          : 'RCV revisado — nada nuevo',
      detail: `${result.revisados} documento(s) revisados en el registro del SII`,
      life: 4000
    })
  } catch (e) {
    toast.add({
      severity: 'error',
      summary: 'Error al consultar el RCV',
      detail: e instanceof Error ? e.message : undefined,
      life: 5000
    })
  } finally {
    syncingRcv.value = false
  }
}

onMounted(async () => {
  await Promise.all([fetchAll(), fetchSuppliers()])
})
</script>

<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">Facturas recibidas <AyudaPagina titulo="Facturas recibidas" :secciones="AYUDA_FACTURAS_RECIBIDAS" /></h1>
      <Button label="Buscar en el RCV" icon="pi pi-sync" outlined :loading="syncingRcv" @click="buscarEnRcv" />
    </div>

    <p class="page-hint">
      Documentos detectados automáticamente en la
      <router-link to="/casilla-intercambio">Casilla de Intercambio</router-link>
      — elige la acción que corresponde. Aceptar registra la compra y avisa al SII y al emisor; Reclamar registra el
      reclamo ante el SII y rechaza el documento al emisor <strong>sin</strong> registrarlo como compra. Plazo legal
      para reclamar: 8 días desde la recepción — después opera la aceptación tácita.
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
        <template #body="{ data }">
          <div class="stacked-cell">
            <span>{{ new Date(data.fechaEmision).toLocaleDateString('es-CL') }}</span>
            <span v-if="data.origen === 'rcv'" class="muted">Detectada en el RCV</span>
          </div>
        </template>
      </Column>

      <Column header="Plazo de reclamo">
        <template #body="{ data }">
          <Tag v-if="data.tipoDte === 33" :severity="plazoTag(data).severity" :value="plazoTag(data).value" />
          <span v-else class="muted">No aplica</span>
        </template>
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
          Se registrará el reclamo ante el SII (Ley 19.983), se le enviará el rechazo comercial al correo del
          emisor y el documento saldrá de la bandeja <strong>sin registrarse como compra</strong> — una factura
          reclamada no es una deuda. El reclamo es definitivo: el SII no permite revertirlo.
        </Message>

        <label v-if="!confirmAccionMeta?.disputa" class="field">
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
