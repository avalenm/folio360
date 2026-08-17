<script setup lang="ts">
import AyudaPagina from '@/components/AyudaPagina.vue'
import { AYUDA_COMPRAS } from '@/ayudaContenidos'
import { computed, onMounted, reactive, ref, watch } from 'vue'
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
import { useListaPaginada } from '@/composables/useListaPaginada'
import { useCatalogoReferencias } from '@/composables/useCatalogoReferencias'
import { NOMBRE_TIPO_COMPRA } from '@/cuentas'
import { feathersClient } from '@/services/feathers'
import type {
  Purchase,
  PurchaseAccionSii,
  PurchaseCodigoIvaNoRec,
  PurchaseTipoDocumento,
  PurchaseWrite,
  Supplier
} from '@/types'

// La lista la pagina el SERVIDOR y los filtros viajan con la consulta: antes
// se cargaban 100 compras y se filtraba sobre esas, así que buscar un folio
// más antiguo que ese corte no encontraba nada.
const {
  items: purchases,
  total: totalCompras,
  desde: desdeCompras,
  porPagina,
  loading,
  cargar: fetchAll,
  irA,
  create,
  update,
  remove
} = useListaPaginada<Purchase>('purchases', { filtros: () => filtrosCompras.value })
const { items: suppliers, fetchAll: fetchSuppliers } = useResource<Supplier>('suppliers')

// Los referenciables NO salen de la página cargada: una nota de crédito
// puede corregir una compra de hace meses.
const { items: comprasReferenciables, cargar: cargarReferenciables, invalidar: invalidarReferenciables } =
  useCatalogoReferencias<Purchase>('purchases', [
    'supplierId',
    'tipoDocumento',
    'folio',
    'fecha',
    'montoTotal',
    'electronico',
    'referencia'
  ])
const confirm = useConfirm()
const toast = useToast()

// Los nombres salen de cuentas.ts, que nombra estas mismas compras en el
// desglose del "Por pagar" de Finanzas: una sola lista para que el mismo
// documento no se llame distinto según la pantalla.
const tipoDocumentoLabel = NOMBRE_TIPO_COMPRA

const tiposDocumento: { label: string; value: PurchaseTipoDocumento }[] = (
  Object.entries(NOMBRE_TIPO_COMPRA) as [PurchaseTipoDocumento, string][]
).map(([value, label]) => ({ label, value }))

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

// Reclamar (a diferencia de aceptar/acusar recibo) no implica que se acepte
// el documento — ver la nota en confirm-incoming-invoice.service.ts. El tag
// de abajo lo refleja en el color independiente de si la llamada al SII en
// sí misma tuvo éxito (codResp) — son dos cosas distintas.
const ACCIONES_DISPUTA: PurchaseAccionSii[] = ['RCD', 'RFP', 'RFT']

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

const filtrosCompras = computed(() => ({
  folio: filterFolio.value.trim(),
  proveedor: filterProveedor.value.trim(),
  tipoDocumento: filterTipo.value,
  desde: filterFechas.value?.[0]?.toISOString(),
  hasta: filterFechas.value?.[1]?.toISOString()
}))

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

// El IVA de una compra puede recibir cuatro tratamientos distintos, y cada
// uno viaja en un campo distinto del Libro de Compras. Se elige el
// tratamiento —no el campo— porque cuál corresponde depende de para qué se
// usó la compra, que es lo que el usuario sí sabe.
type TratamientoIva = 'credito' | 'uso_comun' | 'sin_credito' | 'retenido'

const tratamientosIva: { label: string; value: TratamientoIva; hint: string }[] = [
  { label: 'Con derecho a crédito', value: 'credito', hint: 'El caso normal: el IVA se descuenta como crédito fiscal.' },
  {
    label: 'Uso común (ventas afectas y exentas)',
    value: 'uso_comun',
    hint: 'Cuánto se puede usar como crédito se define al cerrar el período, con el factor de proporcionalidad.'
  },
  {
    label: 'Sin derecho a crédito',
    value: 'sin_credito',
    hint: 'El IVA se pagó pero no se puede descontar. Hay que indicar el motivo.'
  },
  {
    label: 'Retenido totalmente (cambio de sujeto)',
    value: 'retenido',
    hint: 'Solo en facturas de compra: el IVA se retiene y no se le paga al proveedor.'
  }
]

// Códigos de la tabla <IVANoRec> del Formato IECV.
const motivosSinCredito: { label: string; value: PurchaseCodigoIvaNoRec }[] = [
  { label: 'Compras para operaciones no gravadas o exentas', value: 1 },
  { label: 'Factura registrada fuera de plazo', value: 2 },
  { label: 'Gastos rechazados', value: 3 },
  { label: 'Entrega gratuita recibida (premio, bonificación)', value: 4 },
  { label: 'Otros', value: 9 }
]

const TASA_IVA = 0.19

interface PurchaseDraft {
  supplierId: string
  tipoDocumento: PurchaseTipoDocumento
  electronico: boolean
  folio: string
  fecha: Date
  fechaVencimiento: Date | null
  glosa: string
  montoNeto: number
  montoIva: number
  montoExento: number
  tratamientoIva: TratamientoIva
  motivoSinCredito: PurchaseCodigoIvaNoRec
  referenciaId: string | null
}

function emptyDraft(): PurchaseDraft {
  return {
    supplierId: '',
    tipoDocumento: 'factura',
    electronico: true,
    folio: '',
    fecha: new Date(),
    fechaVencimiento: null,
    glosa: '',
    montoNeto: 0,
    montoIva: 0,
    montoExento: 0,
    tratamientoIva: 'credito',
    motivoSinCredito: 4,
    referenciaId: null
  }
}

const draft = reactive<PurchaseDraft>(emptyDraft())

// El IVA se recalcula al cambiar el neto, pero queda editable: los montos
// del documento los fija el proveedor y a veces difieren en un peso por
// redondeo. Lo que se declara tiene que calzar con el papel, no con la
// fórmula.
function recalcularIva(): void {
  draft.montoIva = Math.round(draft.montoNeto * TASA_IVA)
}

const requiereReferencia = computed(
  () => draft.tipoDocumento === 'nota_credito' || draft.tipoDocumento === 'nota_debito'
)

// Solo una factura de compra puede llevar retención (lo valida también el
// server); si se cambia el tipo, el tratamiento vuelve al normal.
const tratamientosDisponibles = computed(() =>
  tratamientosIva.filter((t) => t.value !== 'retenido' || draft.tipoDocumento === 'factura_compra')
)

const tratamientoHint = computed(
  () => tratamientosIva.find((t) => t.value === draft.tratamientoIva)?.hint ?? ''
)

// Si se cambia el tipo a uno que no admite retención, el tratamiento tiene
// que volver atrás: si no, el formulario mostraría una opción ya filtrada y
// el server rechazaría el guardado.
watch(
  () => draft.tipoDocumento,
  (tipo) => {
    if (tipo !== 'factura_compra' && draft.tratamientoIva === 'retenido') {
      draft.tratamientoIva = 'credito'
    }
    if (tipo !== 'nota_credito' && tipo !== 'nota_debito') {
      draft.referenciaId = null
    }
  }
)

// Documentos del mismo proveedor a los que puede apuntar una nota de
// crédito/débito. Elegir de acá evita tipear folio y tipo a mano, y de paso
// deja bien el código SII del documento referido, que depende de si era
// electrónico.
const referenciaOptions = computed(() =>
  comprasReferenciables.value
    .filter(
      (p) =>
        p.supplierId === draft.supplierId &&
        p._id !== editingId.value &&
        (p.tipoDocumento === 'factura' || p.tipoDocumento === 'factura_compra')
    )
    .map((p) => ({
      label: `${tipoDocumentoLabel[p.tipoDocumento]} ${p.folio} — $${p.montoTotal.toLocaleString('es-CL')}`,
      value: p._id
    }))
)

// Misma fórmula que computeMontoTotal en purchases.service.ts: todo el IVA
// que se pagó suma, y el retenido resta porque no se le paga al proveedor.
const montoTotalPreview = computed(() => {
  const base = draft.montoNeto + draft.montoExento

  if (draft.tratamientoIva === 'retenido') return base
  return base + draft.montoIva
})

function openCreate(): void {
  editingId.value = null
  Object.assign(draft, emptyDraft())
  dialogVisible.value = true
  // El catálogo de referenciables se pide al abrir el diálogo, no al entrar a
  // la pantalla: la mayoría de las visitas solo mira la lista.
  void cargarReferenciables()
}

// El tratamiento no se guarda como tal: se deduce de cuál de los campos de
// IVA trae la compra, que es la forma en que lo entiende el SII.
function tratamientoDe(purchase: Purchase): TratamientoIva {
  if (purchase.ivaRetenidoTotal) return 'retenido'
  if (purchase.ivaUsoComun) return 'uso_comun'
  if (purchase.ivaNoRecuperable) return 'sin_credito'
  return 'credito'
}

function montoIvaDe(purchase: Purchase): number {
  return purchase.montoIva || purchase.ivaUsoComun || purchase.ivaNoRecuperable?.monto || 0
}

function openEdit(purchase: Purchase): void {
  editingId.value = purchase._id
  Object.assign(draft, {
    supplierId: purchase.supplierId,
    tipoDocumento: purchase.tipoDocumento,
    electronico: purchase.electronico !== false,
    folio: purchase.folio,
    fecha: new Date(purchase.fecha),
    fechaVencimiento: purchase.fechaVencimiento ? new Date(purchase.fechaVencimiento) : null,
    glosa: purchase.glosa ?? '',
    montoNeto: purchase.montoNeto,
    montoIva: montoIvaDe(purchase),
    montoExento: purchase.montoExento,
    tratamientoIva: tratamientoDe(purchase),
    motivoSinCredito: purchase.ivaNoRecuperable?.codigo ?? 4,
    referenciaId:
      comprasReferenciables.value.find(
        (p) =>
          p.supplierId === purchase.supplierId &&
          p.folio === purchase.referencia?.folio &&
          p.tipoDocumento === purchase.referencia?.tipoDocumento
      )?._id ?? null
  })
  dialogVisible.value = true
  void cargarReferenciables()
}

async function handleSave(): Promise<void> {
  saving.value = true
  try {
    // El monto de IVA del formulario se reparte al campo que le corresponde
    // según el tratamiento. Los que no aplican van en 0 o en null —nunca
    // omitidos—: al editar se manda un patch, y una clave ausente deja el
    // valor anterior, así que cambiar de tratamiento arrastraría el campo
    // viejo y el documento quedaría declarando dos IVA distintos.
    const retenido = draft.tratamientoIva === 'retenido'
    const referida = comprasReferenciables.value.find((p) => p._id === draft.referenciaId)

    const payload: PurchaseWrite = {
      supplierId: draft.supplierId,
      tipoDocumento: draft.tipoDocumento,
      electronico: draft.electronico,
      folio: draft.folio,
      fecha: draft.fecha.toISOString(),
      fechaVencimiento: draft.fechaVencimiento ? draft.fechaVencimiento.toISOString() : undefined,
      glosa: draft.glosa || undefined,
      montoNeto: draft.montoNeto,
      montoExento: draft.montoExento,
      // Con retención el IVA sigue siendo recuperable: se retiene, no se
      // pierde (ver purchase.model.ts).
      montoIva: draft.tratamientoIva === 'credito' || retenido ? draft.montoIva : 0,
      ivaUsoComun: draft.tratamientoIva === 'uso_comun' ? draft.montoIva : 0,
      ivaNoRecuperable:
        draft.tratamientoIva === 'sin_credito'
          ? { codigo: draft.motivoSinCredito, monto: draft.montoIva }
          : null,
      ivaRetenidoTotal: retenido ? draft.montoIva : 0,
      referencia:
        requiereReferencia.value && referida
          ? {
              tipoDocumento: referida.tipoDocumento,
              folio: referida.folio,
              electronico: referida.electronico !== false
            }
          : null
    }

    // useResource está tipado sobre el documento guardado, que no admite
    // null; el cast es justamente por los campos que se borran.
    if (editingId.value) {
      await update(editingId.value, payload as Partial<Purchase>)
    } else {
      await create(payload as Partial<Purchase>)
    }
    dialogVisible.value = false
    // Lo recién guardado tiene que poder referenciarse desde una nota.
    invalidarReferenciables()
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
      <h1 class="page-title">Compras <AyudaPagina titulo="Compras" :secciones="AYUDA_COMPRAS" /></h1>
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

    <DataTable
      v-model:selection="selectedPurchases"
      :value="purchases"
      :loading="loading"
      data-key="_id"
      striped-rows
      lazy
      paginator
      :rows="porPagina"
      :total-records="totalCompras"
      :first="desdeCompras"
      current-page-report-template="{first}–{last} de {totalRecords}"
      paginator-template="FirstPageLink PrevPageLink CurrentPageReport NextPageLink LastPageLink"
      @page="irA($event.first)"
    >
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
            :severity="
              data.siiAcuse.codResp !== 0
                ? 'danger'
                : ACCIONES_DISPUTA.includes(data.siiAcuse.accion as PurchaseAccionSii)
                  ? 'warn'
                  : 'success'
            "
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
          <label class="field field-switch">
            <span>Electrónico</span>
            <ToggleSwitch v-model="draft.electronico" />
          </label>
        </div>
        <small class="field-hint">
          Un documento en papel se declara en el Libro de Compras con otro código que uno electrónico.
        </small>

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

        <label v-if="requiereReferencia" class="field">
          <span>Documento que corrige</span>
          <Select
            v-model="draft.referenciaId"
            :options="referenciaOptions"
            option-label="label"
            option-value="value"
            :placeholder="draft.supplierId ? 'Selecciona el documento' : 'Elige primero el proveedor'"
            :disabled="!draft.supplierId"
            show-clear
          />
        </label>

        <label class="field">
          <span>Glosa</span>
          <InputText v-model="draft.glosa" />
        </label>

        <div class="form-row">
          <label class="field">
            <span>Monto neto</span>
            <InputNumber v-model="draft.montoNeto" :min="0" @update:model-value="recalcularIva" />
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

        <label class="field">
          <span>Tratamiento del IVA</span>
          <Select
            v-model="draft.tratamientoIva"
            :options="tratamientosDisponibles"
            option-label="label"
            option-value="value"
          />
        </label>
        <small class="field-hint">{{ tratamientoHint }}</small>

        <label v-if="draft.tratamientoIva === 'sin_credito'" class="field">
          <span>Motivo</span>
          <Select
            v-model="draft.motivoSinCredito"
            :options="motivosSinCredito"
            option-label="label"
            option-value="value"
          />
        </label>

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

/* El switch no crece como los inputs: se queda del ancho de su etiqueta. */
.field-switch {
  flex: 0 0 auto;
  justify-content: space-between;
}

.field-hint {
  margin-top: -0.5rem;
  font-size: 0.78rem;
  font-weight: 400;
  color: var(--text-secondary);
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
