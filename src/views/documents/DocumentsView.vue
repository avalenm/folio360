<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import Select from 'primevue/select'
import DatePicker from 'primevue/datepicker'
import Menu from 'primevue/menu'
import ToggleSwitch from 'primevue/toggleswitch'
import Tag from 'primevue/tag'
import type { MenuItem } from 'primevue/menuitem'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { useResource } from '@/composables/useResource'
import { useAuthStore } from '@/stores/auth'
import { feathersClient } from '@/services/feathers'
import FacturaPreview from './FacturaPreview.vue'
import type { Customer, DteDocument, DteItem, DtePago, Product, Supplier, ValorUf } from '@/types'

const { items: documents, loading, fetchAll, create, update, remove } = useResource<DteDocument>('documents')
const { items: customers, fetchAll: fetchCustomers } = useResource<Customer>('customers')
const { items: suppliers, fetchAll: fetchSuppliers } = useResource<Supplier>('suppliers')
const { items: products, fetchAll: fetchProducts } = useResource<Product>('products')
const auth = useAuthStore()
const confirm = useConfirm()
const toast = useToast()

const ambientes = [
  { label: 'Certificación', value: 'certificacion' },
  { label: 'Producción', value: 'produccion' }
]

// Factura Electrónica (33), Factura No Afecta o Exenta (34), Guía de
// Despacho (52), Factura de Compra (46) y Notas de Crédito/Débito
// Electrónicas (61/56) están implementadas (firma/emisión, ver memoria
// "facturacion-sii-signing") — se deja como lista para que agregar otro
// tipo el día de mañana sea solo sumar una opción.
const tiposDte = [
  { label: 'Factura Electrónica (33)', value: 33 },
  { label: 'Factura No Afecta o Exenta Electrónica (34)', value: 34 },
  { label: 'Guía de Despacho Electrónica (52)', value: 52 },
  { label: 'Factura de Compra Electrónica (46)', value: 46 },
  { label: 'Nota de Crédito Electrónica (61)', value: 61 },
  { label: 'Nota de Débito Electrónica (56)', value: 56 }
]

const TIPOS_DTE_REQUIEREN_REFERENCIA = [56, 61]
const TIPOS_DTE_REQUIEREN_TRASLADO = [52]
// El <Receptor> del DTE lleva los datos del PROVEEDOR, no de un cliente —
// ver document.model.ts en el servidor.
const TIPOS_DTE_COMPRA = [46]
// "El documento no podrá exceder de 60 líneas de ítem Detalle" — límite del
// SII (Formato Documentos Tributarios Electrónicos §2.1), también validado
// server-side en documents.service.ts. Acá solo evita que el usuario llegue
// a chocar con ese rechazo.
const MAX_DETALLE_LINES = 60

function tipoDteLabel(tipoDte: number): string {
  return tiposDte.find((t) => t.value === tipoDte)?.label ?? `Tipo ${tipoDte}`
}

const CODIGOS_REFERENCIA = [
  { label: 'Anula documento', value: 1 },
  { label: 'Corrige texto', value: 2 },
  { label: 'Corrige montos', value: 3 }
]

// Una nota que solo corrige texto no puede llevar montos: el SII la observa
// con "Modifica Texto no debe tener montos" (ver documents.service.ts).
const COD_REF_CORRIGE_TEXTO = 2

// Los únicos traslados que constituyen venta; en el resto la guía no lleva
// precios (ver sii/dte-xml.ts en el servidor).
const INDICADORES_TRASLADO_VENTA = [1, 9]

const INDICADORES_TRASLADO = [
  { label: 'Operación constituye venta', value: 1 },
  { label: 'Ventas por efectuar', value: 2 },
  { label: 'Consignaciones', value: 3 },
  { label: 'Entrega gratuita', value: 4 },
  { label: 'Traslados internos', value: 5 },
  { label: 'Otros traslados no venta', value: 6 },
  { label: 'Guía de devolución', value: 7 },
  { label: 'Traslado para exportación (no venta)', value: 8 },
  { label: 'Venta para exportación', value: 9 }
]

const customerOptions = computed(() => customers.value.map((c) => ({ label: c.razonSocial, value: c._id })))
const supplierOptions = computed(() => suppliers.value.map((s) => ({ label: s.razonSocial, value: s._id })))
const productOptions = computed(() => products.value.map((p) => ({ label: `${p.nombre} (${p.sku})`, value: p._id })))

function customerOf(id: string | undefined): Customer | undefined {
  return id ? customers.value.find((c) => c._id === id) : undefined
}

function supplierOf(id: string | undefined): Supplier | undefined {
  return id ? suppliers.value.find((s) => s._id === id) : undefined
}

// Cliente para la mayoría de los documentos; proveedor para Factura de
// Compra (46) — usado en la tabla y en la vista previa para no repetir la
// misma rama en cada lugar que necesita "quién es el receptor de esto".
function receptorOf(document: DteDocument): Customer | Supplier | undefined {
  return TIPOS_DTE_COMPRA.includes(document.tipoDte) ? supplierOf(document.supplierId) : customerOf(document.customerId)
}

function saldoOf(document: DteDocument): number {
  return document.montos.total - document.montoPagado
}

// --- Filtros (client-side: el volumen de esta app no justifica paginación
// server-side todavía) ---
const filterFolio = ref('')
const filterCliente = ref('')
const filterFechas = ref<Date[] | null>(null)

const filteredDocuments = computed(() =>
  documents.value.filter((document) => {
    if (filterFolio.value && !String(document.folio ?? '').includes(filterFolio.value.trim())) {
      return false
    }

    if (filterCliente.value) {
      const receptor = receptorOf(document)
      const needle = filterCliente.value.trim().toLowerCase()
      const matches =
        receptor && (receptor.razonSocial.toLowerCase().includes(needle) || receptor.rut.toLowerCase().includes(needle))
      if (!matches) return false
    }

    const [from, to] = filterFechas.value ?? []
    if (from) {
      const docDate = new Date(document.fechaEmision ?? document.createdAt)
      if (docDate < from) return false
      if (to && docDate > new Date(to.getTime() + 86399999)) return false
    }

    return true
  })
)

function limpiarFiltros(): void {
  filterFolio.value = ''
  filterCliente.value = ''
  filterFechas.value = null
}

const selectedDocuments = ref<DteDocument[]>([])

function confirmDeleteSelected(): void {
  const drafts = selectedDocuments.value.filter((document) => document.estado === 'draft')
  const skipped = selectedDocuments.value.length - drafts.length

  if (drafts.length === 0) {
    toast.add({ severity: 'warn', summary: 'Nada que eliminar', detail: 'Solo se pueden eliminar borradores', life: 3000 })
    return
  }

  confirm.require({
    message: `¿Eliminar ${drafts.length} borrador(es) seleccionados?${skipped > 0 ? ` (${skipped} no son borradores y se omitirán)` : ''}`,
    header: 'Confirmar eliminación',
    icon: 'pi pi-exclamation-triangle',
    acceptProps: { severity: 'danger' },
    accept: async () => {
      try {
        await Promise.all(drafts.map((document) => remove(document._id)))
        selectedDocuments.value = []
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

interface ItemDraft extends DteItem {
  key: number
}

let itemKeySeq = 0

function montoItem(item: ItemDraft): number {
  if (sinMontos.value) return 0
  return Math.round(item.cantidad * item.precioUnit - (item.descuento ?? 0))
}

// `exento` se recibe por parámetro (no se lee `draft.tipoDte` acá adentro):
// esta función se usa dentro del propio inicializador de `draft`
// (`items: [blankItem()]`), donde `draft` todavía no termina de construirse
// — referenciarlo ahí revienta con "Cannot access 'draft' before
// initialization" (encontrado en vivo con Playwright, no era solo hipotético).
function blankItem(exento = false): ItemDraft {
  itemKeySeq += 1
  return { key: itemKeySeq, descripcion: '', cantidad: 1, precioUnit: 0, descuento: 0, exento }
}

// Valor de la UF del día (mindicador.cl vía el backend, ver external/uf.ts).
// Se pide una sola vez y se cachea: solo hace falta si se agrega un producto
// tarifado en UF.
const valorUf = ref<ValorUf | null>(null)

async function ensureValorUf(): Promise<ValorUf> {
  if (valorUf.value) return valorUf.value
  const result = (await feathersClient.service('uf-hoy').find()) as ValorUf
  valorUf.value = result
  return result
}

function formatUf(value: number): string {
  return value.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
}

// Elegir un producto del catálogo autocompleta descripción/precio/exención —
// la descripción sigue siendo editable después por si hay que ajustar la
// redacción para esa factura puntual. Volver a "Sin producto" no borra lo ya
// escrito, solo desvincula el productId.
//
// Si el producto está tarifado en UF, el DTE igual debe ir en pesos: se
// convierte con la UF del día y se deja constancia del valor en UF y del
// tipo de cambio aplicado en la propia descripción del ítem, porque el
// documento firmado no guarda ese dato en ningún otro lado.
async function applyProduct(item: ItemDraft, productId: string | null): Promise<void> {
  item.productId = productId ?? undefined

  const product = productId ? products.value.find((p) => p._id === productId) : undefined
  if (!product) return

  // Una Factura No Afecta o Exenta (34) fuerza todos sus ítems a exento,
  // sin importar cómo esté catalogado el producto — ver validación en
  // documents.service.ts.
  item.exento = draft.tipoDte === 34 ? true : product.exento

  if (product.moneda === 'UF') {
    try {
      const uf = await ensureValorUf()
      item.precioUnit = Math.round(product.precio * uf.valor)
      item.descripcion = `${product.nombre} (${formatUf(product.precio)} UF a $${formatUf(uf.valor)})`
    } catch (e) {
      toast.add({
        severity: 'error',
        summary: 'No se pudo obtener el valor de la UF',
        detail: e instanceof Error ? e.message : undefined,
        life: 5000
      })
      item.descripcion = product.nombre
      item.precioUnit = 0
    }
    return
  }

  item.descripcion = product.nombre
  item.precioUnit = product.precio
}

const draft = reactive({
  tipoDte: 33,
  ambiente: 'certificacion' as 'certificacion' | 'produccion',
  customerId: '',
  supplierId: '',
  giroReceptor: '',
  referenciaDocId: '',
  referenciaCodRef: 1,
  referenciaRazon: '',
  indTraslado: 1,
  descuentoGlobalPct: 0,
  items: [blankItem()] as ItemDraft[]
})

// Una Factura No Afecta o Exenta (34) solo puede tener ítems exentos (ver
// documents.service.ts) — se fuerza acá para que el usuario nunca llegue a
// chocar con ese rechazo del servidor; el switch "Exento" de cada ítem se
// deshabilita para este tipo en el template.
watch(
  () => draft.tipoDte,
  (tipoDte) => {
    if (tipoDte === 34) {
      draft.items.forEach((item) => {
        item.exento = true
      })
    }
  }
)

// Un cliente/proveedor puede tener varios giros registrados (ver
// customer.model.ts/supplier.model.ts), pero el DTE solo debe llevar el que
// corresponde a esta transacción puntual — nunca todos juntos. Si solo hay
// uno (o ninguno), no hace falta elegir: el backend usa el giro por
// defecto (ver dte-xml.ts).
const receptorGiros = computed(() =>
  (TIPOS_DTE_COMPRA.includes(draft.tipoDte) ? supplierOf(draft.supplierId) : customerOf(draft.customerId))?.giros ?? []
)

watch(
  () => draft.customerId,
  (customerId) => {
    if (editingId.value) return
    const customer = customerOf(customerId)
    draft.giroReceptor = customer?.giros?.[0] ?? customer?.giro ?? ''
    draft.referenciaDocId = ''
  }
)

watch(
  () => draft.supplierId,
  (supplierId) => {
    if (editingId.value) return
    const supplier = supplierOf(supplierId)
    draft.giroReceptor = supplier?.giros?.[0] ?? supplier?.giro ?? ''
  }
)

// Una nota de crédito/débito siempre corrige o anula un documento anterior
// del mismo cliente — el SII la rechaza sin al menos una <Referencia> a ese
// DTE (ver documents.service.ts). Solo se ofrecen documentos ya emitidos (con
// folio): un borrador no es un DTE válido para referenciar todavía.
const referenceableDocuments = computed(() =>
  documents.value
    .filter((d) => d.customerId === draft.customerId && d.folio != null && d._id !== editingId.value)
    .map((d) => ({
      label: `${tipoDteLabel(d.tipoDte)} · folio ${d.folio} · $${d.montos.total.toLocaleString('es-CL')}`,
      value: d._id
    }))
)

const referenciaDoc = computed(() => documents.value.find((d) => d._id === draft.referenciaDocId))

function copiarItemsReferencia(): void {
  const doc = referenciaDoc.value
  if (!doc) return
  draft.items = doc.items.map((item) => ({ ...item, key: (itemKeySeq += 1) }))
}

// Hay documentos que el SII exige que vayan enteros en cero, aunque el
// usuario haya escrito precios: una nota de crédito/débito que solo corrige
// texto (CodRef=2, "fe de erratas") y una guía de despacho que no constituye
// venta. El servidor los normaliza al guardar (ver documents.service.ts y
// montos.ts), así que la vista previa tiene que reflejar lo mismo — si no,
// muestra un total que el documento emitido no va a tener.
const sinMontos = computed(
  () =>
    (TIPOS_DTE_REQUIEREN_REFERENCIA.includes(draft.tipoDte) &&
      draft.referenciaCodRef === COD_REF_CORRIGE_TEXTO) ||
    (TIPOS_DTE_REQUIEREN_TRASLADO.includes(draft.tipoDte) &&
      !INDICADORES_TRASLADO_VENTA.includes(draft.indTraslado))
)

// Vista previa client-side de los montos — los reales los recalcula el
// servidor (montos.ts), esto es solo para que el usuario vea el total antes
// de guardar.
const montosPreview = computed(() => {
  if (sinMontos.value) {
    return { netoBruto: 0, descuentoGlobal: 0, neto: 0, exento: 0, iva: 0, total: 0 }
  }

  let netoBruto = 0
  let exento = 0

  for (const item of draft.items) {
    const monto = Math.round(item.cantidad * item.precioUnit - (item.descuento ?? 0))
    if (item.exento) exento += monto
    else netoBruto += monto
  }

  const descuentoGlobal = draft.descuentoGlobalPct ? Math.round(netoBruto * (draft.descuentoGlobalPct / 100)) : 0
  const neto = netoBruto - descuentoGlobal
  const iva = Math.round(neto * 0.19)
  return { netoBruto, descuentoGlobal, neto, exento, iva, total: neto + iva + exento }
})

function openCreate(): void {
  editingId.value = null
  draft.tipoDte = 33
  draft.ambiente = 'certificacion'
  draft.customerId = ''
  draft.supplierId = ''
  draft.giroReceptor = ''
  draft.referenciaDocId = ''
  draft.referenciaCodRef = 1
  draft.referenciaRazon = ''
  draft.indTraslado = 1
  draft.descuentoGlobalPct = 0
  draft.items = [blankItem()]
  dialogVisible.value = true
}

function openEdit(document: DteDocument): void {
  editingId.value = document._id
  draft.tipoDte = document.tipoDte
  draft.ambiente = document.ambiente
  draft.customerId = document.customerId ?? ''
  draft.supplierId = document.supplierId ?? ''
  draft.giroReceptor = document.giroReceptor ?? ''
  const referencia = document.referencias?.[0]
  draft.referenciaCodRef = referencia?.codRef ?? 1
  draft.referenciaRazon = referencia?.razon ?? ''
  draft.referenciaDocId = referencia
    ? (documents.value.find((d) => d.tipoDte === referencia.tipoDteRef && d.folio === referencia.folioRef)?._id ?? '')
    : ''
  draft.indTraslado = document.indTraslado ?? 1
  draft.descuentoGlobalPct = document.descuentoGlobalPct ?? 0
  draft.items = document.items.map((item) => ({ ...item, key: (itemKeySeq += 1) }))
  dialogVisible.value = true
}

function addItem(): void {
  draft.items.push(blankItem(draft.tipoDte === 34))
}

function removeItem(key: number): void {
  draft.items = draft.items.filter((item) => item.key !== key)
}

async function handleSave(): Promise<void> {
  if (!editingId.value && TIPOS_DTE_COMPRA.includes(draft.tipoDte) && !draft.supplierId) {
    toast.add({ severity: 'warn', summary: 'Falta el proveedor', life: 3000 })
    return
  }

  if (!editingId.value && !TIPOS_DTE_COMPRA.includes(draft.tipoDte) && !draft.customerId) {
    toast.add({ severity: 'warn', summary: 'Falta el cliente', life: 3000 })
    return
  }

  if (!editingId.value && TIPOS_DTE_REQUIEREN_REFERENCIA.includes(draft.tipoDte)) {
    if (!referenciaDoc.value) {
      toast.add({
        severity: 'warn',
        summary: 'Falta el documento de referencia',
        detail: 'Una nota de crédito/débito debe indicar qué documento corrige o anula',
        life: 4000
      })
      return
    }
    if (!draft.referenciaRazon.trim()) {
      toast.add({ severity: 'warn', summary: 'Falta la razón de la referencia', life: 3000 })
      return
    }
  }

  saving.value = true
  try {
    const items = draft.items.map(({ key: _key, ...item }) => item)
    if (editingId.value) {
      await update(editingId.value, { items })
    } else {
      const doc = referenciaDoc.value
      const referencias =
        TIPOS_DTE_REQUIEREN_REFERENCIA.includes(draft.tipoDte) && doc
          ? [
              {
                tipoDteRef: doc.tipoDte,
                folioRef: doc.folio as number,
                fechaRef: doc.fechaEmision ?? doc.createdAt,
                codRef: draft.referenciaCodRef,
                razon: draft.referenciaRazon.trim()
              }
            ]
          : []

      await create({
        tipoDte: draft.tipoDte,
        ambiente: draft.ambiente,
        customerId: TIPOS_DTE_COMPRA.includes(draft.tipoDte) ? undefined : draft.customerId,
        supplierId: TIPOS_DTE_COMPRA.includes(draft.tipoDte) ? draft.supplierId : undefined,
        giroReceptor: draft.giroReceptor || undefined,
        indTraslado: TIPOS_DTE_REQUIEREN_TRASLADO.includes(draft.tipoDte) ? draft.indTraslado : undefined,
        descuentoGlobalPct: draft.tipoDte !== 34 && draft.descuentoGlobalPct ? draft.descuentoGlobalPct : undefined,
        referencias,
        items
      })
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

const pagoVisible = ref(false)
const pagoDocument = ref<DteDocument | null>(null)
const pagoMonto = ref(0)
const pagoFecha = ref<Date>(new Date())
const pagoMedio = ref('')
const pagoNota = ref('')
const pagoSending = ref(false)

const MEDIOS_PAGO = ['Transferencia', 'Efectivo', 'Cheque', 'Tarjeta', 'Otro']

// El historial vive en `document.pagos`; los documentos creados antes de que
// existiera ese campo solo tienen `montoPagado`, por eso se muestra un aviso
// en vez de una lista vacía engañosa.
const pagosDelDocumento = computed(() => pagoDocument.value?.pagos ?? [])

const tienePagoSinDetalle = computed(
  () => !!pagoDocument.value && pagoDocument.value.montoPagado > 0 && pagosDelDocumento.value.length === 0
)

// Base del historial al que se le agregan/quitan abonos. Documentos creados
// antes de que existiera `pagos` solo tienen el agregado `montoPagado`: se
// representa como una entrada única para no perder ese monto cuando el
// servidor recalcule el total desde el arreglo.
function historialBase(document: DteDocument): DtePago[] {
  if (document.pagos && document.pagos.length > 0) return document.pagos
  if (document.montoPagado > 0) {
    return [
      {
        monto: document.montoPagado,
        fecha: document.updatedAt ?? document.createdAt,
        nota: 'Abono registrado sin detalle'
      }
    ]
  }
  return []
}

function openPago(document: DteDocument): void {
  pagoDocument.value = document
  pagoMonto.value = saldoOf(document)
  pagoFecha.value = new Date()
  pagoMedio.value = ''
  pagoNota.value = ''
  pagoVisible.value = true
}

async function confirmPago(): Promise<void> {
  const document = pagoDocument.value
  if (!document) return

  pagoSending.value = true
  try {
    // Se manda el arreglo completo (histórico + el nuevo abono): el servidor
    // recalcula `montoPagado` a partir de él, ver documents.service.ts.
    // Si el documento traía un `montoPagado` previo sin detalle (anterior a
    // que existiera `pagos`), se convierte en una entrada del historial —
    // si no, ese monto se perdería al recalcular desde un arreglo vacío.
    const pagos = [
      ...historialBase(document),
      {
        monto: pagoMonto.value,
        fecha: pagoFecha.value.toISOString(),
        medio: pagoMedio.value || undefined,
        nota: pagoNota.value.trim() || undefined
      }
    ]
    const updated = await update(document._id, { pagos })
    pagoDocument.value = updated
    toast.add({ severity: 'success', summary: 'Pago registrado', life: 2500 })

    if (saldoOf(updated) <= 0) {
      pagoVisible.value = false
    } else {
      pagoMonto.value = saldoOf(updated)
      pagoMedio.value = ''
      pagoNota.value = ''
    }
  } catch (e) {
    toast.add({
      severity: 'error',
      summary: 'Error al registrar pago',
      detail: e instanceof Error ? e.message : undefined,
      life: 4000
    })
  } finally {
    pagoSending.value = false
  }
}

async function eliminarPago(index: number): Promise<void> {
  const document = pagoDocument.value
  if (!document) return

  pagoSending.value = true
  try {
    const pagos = historialBase(document).filter((_, i) => i !== index)
    const updated = await update(document._id, { pagos })
    pagoDocument.value = updated
    pagoMonto.value = saldoOf(updated)
    toast.add({ severity: 'success', summary: 'Abono eliminado', life: 2500 })
  } catch (e) {
    toast.add({
      severity: 'error',
      summary: 'Error al eliminar el abono',
      detail: e instanceof Error ? e.message : undefined,
      life: 4000
    })
  } finally {
    pagoSending.value = false
  }
}

const previewVisible = ref(false)
const previewDocument = ref<DteDocument | null>(null)
const emitting = ref(false)

function openPreview(document: DteDocument): void {
  previewDocument.value = document
  previewVisible.value = true
}

function confirmEmit(): void {
  const document = previewDocument.value
  if (!document) return

  confirm.require({
    message:
      'Esto reserva un folio real del SII y firma el documento — no se puede deshacer. ¿Emitir y firmar esta factura?',
    header: 'Confirmar emisión',
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Emitir y firmar',
    acceptProps: { severity: 'danger' },
    accept: async () => {
      emitting.value = true
      try {
        await feathersClient.service('emit-document').create({ documentId: document._id })
        await fetchAll()
        previewVisible.value = false
        toast.add({ severity: 'success', summary: 'Documento emitido y firmado', life: 3000 })
      } catch (e) {
        toast.add({
          severity: 'error',
          summary: 'Error al emitir',
          detail: e instanceof Error ? e.message : undefined,
          life: 5000
        })
      } finally {
        emitting.value = false
      }
    }
  })
}

function confirmDelete(document: DteDocument): void {
  confirm.require({
    message: `¿Eliminar este borrador (tipo ${document.tipoDte})?`,
    header: 'Confirmar eliminación',
    icon: 'pi pi-exclamation-triangle',
    acceptProps: { severity: 'danger' },
    accept: async () => {
      try {
        await remove(document._id)
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

const sending = ref(false)
const sendingSet = ref(false)
const checking = ref(false)

// El "Set de Pruebas" formal de certificación del SII exige que todo el set
// vaya en UN SOLO sobre EnvioDTE (ver send-document-set.service.ts) — a
// diferencia del envío normal día a día (un documento por sobre). Esto es
// solo para ese caso: el envío normal sigue siendo "Enviar al SII" por fila.
function confirmSendSet(): void {
  const documents = selectedDocuments.value

  if (documents.length < 2) {
    toast.add({ severity: 'warn', summary: 'Selecciona al menos 2 documentos', life: 3000 })
    return
  }
  if (documents.some((d) => d.estado !== 'firmado')) {
    toast.add({
      severity: 'warn',
      summary: 'Todos los seleccionados deben estar firmados (y no enviados todavía)',
      life: 4000
    })
    return
  }

  confirm.require({
    message: `Esto sube los ${documents.length} documentos seleccionados al SII en UN SOLO sobre EnvioDTE — es una acción real, no se puede deshacer. ¿Enviar como set?`,
    header: 'Confirmar envío del set al SII',
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Enviar set',
    acceptProps: { severity: 'danger' },
    accept: async () => {
      sendingSet.value = true
      try {
        const result = await feathersClient
          .service('send-document-set')
          .create({ documentIds: documents.map((d) => d._id) })
        selectedDocuments.value = []
        await fetchAll()
        toast.add({
          severity: 'success',
          summary: 'Set enviado al SII',
          detail: `Identificador de envío: ${result.trackId}`,
          life: 6000
        })
      } catch (e) {
        toast.add({
          severity: 'error',
          summary: 'Error al enviar el set al SII',
          detail: e instanceof Error ? e.message : undefined,
          life: 5000
        })
      } finally {
        sendingSet.value = false
      }
    }
  })
}

function confirmSend(document: DteDocument): void {
  confirm.require({
    message:
      'Esto sube el documento firmado al SII (sobre EnvioDTE) — es una acción real, no se puede deshacer. ¿Enviar al SII?',
    header: 'Confirmar envío al SII',
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Enviar',
    acceptProps: { severity: 'danger' },
    accept: async () => {
      sending.value = true
      try {
        await feathersClient.service('send-document').create({ documentId: document._id })
        await fetchAll()
        toast.add({ severity: 'success', summary: 'Documento enviado al SII', life: 3000 })
      } catch (e) {
        toast.add({
          severity: 'error',
          summary: 'Error al enviar al SII',
          detail: e instanceof Error ? e.message : undefined,
          life: 5000
        })
      } finally {
        sending.value = false
      }
    }
  })
}

async function checkStatus(document: DteDocument): Promise<void> {
  checking.value = true
  try {
    const result = await feathersClient.service('check-send-status').create({ documentId: document._id })
    await fetchAll()
    toast.add({
      severity: 'info',
      summary: `Estado SII: ${result.envioSiiEstado}`,
      detail: result.envioSiiGlosa,
      life: 4000
    })
  } catch (e) {
    toast.add({
      severity: 'error',
      summary: 'Error al consultar estado',
      detail: e instanceof Error ? e.message : undefined,
      life: 4000
    })
  } finally {
    checking.value = false
  }
}

const downloadingPdf = ref(false)

// La representación impresa (con el Timbre Electrónico en PDF417) la genera
// el servidor — ver pdf/dte-pdf.ts. Llega en base64 dentro del JSON (mismo
// patrón que el resto de los servicios de acción) y acá solo se decodifica a
// un Blob para disparar la descarga; `window.document` explícito porque el
// parámetro de esta función ya se llama `document` (convención del archivo).
async function downloadPdf(document: DteDocument): Promise<void> {
  downloadingPdf.value = true
  try {
    const result = await feathersClient.service('document-pdf').create({ documentId: document._id })
    const bytes = Uint8Array.from(atob(result.pdfBase64), (c) => c.charCodeAt(0))
    const blob = new Blob([bytes], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    const link = window.document.createElement('a')
    link.href = url
    link.download = result.filename
    link.click()
    URL.revokeObjectURL(url)
  } catch (e) {
    toast.add({
      severity: 'error',
      summary: 'Error al generar el PDF',
      detail: e instanceof Error ? e.message : undefined,
      life: 4000
    })
  } finally {
    downloadingPdf.value = false
  }
}

// --- Menú de acciones por fila ---
const rowMenu = ref()
const menuDocument = ref<DteDocument | null>(null)

const rowMenuItems = computed<MenuItem[]>(() => {
  const document = menuDocument.value
  if (!document) return []

  const items: MenuItem[] = [{ label: 'Vista previa', icon: 'pi pi-eye', command: () => openPreview(document) }]

  if (document.estado !== 'draft') {
    items.push({ label: 'Descargar PDF', icon: 'pi pi-file-pdf', command: () => downloadPdf(document) })
  }

  if (document.estado === 'draft') {
    items.push({ label: 'Editar', icon: 'pi pi-pencil', command: () => openEdit(document) })
  }

  // Emitir/enviar/consultar estado ante el SII: contador+ solamente (el
  // servidor lo exige igual, ver hooks/require-role.ts) — vendedor puede
  // armar el borrador pero no dar el paso legalmente vinculante.
  if (document.estado === 'firmado' && auth.hasMinRole('contador')) {
    items.push({ label: 'Enviar al SII', icon: 'pi pi-send', command: () => confirmSend(document) })
  }

  if (document.trackId && auth.hasMinRole('contador')) {
    items.push({ label: 'Consultar estado SII', icon: 'pi pi-refresh', command: () => checkStatus(document) })
  }

  // También en documentos ya pagados: el diálogo es el historial de pagos, no
  // solo el formulario de abono — hay que poder consultarlo (y corregirlo)
  // después de saldado. Se oculta solo en borradores, que aún no se cobran.
  if (document.estado !== 'draft') {
    items.push({
      label: saldoOf(document) > 0 ? 'Registrar pago' : 'Ver pagos',
      icon: 'pi pi-dollar',
      command: () => openPago(document)
    })
  }

  if (document.estado === 'draft') {
    items.push({ label: 'Eliminar', icon: 'pi pi-trash', command: () => confirmDelete(document) })
  }

  return items
})

function toggleRowMenu(event: Event, document: DteDocument): void {
  menuDocument.value = document
  rowMenu.value?.toggle(event)
}

const estadoSeverity: Record<string, 'success' | 'info' | 'warn' | 'danger' | 'secondary'> = {
  draft: 'secondary',
  pendiente_firma: 'info',
  firmado: 'success',
  enviado: 'success',
  aceptado: 'success',
  rechazado: 'danger',
  reparo: 'warn',
  anulado: 'danger'
}

// Los estados venían del backend en snake_case y se mostraban crudos
// ("draft", "pendiente_firma") — se traducen para la UI sin tocar el valor
// almacenado.
const ESTADO_LABELS: Record<string, string> = {
  draft: 'Borrador',
  pendiente_firma: 'Pendiente firma',
  firmado: 'Firmado',
  enviado: 'Enviado',
  aceptado: 'Aceptado',
  rechazado: 'Rechazado',
  reparo: 'Con reparo',
  anulado: 'Anulado'
}

function estadoLabel(estado: string): string {
  return ESTADO_LABELS[estado] ?? estado
}

function formatMoney(value: number): string {
  return value.toLocaleString('es-CL')
}

onMounted(async () => {
  await Promise.all([fetchAll(), fetchCustomers(), fetchSuppliers(), fetchProducts()])
})
</script>

<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">Documentos</h1>
      <Button label="Nuevo documento" icon="pi pi-plus" @click="openCreate" />
    </div>

    <div class="filters surface-card">
      <label class="field">
        <span>Folio</span>
        <InputText v-model="filterFolio" placeholder="N° folio" />
      </label>
      <label class="field">
        <span>Cliente/proveedor o RUT</span>
        <InputText v-model="filterCliente" placeholder="Nombre o RUT" />
      </label>
      <label class="field field-grow">
        <span>Fecha de emisión</span>
        <DatePicker v-model="filterFechas" selection-mode="range" date-format="dd/mm/yy" placeholder="Rango de fechas" show-icon icon-display="input" />
      </label>
      <Button label="Limpiar filtros" text @click="limpiarFiltros" />
    </div>

    <div v-if="selectedDocuments.length > 0" class="bulk-bar surface-card">
      <span>{{ selectedDocuments.length }} seleccionado(s)</span>
      <Button
        label="Enviar como set"
        icon="pi pi-send"
        text
        :loading="sendingSet"
        title="Sube todos los seleccionados al SII en un solo sobre EnvioDTE — necesario para el Set de Pruebas formal de certificación"
        @click="confirmSendSet"
      />
      <Button label="Eliminar seleccionados" icon="pi pi-trash" severity="danger" text @click="confirmDeleteSelected" />
    </div>

    <DataTable
      v-model:selection="selectedDocuments"
      :value="filteredDocuments"
      :loading="loading"
      data-key="_id"
      striped-rows
    >
      <Column selection-mode="multiple" style="width: 3rem" />

      <Column header="Receptor">
        <template #body="{ data }">
          <div class="stacked-cell">
            <strong>{{ receptorOf(data)?.razonSocial ?? data.customerId ?? data.supplierId }}</strong>
            <span class="muted">{{ receptorOf(data)?.rut }}</span>
          </div>
        </template>
      </Column>

      <Column header="Folio / Tipo">
        <template #body="{ data }">
          <div class="stacked-cell">
            <strong>{{ data.folio ?? '—' }}</strong>
            <span class="muted">Tipo {{ data.tipoDte }}</span>
          </div>
        </template>
      </Column>

      <Column header="Emisión">
        <template #body="{ data }">
          {{ new Date(data.fechaEmision ?? data.createdAt).toLocaleDateString('es-CL') }}
        </template>
      </Column>

      <Column header="Monto">
        <template #body="{ data }">
          <div class="stacked-cell">
            <strong>${{ formatMoney(data.montos.total) }}</strong>
            <span class="muted">IVA ${{ formatMoney(data.montos.iva) }}</span>
          </div>
        </template>
      </Column>

      <Column header="Saldo">
        <template #body="{ data }">
          <span v-if="saldoOf(data) > 0" class="saldo-pendiente">${{ formatMoney(saldoOf(data)) }}</span>
          <span v-else class="saldo-pagado"><i class="pi pi-check-circle" /> Pagado</span>
        </template>
      </Column>

      <Column header="Estado">
        <template #body="{ data }">
          <Tag :severity="estadoSeverity[data.estado]" :value="estadoLabel(data.estado)" :title="data.envioSiiGlosa" />
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
      :header="editingId ? 'Editar borrador' : 'Nuevo documento'"
      class="doc-dialog"
      :style="{ width: 'min(1240px, 96vw)' }"
    >
      <form class="doc-form" @submit.prevent="handleSave">
        <section class="doc-section">
          <h3 class="section-title">Datos del documento</h3>
          <div class="form-row">
            <label class="field">
              <span>Tipo de documento</span>
              <Select
                v-model="draft.tipoDte"
                :options="tiposDte"
                option-label="label"
                option-value="value"
                :disabled="!!editingId"
              />
            </label>
            <label class="field">
              <span>Ambiente</span>
              <Select
                v-model="draft.ambiente"
                :options="ambientes"
                option-label="label"
                option-value="value"
                :disabled="!!editingId"
              />
            </label>
            <label v-if="!TIPOS_DTE_COMPRA.includes(draft.tipoDte)" class="field field-grow">
              <span>Cliente</span>
              <Select
                v-model="draft.customerId"
                :options="customerOptions"
                option-label="label"
                option-value="value"
                placeholder="Selecciona un cliente"
                filter
                :disabled="!!editingId"
              />
            </label>
            <label v-else class="field field-grow">
              <span>Proveedor</span>
              <Select
                v-model="draft.supplierId"
                :options="supplierOptions"
                option-label="label"
                option-value="value"
                placeholder="Selecciona un proveedor"
                filter
                :disabled="!!editingId"
              />
            </label>
          </div>

          <label v-if="(draft.customerId || draft.supplierId) && receptorGiros.length > 1" class="field">
            <span>Giro (para este documento)</span>
            <Select v-model="draft.giroReceptor" :options="receptorGiros" :disabled="!!editingId" />
          </label>
          <p v-else-if="(draft.customerId || draft.supplierId) && receptorGiros.length === 1" class="giro-hint">
            <i class="pi pi-info-circle" /> Giro: {{ receptorGiros[0] }}
          </p>

          <label v-if="TIPOS_DTE_REQUIEREN_TRASLADO.includes(draft.tipoDte)" class="field">
            <span>Tipo de traslado</span>
            <Select
              v-model="draft.indTraslado"
              :options="INDICADORES_TRASLADO"
              option-label="label"
              option-value="value"
              :disabled="!!editingId"
            />
          </label>
        </section>

        <section v-if="TIPOS_DTE_REQUIEREN_REFERENCIA.includes(draft.tipoDte)" class="doc-section">
          <h3 class="section-title">Documento que corrige o anula</h3>
          <div class="form-row">
            <label class="field field-grow">
              <span>Documento a referenciar</span>
              <Select
                v-model="draft.referenciaDocId"
                :options="referenceableDocuments"
                option-label="label"
                option-value="value"
                :placeholder="draft.customerId ? 'Selecciona el documento original' : 'Selecciona primero un cliente'"
                filter
                :disabled="!!editingId || !draft.customerId"
              />
            </label>
            <label class="field">
              <span>Motivo</span>
              <Select
                v-model="draft.referenciaCodRef"
                :options="CODIGOS_REFERENCIA"
                option-label="label"
                option-value="value"
                :disabled="!!editingId"
              />
            </label>
          </div>
          <label class="field field-grow">
            <span>Razón</span>
            <InputText
              v-model="draft.referenciaRazon"
              placeholder="Ej: Anula factura por error en monto"
              :disabled="!!editingId"
            />
          </label>
          <Button
            v-if="referenciaDoc"
            label="Copiar ítems del documento"
            icon="pi pi-copy"
            text
            size="small"
            type="button"
            :disabled="!!editingId"
            @click="copiarItemsReferencia"
          />
        </section>

        <section class="doc-section">
          <div class="section-header-row">
            <h3 class="section-title">Ítems</h3>
            <Button
              label="Agregar ítem"
              icon="pi pi-plus"
              text
              size="small"
              :disabled="draft.items.length >= MAX_DETALLE_LINES"
              @click="addItem"
            />
          </div>
          <p v-if="draft.items.length >= MAX_DETALLE_LINES" class="giro-hint">
            <i class="pi pi-info-circle" /> Máximo {{ MAX_DETALLE_LINES }} ítems por documento (límite del SII).
          </p>
          <p v-if="sinMontos" class="giro-hint">
            <i class="pi pi-info-circle" />
            <template v-if="TIPOS_DTE_REQUIEREN_TRASLADO.includes(draft.tipoDte)">
              Este traslado no constituye venta, así que la guía se emite sin precios: solo se detalla qué se
              traslada y en qué cantidad.
            </template>
            <template v-else>
              Una nota que solo corrige texto no puede llevar montos, así que se emite en $0. Si necesitas
              corregir valores, usa "Corrige montos" o "Anula documento".
            </template>
          </p>

          <div class="items-card">
            <div class="items-head">
              <span class="col-producto">Producto</span>
              <span class="col-descripcion">Descripción</span>
              <span class="col-num">Cantidad</span>
              <span class="col-num">Precio unit.</span>
              <span class="col-num">Descuento</span>
              <span class="col-exento">Exento</span>
              <span class="col-total">Total</span>
              <span class="col-remove"></span>
            </div>

            <div v-for="item in draft.items" :key="item.key" class="item-row">
              <div class="col-producto">
                <Select
                  :model-value="item.productId ?? null"
                  :options="productOptions"
                  option-label="label"
                  option-value="value"
                  placeholder="Libre"
                  filter
                  show-clear
                  fluid
                  @update:model-value="(value) => applyProduct(item, value as string | null)"
                />
              </div>
              <div class="col-descripcion">
                <InputText v-model="item.descripcion" placeholder="Descripción del ítem" fluid required />
              </div>
              <div class="col-num">
                <InputNumber v-model="item.cantidad" :min="0" fluid />
              </div>
              <div class="col-num">
                <InputNumber v-model="item.precioUnit" :min="0" mode="decimal" fluid :disabled="sinMontos" />
              </div>
              <div class="col-num">
                <InputNumber v-model="item.descuento" :min="0" mode="decimal" fluid :disabled="sinMontos" />
              </div>
              <div class="col-exento">
                <ToggleSwitch v-model="item.exento" :disabled="draft.tipoDte === 34" />
              </div>
              <div class="col-total">${{ montoItem(item).toLocaleString('es-CL') }}</div>
              <div class="col-remove">
                <Button
                  icon="pi pi-times"
                  text
                  severity="secondary"
                  :disabled="draft.items.length === 1"
                  title="Quitar ítem"
                  @click="removeItem(item.key)"
                />
              </div>
            </div>
          </div>

          <p v-if="valorUf" class="uf-note">
            <i class="pi pi-info-circle" /> UF de hoy: ${{ formatUf(valorUf.valor) }} — los productos tarifados en UF se
            convierten a pesos al agregarlos.
          </p>

          <label v-if="draft.tipoDte !== 34" class="field" style="max-width: 260px; margin-top: 0.75rem">
            <span>Descuento global ítems afectos (%)</span>
            <InputNumber
              v-model="draft.descuentoGlobalPct"
              :min="0"
              :max="100"
              suffix="%"
              fluid
              :disabled="!!editingId || sinMontos"
            />
          </label>
        </section>

        <div class="totals-preview">
          <div v-if="montosPreview.descuentoGlobal > 0" class="totals-row">
            <span>Subtotal afecto</span><span>${{ montosPreview.netoBruto.toLocaleString('es-CL') }}</span>
          </div>
          <div v-if="montosPreview.descuentoGlobal > 0" class="totals-row">
            <span>Dscto. global ({{ draft.descuentoGlobalPct }}%)</span>
            <span>-${{ montosPreview.descuentoGlobal.toLocaleString('es-CL') }}</span>
          </div>
          <div class="totals-row"><span>Neto</span><span>${{ montosPreview.neto.toLocaleString('es-CL') }}</span></div>
          <div v-if="montosPreview.exento > 0" class="totals-row">
            <span>Exento</span><span>${{ montosPreview.exento.toLocaleString('es-CL') }}</span>
          </div>
          <div class="totals-row"><span>IVA (19%)</span><span>${{ montosPreview.iva.toLocaleString('es-CL') }}</span></div>
          <div class="totals-row totals-total"><span>Total</span><span>${{ montosPreview.total.toLocaleString('es-CL') }}</span></div>
        </div>

        <div class="form-actions">
          <Button label="Cancelar" text @click="dialogVisible = false" />
          <Button type="submit" label="Guardar" :loading="saving" />
        </div>
      </form>
    </Dialog>

    <Dialog v-model:visible="pagoVisible" modal header="Pagos del documento" style="width: 560px">
      <div v-if="pagoDocument" class="pago-body">
        <div class="pago-resumen">
          <div class="pago-resumen-item">
            <span class="pago-resumen-label">Total documento</span>
            <span class="pago-resumen-value">${{ formatMoney(pagoDocument.montos.total) }}</span>
          </div>
          <div class="pago-resumen-item">
            <span class="pago-resumen-label">Abonado</span>
            <span class="pago-resumen-value pago-abonado">${{ formatMoney(pagoDocument.montoPagado) }}</span>
          </div>
          <div class="pago-resumen-item">
            <span class="pago-resumen-label">Saldo pendiente</span>
            <span class="pago-resumen-value pago-saldo">${{ formatMoney(saldoOf(pagoDocument)) }}</span>
          </div>
        </div>

        <section class="pago-section">
          <h3 class="section-title">Historial de pagos</h3>

          <p v-if="tienePagoSinDetalle" class="pago-empty">
            Este documento registra ${{ formatMoney(pagoDocument.montoPagado) }} abonados antes de que se
            guardara el detalle por pago, por eso no aparece desglosado.
          </p>
          <p v-else-if="pagosDelDocumento.length === 0" class="pago-empty">Todavía no hay abonos registrados.</p>

          <ul v-else class="pago-list">
            <li v-for="(pago, index) in pagosDelDocumento" :key="index" class="pago-item">
              <span class="pago-item-fecha">{{ new Date(pago.fecha).toLocaleDateString('es-CL') }}</span>
              <span class="pago-item-detalle">
                <span class="pago-item-medio">{{ pago.medio || '—' }}</span>
                <span v-if="pago.nota" class="pago-item-nota">{{ pago.nota }}</span>
              </span>
              <span class="pago-item-monto">${{ formatMoney(pago.monto) }}</span>
              <Button
                icon="pi pi-times"
                text
                severity="danger"
                :disabled="pagoSending"
                title="Eliminar abono"
                @click="eliminarPago(index)"
              />
            </li>
          </ul>
        </section>

        <section v-if="saldoOf(pagoDocument) > 0" class="pago-section">
          <h3 class="section-title">Registrar nuevo abono</h3>
          <div class="pago-form">
            <label class="field">
              <span>Monto</span>
              <InputNumber v-model="pagoMonto" :min="0" :max="saldoOf(pagoDocument)" mode="decimal" />
            </label>
            <label class="field">
              <span>Fecha</span>
              <DatePicker v-model="pagoFecha" date-format="dd/mm/yy" />
            </label>
            <label class="field">
              <span>Medio de pago</span>
              <Select
                v-model="pagoMedio"
                :options="MEDIOS_PAGO"
                placeholder="Opcional"
                show-clear
                style="min-width: 9rem"
              />
            </label>
            <label class="field pago-nota-field">
              <span>Nota</span>
              <InputText v-model="pagoNota" placeholder="N° de transferencia, banco, etc." />
            </label>
          </div>
        </section>

        <p v-else class="pago-liquidado">
          <i class="pi pi-check-circle" /> Documento pagado por completo.
        </p>
      </div>

      <template #footer>
        <Button label="Cerrar" text @click="pagoVisible = false" />
        <Button
          v-if="pagoDocument && saldoOf(pagoDocument) > 0"
          label="Registrar abono"
          icon="pi pi-plus"
          :loading="pagoSending"
          @click="confirmPago"
        />
      </template>
    </Dialog>

    <Dialog v-model:visible="previewVisible" modal header="Vista previa" style="width: 640px">
      <FacturaPreview
        v-if="previewDocument"
        :document="previewDocument"
        :customer="receptorOf(previewDocument)"
        :organization="auth.currentOrganization"
      />

      <template #footer>
        <Button label="Cerrar" text @click="previewVisible = false" />
        <Button
          v-if="previewDocument?.estado === 'draft' && auth.hasMinRole('contador')"
          label="Emitir y firmar"
          icon="pi pi-verified"
          severity="danger"
          :loading="emitting"
          @click="confirmEmit"
        />
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

/* ---------- Diálogo de pagos ---------- */
.pago-body {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.pago-resumen {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1rem;
  background: var(--page-bg);
  border-radius: var(--radius-md);
  padding: 0.9rem 1.1rem;
}

.pago-resumen-item {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.pago-resumen-label {
  font-size: var(--text-xs);
  color: var(--text-secondary);
}

.pago-resumen-value {
  font-size: var(--text-md);
  font-weight: 650;
  color: var(--text-primary);
}

.pago-abonado {
  color: var(--success);
}

.pago-saldo {
  color: var(--text-primary);
}

.pago-section {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.pago-section .section-title {
  margin: 0;
  padding-bottom: 0.6rem;
  border-bottom: 1px solid var(--card-border);
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-secondary);
}

.pago-empty {
  margin: 0;
  font-size: var(--text-base);
  color: var(--text-tertiary);
}

.pago-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.pago-item {
  display: grid;
  grid-template-columns: 6.5rem 1fr auto 2.25rem;
  align-items: center;
  gap: 0.75rem;
  padding: 0.45rem 0;
  border-bottom: 1px solid #f2f4f7;
  font-size: var(--text-base);
}

.pago-item:last-child {
  border-bottom: none;
}

.pago-item-fecha {
  color: var(--text-secondary);
}

.pago-item-detalle {
  display: flex;
  flex-direction: column;
  line-height: 1.3;
  min-width: 0;
}

.pago-item-medio {
  color: var(--text-secondary);
}

.pago-item-nota {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  overflow-wrap: anywhere;
}

.pago-nota-field {
  flex: 1;
  min-width: 12rem;
}

.pago-item-monto {
  font-weight: 600;
  text-align: right;
}

.pago-form {
  display: flex;
  gap: 0.75rem;
  align-items: flex-end;
  flex-wrap: wrap;
}

.pago-liquidado {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: var(--text-base);
  font-weight: 550;
  color: var(--success);
}

/* Un saldo pendiente es lo normal en una factura a crédito, no un error:
   se muestra en el color de texto principal (peso, no alarma). El rojo
   queda reservado para estados realmente problemáticos (rechazado). */
.saldo-pendiente {
  font-weight: 600;
  color: var(--text-primary);
}

.saldo-pagado {
  font-size: var(--text-sm);
  color: var(--success);
  font-weight: 550;
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
}

.form-grid {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.form-row {
  display: flex;
  gap: 0.75rem;
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

/* --- Formulario de documento (Nuevo/Editar), con secciones separadas --- */
.doc-form {
  display: flex;
  flex-direction: column;
  gap: 1.75rem;
}

.doc-section {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.section-title {
  margin: 0;
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-secondary);
}

.section-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 0.6rem;
  border-bottom: 1px solid var(--card-border);
}

.doc-section > .section-title {
  padding-bottom: 0.6rem;
  border-bottom: 1px solid var(--card-border);
}

.giro-hint {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.85rem;
  color: var(--text-secondary);
  background: var(--page-bg);
  border-radius: 8px;
  padding: 0.55rem 0.75rem;
}

.giro-hint .pi {
  color: #b0b9c6;
}

/* Grilla de ítems: mismo set de columnas para el encabezado y cada fila, así
   quedan alineadas incluso al agregar la columna Producto/Total. Se usa grid
   en vez de flex porque con 8 columnas de anchos mixtos flex requiere fijar
   cada ancho a mano en dos lugares (head + row) y se desalinean fácil. */
.items-card {
  border: 1px solid var(--card-border);
  border-radius: 10px;
  overflow: hidden;
}

.items-head,
.item-row {
  display: grid;
  grid-template-columns: 1.2fr 1.8fr 5rem 7rem 6rem 4rem 7rem 2.25rem;
  align-items: center;
  gap: 0.6rem;
}

.items-head {
  padding: 0.6rem 0.85rem;
  background: var(--page-bg);
  border-bottom: 1px solid var(--card-border);
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--text-secondary);
}

.item-row {
  padding: 0.5rem 0.85rem;
  border-bottom: 1px solid #f1f4f8;
  transition: background-color 0.12s ease;
}

.item-row:last-child {
  border-bottom: none;
}

.item-row:hover {
  background: #fafbfd;
}

.items-head > *,
.item-row > * {
  min-width: 0;
  overflow: hidden;
}

.col-exento {
  display: flex;
  justify-content: center;
}

.col-total {
  text-align: right;
  font-weight: 600;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.col-remove {
  display: flex;
  justify-content: center;
}

.uf-note {
  margin: -0.35rem 0 0;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.totals-preview {
  align-self: flex-end;
  min-width: 240px;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  background: var(--page-bg);
  border-radius: 10px;
  padding: 0.9rem 1.1rem;
}

.totals-row {
  display: flex;
  justify-content: space-between;
  font-size: 0.85rem;
  color: #475569;
}

.totals-total {
  border-top: 1px solid var(--card-border);
  margin-top: 0.3rem;
  padding-top: 0.5rem;
  font-weight: 700;
  color: #1e293b;
  font-size: 1rem;
}
</style>
