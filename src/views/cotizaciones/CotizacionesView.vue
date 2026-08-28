<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import Button from 'primevue/button'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import Select from 'primevue/select'
import Textarea from 'primevue/textarea'
import Tag from 'primevue/tag'
import DatePicker from 'primevue/datepicker'
import ToggleSwitch from 'primevue/toggleswitch'
import Checkbox from 'primevue/checkbox'
import Menu from 'primevue/menu'
import type { MenuItem } from 'primevue/menuitem'
import { useToast } from 'primevue/usetoast'
import { useConfirm } from 'primevue/useconfirm'
import AyudaPagina from '@/components/AyudaPagina.vue'
import { useListaPaginada } from '@/composables/useListaPaginada'
import { useResource } from '@/composables/useResource'
import { feathersClient } from '@/services/feathers'
import type {
  Cotizacion,
  CotizacionItem,
  Customer,
  Cuota,
  DteDocument,
  MetodoInteres,
  ModalidadFacturacionCuotas,
  PlanPago,
  PlanPagoPactado,
  Product,
  ValorUf
} from '@/types'
import { AYUDA_COTIZACIONES } from './ayuda-cotizaciones'

// Cotizaciones: propuestas comerciales que, aceptadas, se convierten en
// borradores de factura (ver server/src/services/cotizaciones/). Esta
// pantalla no emite nada: los borradores que crea se emiten en Documentos.

const toast = useToast()
const confirm = useConfirm()
const router = useRouter()

// ---- Lista ----
const filterNumero = ref('')
const filterCliente = ref('')
const filterEstado = ref<string | null>(null)
const filterFechas = ref<Date[] | null>(null)

const { items: cotizaciones, total, desde, porPagina, loading, cargar, irA, create, update, remove } =
  useListaPaginada<Cotizacion>('cotizaciones', {
    filtros: () => ({
      numero: filterNumero.value,
      cliente: filterCliente.value,
      estado: filterEstado.value,
      desde: filterFechas.value?.[0]?.toISOString(),
      hasta: filterFechas.value?.[1]?.toISOString()
    })
  })

function limpiarFiltros(): void {
  filterNumero.value = ''
  filterCliente.value = ''
  filterEstado.value = null
  filterFechas.value = null
}

const { items: customers, fetchAll: fetchCustomers } = useResource<Customer>('customers')
const { items: products, fetchAll: fetchProducts } = useResource<Product>('products')

const customerOptions = computed(() => customers.value.map((c) => ({ label: `${c.razonSocial} (${c.rut})`, value: c._id })))
const productOptions = computed(() => products.value.map((p) => ({ label: `${p.sku} — ${p.nombre}`, value: p._id })))

function customerOf(id: string | undefined): Customer | undefined {
  return customers.value.find((c) => c._id === id)
}

const ESTADO_LABELS: Record<string, string> = {
  borrador: 'Borrador',
  enviada: 'Enviada',
  vencida: 'Vencida',
  aceptada: 'Aceptada',
  rechazada: 'Rechazada',
  facturada: 'Facturada'
}
const estadoSeverity: Record<string, 'success' | 'info' | 'warn' | 'danger' | 'secondary'> = {
  borrador: 'secondary',
  enviada: 'info',
  vencida: 'warn',
  aceptada: 'success',
  rechazada: 'danger',
  facturada: 'success'
}
const ESTADO_FILTRO_OPTIONS = Object.entries(ESTADO_LABELS).map(([value, label]) => ({ value, label }))

const METODO_OPTIONS: { value: MetodoInteres; label: string }[] = [
  { value: 'sin_interes', label: 'Sin interés' },
  { value: 'simple', label: 'Interés simple' },
  { value: 'compuesto', label: 'Interés compuesto' },
  { value: 'cuota_fija', label: 'Cuota fija' }
]
const MODALIDAD_OPTIONS: { value: ModalidadFacturacionCuotas; label: string }[] = [
  { value: 'factura_por_cuota', label: 'Una factura por cuota' },
  { value: 'factura_total', label: 'Factura del total + cuotas de cobranza' }
]
const METODO_LABEL = Object.fromEntries(METODO_OPTIONS.map((o) => [o.value, o.label]))
const MODALIDAD_LABEL = Object.fromEntries(MODALIDAD_OPTIONS.map((o) => [o.value, o.label]))
const NOMBRE_TIPO_DTE: Record<number, string> = { 33: 'Factura', 34: 'Factura exenta', 56: 'Nota de débito' }
const ESTADO_DOC_LABEL: Record<string, string> = {
  draft: 'Borrador',
  pendiente_firma: 'Pendiente firma',
  firmado: 'Firmado',
  enviado: 'Enviado',
  aceptado: 'Aceptado SII',
  rechazado: 'Rechazado SII',
  reparo: 'Con reparo',
  anulado: 'Anulado'
}

function formatMoney(value: number): string {
  return Math.round(value).toLocaleString('es-CL')
}
function formatFecha(value: string | Date | undefined): string {
  if (!value) return ''
  return new Date(value).toLocaleDateString('es-CL')
}
function mensajeDe(e: unknown): string | undefined {
  return e instanceof Error ? e.message : undefined
}
function avisarError(summary: string, e: unknown): void {
  toast.add({ severity: 'error', summary, detail: mensajeDe(e), life: 5000 })
}

// ---- Formulario (crear / editar) ----
interface ItemDraft extends CotizacionItem {
  key: number
}
let itemKeySeq = 0
function blankItem(): ItemDraft {
  itemKeySeq += 1
  return { key: itemKeySeq, descripcion: '', cantidad: 1, precioUnit: 0, descuento: 0, exento: false, unidad: '' }
}

const dialogVisible = ref(false)
const editingId = ref<string | null>(null)
const saving = ref(false)
const draft = reactive({
  customerId: '',
  giroReceptor: '',
  titulo: '',
  validezDias: 15,
  descuentoGlobalPct: null as number | null,
  condiciones: '',
  notas: '',
  items: [blankItem()] as ItemDraft[]
})

const receptorGiros = computed(() => customerOf(draft.customerId)?.giros ?? [])

watch(
  () => draft.customerId,
  (id) => {
    if (editingId.value) return
    const c = customerOf(id)
    draft.giroReceptor = c?.giros?.[0] ?? c?.giro ?? ''
  }
)

function montoItem(item: CotizacionItem): number {
  return item.cantidad * item.precioUnit - (item.descuento ?? 0)
}

// Mismo cálculo que el servidor (services/cotizaciones/calculo.ts), solo
// para mostrar el total mientras se escribe: el que se guarda lo pone el
// servidor.
const totalesDraft = computed(() => {
  let neto = 0
  let exento = 0
  for (const item of draft.items) {
    if (item.exento) exento += montoItem(item)
    else neto += montoItem(item)
  }
  if (draft.descuentoGlobalPct) neto -= neto * (draft.descuentoGlobalPct / 100)
  neto = Math.round(neto)
  exento = Math.round(exento)
  const iva = Math.round(neto * 0.19)
  return { neto, exento, iva, total: neto + iva + exento }
})

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

// Igual que en Documentos: un producto en UF se convierte a pesos con la UF
// del día y se deja constancia en la descripción.
async function applyProduct(item: ItemDraft, productId: string | null): Promise<void> {
  item.productId = productId ?? undefined
  const product = productId ? products.value.find((p) => p._id === productId) : undefined
  if (!product) return
  item.exento = product.exento
  item.unidad = product.unidad
  if (product.moneda === 'UF') {
    try {
      const uf = await ensureValorUf()
      item.precioUnit = Math.round(product.precio * uf.valor)
      item.descripcion = `${product.nombre} (${formatUf(product.precio)} UF a $${formatUf(uf.valor)})`
    } catch (e) {
      avisarError('No se pudo obtener el valor de la UF', e)
      item.descripcion = product.nombre
      item.precioUnit = 0
    }
    return
  }
  item.descripcion = product.nombre
  item.precioUnit = product.precio
}

function addItem(): void {
  draft.items.push(blankItem())
}
function removeItem(key: number): void {
  draft.items = draft.items.filter((i) => i.key !== key)
}

function resetDraft(): void {
  draft.customerId = ''
  draft.giroReceptor = ''
  draft.titulo = ''
  draft.validezDias = 15
  draft.descuentoGlobalPct = null
  draft.condiciones = ''
  draft.notas = ''
  draft.items = [blankItem()]
}

function openCreate(): void {
  editingId.value = null
  resetDraft()
  dialogVisible.value = true
}

function cargarEnDraft(c: Cotizacion): void {
  draft.customerId = c.customerId
  draft.giroReceptor = c.giroReceptor ?? ''
  draft.titulo = c.titulo ?? ''
  draft.validezDias = c.validezDias
  draft.descuentoGlobalPct = c.descuentoGlobalPct ?? null
  draft.condiciones = c.condiciones ?? ''
  draft.notas = c.notas ?? ''
  draft.items = c.items.map((i) => ({ ...i, key: ++itemKeySeq, unidad: i.unidad ?? '' }))
}

function openEdit(c: Cotizacion): void {
  editingId.value = c._id
  cargarEnDraft(c)
  dialogVisible.value = true
}

// Duplicar: una cotización nueva con el mismo contenido (para insistir tras
// un rechazo, o repetir una propuesta a otro cliente).
function openDuplicate(c: Cotizacion): void {
  editingId.value = null
  cargarEnDraft(c)
  draft.validezDias = 15
  dialogVisible.value = true
}

function payloadDraft() {
  return {
    customerId: draft.customerId,
    giroReceptor: draft.giroReceptor || undefined,
    titulo: draft.titulo.trim() || undefined,
    validezDias: draft.validezDias,
    descuentoGlobalPct: draft.descuentoGlobalPct || undefined,
    condiciones: draft.condiciones.trim() || undefined,
    notas: draft.notas.trim() || undefined,
    items: draft.items.map(({ key: _key, ...item }) => ({
      ...item,
      productId: item.productId || undefined,
      unidad: item.unidad || undefined
    }))
  }
}

async function handleSave(): Promise<void> {
  if (!draft.customerId) {
    toast.add({ severity: 'warn', summary: 'Elija un cliente', life: 3000 })
    return
  }
  saving.value = true
  try {
    if (editingId.value) {
      const actual = cotizaciones.value.find((c) => c._id === editingId.value)
      const actualizada = await update(editingId.value, payloadDraft() as Partial<Cotizacion>)
      if (actual?.estado === 'enviada' && actualizada.version > actual.version) {
        toast.add({
          severity: 'info',
          summary: `Versión ${actualizada.version} guardada`,
          detail: 'La versión anterior quedó en el historial. Reenvíela al cliente para que reciba los cambios.',
          life: 6000
        })
      } else {
        toast.add({ severity: 'success', summary: 'Guardado', life: 2500 })
      }
    } else {
      const creada = await create(payloadDraft() as Partial<Cotizacion>)
      toast.add({ severity: 'success', summary: `${creada.numeroFormateado} creada`, life: 2500 })
    }
    dialogVisible.value = false
  } catch (e) {
    avisarError('Error al guardar', e)
  } finally {
    saving.value = false
  }
}

function confirmDelete(c: Cotizacion): void {
  confirm.require({
    message: `¿Eliminar la cotización ${c.numeroFormateado}?`,
    header: 'Confirmar',
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Eliminar',
    rejectLabel: 'Cancelar',
    acceptClass: 'p-button-danger',
    accept: async () => {
      try {
        await remove(c._id)
        toast.add({ severity: 'success', summary: 'Eliminada', life: 2500 })
      } catch (e) {
        avisarError('No se pudo eliminar', e)
      }
    }
  })
}

// ---- PDF ----
const pdfLoading = ref<string | null>(null)
async function verPdf(c: Cotizacion): Promise<void> {
  pdfLoading.value = c._id
  try {
    const result = (await feathersClient.service('cotizacion-pdf').create({ cotizacionId: c._id })) as { pdfBase64: string }
    const bytes = Uint8Array.from(atob(result.pdfBase64), (ch) => ch.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
    window.open(url, '_blank')
  } catch (e) {
    avisarError('No se pudo generar el PDF', e)
  } finally {
    pdfLoading.value = null
  }
}

// ---- Detalle ----
const detalle = ref<Cotizacion | null>(null)
const detalleVisible = ref(false)
// Documentos generados desde la cotización, cargados al abrir el detalle
// para mostrar folio y estado SII de cada uno.
const documentosDe = ref<Record<string, DteDocument>>({})

async function cargarDocumentos(c: Cotizacion): Promise<void> {
  const ids = [
    ...c.facturas.map((f) => f.documentId),
    ...(c.planPago?.cuotas.flatMap((q) => [q.documentId, q.notaDebitoId].filter(Boolean) as string[]) ?? [])
  ]
  if (ids.length === 0) {
    documentosDe.value = {}
    return
  }
  try {
    const result = (await feathersClient.service('documents').find({ query: { _id: { $in: ids }, $limit: 100 } })) as
      | { data: DteDocument[] }
      | DteDocument[]
    const docs = Array.isArray(result) ? result : result.data
    documentosDe.value = Object.fromEntries(docs.map((d) => [d._id, d]))
  } catch {
    documentosDe.value = {}
  }
}

async function openDetalle(c: Cotizacion): Promise<void> {
  detalle.value = c
  detalleVisible.value = true
  await cargarDocumentos(c)
}

// El detalle se queda con la última versión que llegue del servidor (los
// eventos en vivo refrescan la lista; acá se busca la misma cotización).
watch(cotizaciones, (lista) => {
  if (!detalle.value) return
  const actual = lista.find((c) => c._id === detalle.value?._id)
  if (actual) {
    detalle.value = actual
    void cargarDocumentos(actual)
  }
})

async function refrescarDetalle(id: string): Promise<void> {
  try {
    const actual = (await feathersClient.service('cotizaciones').get(id)) as Cotizacion
    detalle.value = actual
    await cargarDocumentos(actual)
    await cargar()
  } catch {
    // La lista se refresca sola por el evento en vivo.
  }
}

function docLabel(id: string | undefined): string {
  if (!id) return ''
  const d = documentosDe.value[id]
  if (!d) return 'Documento'
  const nombre = NOMBRE_TIPO_DTE[d.tipoDte] ?? `Tipo ${d.tipoDte}`
  return d.folio ? `${nombre} N° ${d.folio}` : `${nombre} (borrador)`
}
function docEstado(id: string | undefined): string {
  if (!id) return ''
  const d = documentosDe.value[id]
  return d ? ESTADO_DOC_LABEL[d.estado] ?? d.estado : ''
}
function docSaldo(id: string | undefined): string {
  const d = id ? documentosDe.value[id] : undefined
  if (!d || d.saldo === undefined) return ''
  return d.saldo > 0 ? `saldo $${formatMoney(d.saldo)}` : 'pagada'
}
function irADocumentos(): void {
  void router.push({ name: 'documents' })
}

const restante = computed(() => (detalle.value ? detalle.value.montos.total - detalle.value.montoFacturado : 0))
const pendienteReenvio = computed(() => {
  const c = detalle.value
  if (!c || c.estado !== 'enviada') return false
  const ultimo = c.envios[c.envios.length - 1]
  return !ultimo || ultimo.version < c.version
})

// ---- Enviar por correo ----
const enviarVisible = ref(false)
const enviando = ref(false)
const envio = reactive({ email: '', mensaje: '' })

function openEnviar(c: Cotizacion): void {
  detalle.value = c
  envio.email = customerOf(c.customerId)?.email ?? ''
  envio.mensaje = ''
  enviarVisible.value = true
}

async function handleEnviar(): Promise<void> {
  if (!detalle.value) return
  enviando.value = true
  try {
    const r = (await feathersClient.service('enviar-cotizacion').create({
      cotizacionId: detalle.value._id,
      email: envio.email.trim() || undefined,
      mensaje: envio.mensaje.trim() || undefined
    })) as { destinatario: string }
    toast.add({ severity: 'success', summary: `Enviada a ${r.destinatario}`, life: 3500 })
    enviarVisible.value = false
    await refrescarDetalle(detalle.value._id)
  } catch (e) {
    avisarError('No se pudo enviar', e)
  } finally {
    enviando.value = false
  }
}

// ---- Aceptar (con o sin plan de pago) / rechazar / reabrir ----
const aceptarVisible = ref(false)
const decidiendo = ref(false)
const conPlan = ref(false)
const plan = reactive<{
  numeroCuotas: number
  pie: number | null
  primerVencimiento: Date
  periodicidad: 'mensual' | 'dias'
  cadaDias: number
  metodo: MetodoInteres
  tasaInteresPct: number
  modalidad: ModalidadFacturacionCuotas
}>({
  numeroCuotas: 3,
  pie: null,
  primerVencimiento: new Date(),
  periodicidad: 'mensual',
  cadaDias: 30,
  metodo: 'sin_interes',
  tasaInteresPct: 0,
  modalidad: 'factura_por_cuota'
})
const planPreview = ref<PlanPago | null>(null)
const planPreviewError = ref<string | null>(null)
// Si se abre sobre una cotización ya aceptada, solo se está definiendo o
// cambiando el plan.
const soloPlan = ref(false)

function planPactado(): PlanPagoPactado {
  return {
    numeroCuotas: plan.numeroCuotas,
    pie: plan.pie || undefined,
    primerVencimiento: plan.primerVencimiento.toISOString(),
    periodicidad: plan.periodicidad,
    cadaDias: plan.periodicidad === 'dias' ? plan.cadaDias : undefined,
    metodo: plan.metodo,
    tasaInteresPct: plan.metodo === 'sin_interes' ? 0 : plan.tasaInteresPct,
    modalidad: plan.modalidad
  }
}

function openAceptar(c: Cotizacion, definirPlan = false): void {
  detalle.value = c
  soloPlan.value = definirPlan
  conPlan.value = definirPlan || !!c.planPago
  const enUnMes = new Date()
  enUnMes.setMonth(enUnMes.getMonth() + 1)
  const existente = c.planPago
  plan.numeroCuotas = existente?.numeroCuotas ?? 3
  plan.pie = existente?.pie ?? null
  plan.primerVencimiento = existente ? new Date(existente.primerVencimiento) : enUnMes
  plan.periodicidad = existente?.periodicidad ?? 'mensual'
  plan.cadaDias = existente?.cadaDias ?? 30
  plan.metodo = existente?.metodo ?? 'sin_interes'
  plan.tasaInteresPct = existente?.tasaInteresPct ?? 0
  plan.modalidad = existente?.modalidad ?? 'factura_por_cuota'
  planPreview.value = null
  planPreviewError.value = null
  aceptarVisible.value = true
  if (conPlan.value) void previsualizarPlan()
}

// La vista previa la calcula el SERVIDOR (soloCalcular): es exactamente lo
// que va a guardar, sin repetir la matemática acá.
let previewTimer: ReturnType<typeof setTimeout> | undefined
async function previsualizarPlan(): Promise<void> {
  if (!detalle.value || !conPlan.value) return
  try {
    const r = (await feathersClient.service('decidir-cotizacion').create({
      cotizacionId: detalle.value._id,
      decision: 'aceptada',
      planPago: planPactado(),
      soloCalcular: true
    })) as { planPago: PlanPago }
    planPreview.value = r.planPago
    planPreviewError.value = null
  } catch (e) {
    planPreview.value = null
    planPreviewError.value = mensajeDe(e) ?? 'Plan inválido'
  }
}
watch(
  () => [conPlan.value, { ...plan }],
  () => {
    clearTimeout(previewTimer)
    previewTimer = setTimeout(() => void previsualizarPlan(), 300)
  },
  { deep: true }
)

async function handleAceptar(): Promise<void> {
  if (!detalle.value) return
  decidiendo.value = true
  try {
    await feathersClient.service('decidir-cotizacion').create({
      cotizacionId: detalle.value._id,
      decision: 'aceptada',
      planPago: conPlan.value ? planPactado() : soloPlan.value ? null : undefined
    })
    toast.add({ severity: 'success', summary: soloPlan.value ? 'Plan de pago guardado' : 'Cotización aceptada', life: 3000 })
    aceptarVisible.value = false
    await refrescarDetalle(detalle.value._id)
  } catch (e) {
    avisarError('No se pudo guardar', e)
  } finally {
    decidiendo.value = false
  }
}

function confirmRechazar(c: Cotizacion): void {
  confirm.require({
    message: `¿Marcar ${c.numeroFormateado} como rechazada por el cliente?`,
    header: 'Rechazar cotización',
    icon: 'pi pi-times-circle',
    acceptLabel: 'Rechazar',
    rejectLabel: 'Cancelar',
    acceptClass: 'p-button-danger',
    accept: async () => {
      try {
        await feathersClient.service('decidir-cotizacion').create({ cotizacionId: c._id, decision: 'rechazada' })
        toast.add({ severity: 'info', summary: 'Rechazada', life: 2500 })
        if (detalle.value?._id === c._id) await refrescarDetalle(c._id)
      } catch (e) {
        avisarError('No se pudo rechazar', e)
      }
    }
  })
}

async function reabrir(c: Cotizacion): Promise<void> {
  try {
    await feathersClient.service('decidir-cotizacion').create({ cotizacionId: c._id, decision: 'reabrir' })
    toast.add({ severity: 'info', summary: 'Reabierta', life: 2500 })
    await refrescarDetalle(c._id)
  } catch (e) {
    avisarError('No se pudo reabrir', e)
  }
}

// ---- Facturar ----
const facturando = ref(false)
const facturarItemsVisible = ref(false)
const facturarMontoVisible = ref(false)
const itemsSeleccionados = ref<number[]>([])
const facturaMonto = reactive({ monto: 0, glosa: '' })

const itemsFacturados = computed(() => new Set(detalle.value?.facturas.flatMap((f) => f.itemIndices ?? []) ?? []))

async function facturar(data: Record<string, unknown>): Promise<void> {
  if (!detalle.value) return
  facturando.value = true
  try {
    const r = (await feathersClient.service('facturar-cotizacion').create({ cotizacionId: detalle.value._id, ...data })) as {
      documentos: { documentId: string; tipoDte: number; total: number }[]
    }
    const n = r.documentos.length
    toast.add({
      severity: 'success',
      summary: n === 1 ? 'Borrador creado' : `${n} borradores creados`,
      detail: 'Revíselo y emítalo desde Documentos.',
      life: 5000
    })
    facturarItemsVisible.value = false
    facturarMontoVisible.value = false
    await refrescarDetalle(detalle.value._id)
  } catch (e) {
    avisarError('No se pudo facturar', e)
  } finally {
    facturando.value = false
  }
}

function openFacturarItems(): void {
  itemsSeleccionados.value = []
  facturarItemsVisible.value = true
}
function openFacturarMonto(): void {
  facturaMonto.monto = restante.value
  facturaMonto.glosa = ''
  facturarMontoVisible.value = true
}

const facturarMenu = ref()
const facturarMenuItems = computed<MenuItem[]>(() => {
  const c = detalle.value
  const porCuota = c?.planPago?.modalidad === 'factura_por_cuota'
  return [
    { label: 'Total', icon: 'pi pi-file', disabled: porCuota || (c?.montoFacturado ?? 0) > 0, command: () => void facturar({ modo: 'total' }) },
    { label: 'Por ítems…', icon: 'pi pi-list', disabled: porCuota || !!c?.descuentoGlobalPct, command: openFacturarItems },
    { label: 'Por monto (anticipo/saldo)…', icon: 'pi pi-percentage', disabled: porCuota, command: openFacturarMonto },
    {
      label: 'Pie del plan',
      icon: 'pi pi-wallet',
      visible: !!c?.planPago?.pie,
      disabled: c?.facturas.some((f) => f.origen === 'pie'),
      command: () => void facturar({ modo: 'pie' })
    }
  ]
})

// ---- Cuotas ----
const pagarVisible = ref(false)
const pagando = ref(false)
const cuotaAPagar = ref<Cuota | null>(null)
const pagoCuota = reactive({ monto: 0, fecha: new Date(), medio: '', nota: '' })

function openPagar(cuota: Cuota): void {
  cuotaAPagar.value = cuota
  pagoCuota.monto = cuota.monto - cuota.montoPagado
  pagoCuota.fecha = new Date()
  pagoCuota.medio = ''
  pagoCuota.nota = ''
  pagarVisible.value = true
}

async function handlePagar(): Promise<void> {
  if (!detalle.value || !cuotaAPagar.value) return
  pagando.value = true
  try {
    await feathersClient.service('pagar-cuota').create({
      cotizacionId: detalle.value._id,
      cuotaNumero: cuotaAPagar.value.numero,
      monto: pagoCuota.monto,
      fecha: pagoCuota.fecha.toISOString(),
      medio: pagoCuota.medio.trim() || undefined,
      nota: pagoCuota.nota.trim() || undefined
    })
    toast.add({ severity: 'success', summary: 'Pago registrado', life: 2500 })
    pagarVisible.value = false
    await refrescarDetalle(detalle.value._id)
  } catch (e) {
    avisarError('No se pudo registrar el pago', e)
  } finally {
    pagando.value = false
  }
}

function cuotaVencida(cuota: Cuota): boolean {
  return cuota.estado === 'pendiente' && new Date(cuota.vencimiento) < new Date()
}
function cuotaSeverity(cuota: Cuota): 'success' | 'warn' | 'danger' | 'secondary' {
  if (cuota.estado === 'pagada') return 'success'
  if (cuotaVencida(cuota)) return 'danger'
  if (cuota.montoPagado > 0) return 'warn'
  return 'secondary'
}
function cuotaLabel(cuota: Cuota): string {
  if (cuota.estado === 'pagada') return 'Pagada'
  if (cuotaVencida(cuota)) return 'Vencida'
  if (cuota.montoPagado > 0) return 'Abonada'
  return 'Pendiente'
}

const resumenCuotas = computed(() => {
  const cuotas = detalle.value?.planPago?.cuotas ?? []
  return {
    pagadas: cuotas.filter((c) => c.estado === 'pagada').length,
    vencidas: cuotas.filter(cuotaVencida).length,
    enMora: cuotas.filter(cuotaVencida).reduce((s, c) => s + c.monto - c.montoPagado, 0),
    porCobrar: cuotas.reduce((s, c) => s + c.monto - c.montoPagado, 0)
  }
})

// ---- Menú por fila ----
const rowMenu = ref()
const rowMenuTarget = ref<Cotizacion | null>(null)
function openRowMenu(event: Event, c: Cotizacion): void {
  rowMenuTarget.value = c
  rowMenu.value?.toggle(event)
}
const rowMenuItems = computed<MenuItem[]>(() => {
  const c = rowMenuTarget.value
  if (!c) return []
  const editable = c.estado === 'borrador' || c.estado === 'enviada'
  const decidible = c.estado === 'borrador' || c.estado === 'enviada'
  return [
    { label: 'Ver detalle', icon: 'pi pi-eye', command: () => void openDetalle(c) },
    { label: 'Editar', icon: 'pi pi-pencil', visible: editable, command: () => openEdit(c) },
    { label: 'Enviar por correo', icon: 'pi pi-send', visible: c.estado !== 'rechazada' && c.estado !== 'facturada', command: () => openEnviar(c) },
    { label: 'PDF', icon: 'pi pi-file-pdf', command: () => void verPdf(c) },
    { separator: true },
    { label: 'Marcar aceptada…', icon: 'pi pi-check', visible: decidible, command: () => openAceptar(c) },
    { label: 'Marcar rechazada', icon: 'pi pi-times', visible: decidible, command: () => confirmRechazar(c) },
    { label: 'Reabrir', icon: 'pi pi-undo', visible: (c.estado === 'aceptada' || c.estado === 'rechazada') && c.facturas.length === 0, command: () => void reabrir(c) },
    { separator: true },
    { label: 'Duplicar', icon: 'pi pi-copy', command: () => openDuplicate(c) },
    { label: 'Eliminar', icon: 'pi pi-trash', visible: (c.estado === 'borrador' || c.estado === 'rechazada') && c.facturas.length === 0, command: () => confirmDelete(c) }
  ]
})

onMounted(async () => {
  await Promise.all([fetchCustomers(), fetchProducts()])
})
</script>

<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">Cotizaciones <AyudaPagina titulo="Cotizaciones" :secciones="AYUDA_COTIZACIONES" /></h1>
      <div class="header-actions">
        <Button label="Nueva cotización" icon="pi pi-plus" @click="openCreate" />
      </div>
    </div>

    <div class="filters surface-card">
      <label class="field">
        <span>Número</span>
        <InputText v-model="filterNumero" placeholder="COT-000015" />
      </label>
      <label class="field">
        <span>Cliente o RUT</span>
        <InputText v-model="filterCliente" placeholder="Nombre o RUT" />
      </label>
      <label class="field">
        <span>Estado</span>
        <Select v-model="filterEstado" :options="ESTADO_FILTRO_OPTIONS" option-label="label" option-value="value" placeholder="Todos" show-clear />
      </label>
      <label class="field field-grow">
        <span>Fecha de emisión</span>
        <DatePicker v-model="filterFechas" selection-mode="range" date-format="dd/mm/yy" placeholder="Rango de fechas" show-icon icon-display="input" />
      </label>
      <Button label="Limpiar filtros" text @click="limpiarFiltros" />
    </div>

    <DataTable
      :value="cotizaciones"
      :loading="loading"
      lazy
      paginator
      :rows="porPagina"
      :total-records="total"
      :first="desde"
      data-key="_id"
      striped-rows
      class="surface-card"
      @page="(e) => irA(e.first)"
      @row-click="(e) => openDetalle(e.data as Cotizacion)"
    >
      <template #empty>No hay cotizaciones{{ filterNumero || filterCliente || filterEstado || filterFechas ? ' con esos filtros' : '' }}.</template>
      <Column header="N°">
        <template #body="{ data }">
          <div class="stacked-cell">
            <strong>{{ data.numeroFormateado }}</strong>
            <span v-if="data.version > 1" class="muted">versión {{ data.version }}</span>
          </div>
        </template>
      </Column>
      <Column header="Fecha">
        <template #body="{ data }">
          <div class="stacked-cell">
            <span>{{ formatFecha(data.fechaEmision) }}</span>
            <span class="muted">vence {{ formatFecha(data.fechaVencimiento) }}</span>
          </div>
        </template>
      </Column>
      <Column header="Cliente">
        <template #body="{ data }">
          <div class="stacked-cell">
            <span>{{ customerOf(data.customerId)?.razonSocial ?? '—' }}</span>
            <span v-if="data.titulo" class="muted">{{ data.titulo }}</span>
          </div>
        </template>
      </Column>
      <Column header="Total" class="col-right">
        <template #body="{ data }">
          <div class="stacked-cell">
            <span>${{ formatMoney(data.montos.total) }}</span>
            <span v-if="data.montoFacturado > 0" class="muted">facturado ${{ formatMoney(data.montoFacturado) }}</span>
          </div>
        </template>
      </Column>
      <Column header="Cuotas">
        <template #body="{ data }">
          <span v-if="data.planPago" class="muted">
            {{ data.planPago.cuotas.filter((q: Cuota) => q.estado === 'pagada').length }}/{{ data.planPago.numeroCuotas }} pagadas
          </span>
        </template>
      </Column>
      <Column header="Estado">
        <template #body="{ data }">
          <Tag :severity="estadoSeverity[data.estadoVisible]" :value="ESTADO_LABELS[data.estadoVisible] ?? data.estadoVisible" />
        </template>
      </Column>
      <Column header="" style="width: 3rem">
        <template #body="{ data }">
          <Button icon="pi pi-ellipsis-v" text rounded severity="secondary" @click.stop="openRowMenu($event, data)" />
        </template>
      </Column>
    </DataTable>
    <Menu ref="rowMenu" :model="rowMenuItems" :popup="true" />

    <!-- ================= Formulario ================= -->
    <Dialog v-model:visible="dialogVisible" modal :header="editingId ? 'Editar cotización' : 'Nueva cotización'" style="width: min(1100px, 96vw)">
      <div class="form-grid">
        <label class="field field-grow">
          <span>Cliente</span>
          <Select v-model="draft.customerId" :options="customerOptions" option-label="label" option-value="value" placeholder="Seleccione" filter :disabled="!!editingId" fluid />
        </label>
        <label v-if="receptorGiros.length > 1" class="field">
          <span>Giro</span>
          <Select v-model="draft.giroReceptor" :options="receptorGiros" fluid />
        </label>
        <label class="field field-grow">
          <span>Título (opcional)</span>
          <InputText v-model="draft.titulo" placeholder="Ej: Desarrollo sitio web" fluid />
        </label>
        <label class="field">
          <span>Validez (días)</span>
          <InputNumber v-model="draft.validezDias" :min="1" fluid />
        </label>
      </div>

      <h3 class="section-title">Ítems</h3>
      <div class="items-table">
        <div class="item-row item-header">
          <span class="col-producto">Producto</span>
          <span class="col-descripcion">Descripción</span>
          <span class="col-num">Cantidad</span>
          <span class="col-unidad">Unidad</span>
          <span class="col-num">Precio unit.</span>
          <span class="col-num">Descuento</span>
          <span class="col-exento">Exento</span>
          <span class="col-total">Total</span>
          <span class="col-remove"></span>
        </div>
        <div v-for="item in draft.items" :key="item.key" class="item-row">
          <div class="col-producto">
            <Select :model-value="item.productId ?? null" :options="productOptions" option-label="label" option-value="value" placeholder="Libre" filter show-clear fluid @update:model-value="(v) => applyProduct(item, v as string | null)" />
          </div>
          <div class="col-descripcion">
            <Textarea v-model="item.descripcion" placeholder="Descripción" auto-resize rows="1" fluid class="descripcion-input" />
          </div>
          <div class="col-num"><InputNumber v-model="item.cantidad" :min="0" mode="decimal" :max-fraction-digits="2" fluid /></div>
          <div class="col-unidad"><InputText v-model="item.unidad" :maxlength="4" placeholder="Un" fluid /></div>
          <div class="col-num"><InputNumber v-model="item.precioUnit" :min="0" fluid /></div>
          <div class="col-num"><InputNumber v-model="item.descuento" :min="0" fluid /></div>
          <div class="col-exento"><ToggleSwitch v-model="item.exento" /></div>
          <div class="col-total">${{ formatMoney(montoItem(item)) }}</div>
          <div class="col-remove">
            <Button icon="pi pi-times" text severity="secondary" :disabled="draft.items.length === 1" title="Quitar ítem" @click="removeItem(item.key)" />
          </div>
        </div>
      </div>
      <Button label="Agregar ítem" icon="pi pi-plus" text size="small" @click="addItem" />
      <p v-if="valorUf" class="muted" style="margin-top: 0.5rem">
        <i class="pi pi-info-circle" /> UF de hoy: ${{ formatUf(valorUf.valor) }} — los productos en UF se convierten a pesos al agregarlos.
      </p>

      <div class="form-grid" style="margin-top: 1rem; align-items: flex-start">
        <div class="field-grow">
          <label class="field" style="max-width: 240px">
            <span>Descuento global ítems afectos (%)</span>
            <InputNumber v-model="draft.descuentoGlobalPct" :min="0" :max="100" suffix="%" fluid />
          </label>
          <label class="field" style="margin-top: 0.75rem">
            <span>Condiciones (van en el PDF)</span>
            <Textarea v-model="draft.condiciones" auto-resize rows="2" fluid placeholder="Forma de pago, plazos de entrega, garantías…" />
          </label>
          <label class="field" style="margin-top: 0.75rem">
            <span>Notas internas (no van en el PDF)</span>
            <Textarea v-model="draft.notas" auto-resize rows="2" fluid />
          </label>
        </div>
        <div class="totales surface-card">
          <div class="totales-fila"><span>Neto</span><span>${{ formatMoney(totalesDraft.neto) }}</span></div>
          <div class="totales-fila"><span>Exento</span><span>${{ formatMoney(totalesDraft.exento) }}</span></div>
          <div class="totales-fila"><span>IVA 19%</span><span>${{ formatMoney(totalesDraft.iva) }}</span></div>
          <div class="totales-fila totales-total"><span>Total</span><span>${{ formatMoney(totalesDraft.total) }}</span></div>
        </div>
      </div>

      <template #footer>
        <Button label="Cancelar" text @click="dialogVisible = false" />
        <Button :label="editingId ? 'Guardar' : 'Crear'" :loading="saving" @click="handleSave" />
      </template>
    </Dialog>

    <!-- ================= Detalle ================= -->
    <Dialog v-model:visible="detalleVisible" modal :header="detalle ? `${detalle.numeroFormateado} · versión ${detalle.version}` : ''" style="width: min(1000px, 96vw)">
      <div v-if="detalle" class="detalle">
        <div class="detalle-head">
          <div class="stacked-cell">
            <strong>{{ customerOf(detalle.customerId)?.razonSocial }}</strong>
            <span class="muted">{{ customerOf(detalle.customerId)?.rut }}<template v-if="detalle.titulo"> · {{ detalle.titulo }}</template></span>
            <span class="muted">Emitida {{ formatFecha(detalle.fechaEmision) }} · válida hasta {{ formatFecha(detalle.fechaVencimiento) }}</span>
          </div>
          <div class="detalle-estado">
            <Tag :severity="estadoSeverity[detalle.estadoVisible]" :value="ESTADO_LABELS[detalle.estadoVisible]" />
            <strong class="detalle-total">${{ formatMoney(detalle.montos.total) }}</strong>
          </div>
        </div>

        <p v-if="pendienteReenvio" class="aviso aviso-warn">
          <i class="pi pi-exclamation-triangle" /> Esta versión todavía no se le envió al cliente (recibió la versión
          {{ detalle.envios[detalle.envios.length - 1]?.version ?? '—' }}).
        </p>

        <div class="detalle-acciones">
          <Button label="PDF" icon="pi pi-file-pdf" outlined size="small" :loading="pdfLoading === detalle._id" @click="verPdf(detalle)" />
          <Button v-if="detalle.estado !== 'rechazada' && detalle.estado !== 'facturada'" label="Enviar por correo" icon="pi pi-send" outlined size="small" @click="openEnviar(detalle)" />
          <Button v-if="detalle.estado === 'borrador' || detalle.estado === 'enviada'" label="Editar" icon="pi pi-pencil" outlined size="small" @click="openEdit(detalle)" />
          <template v-if="detalle.estado === 'borrador' || detalle.estado === 'enviada'">
            <Button label="Aceptada" icon="pi pi-check" severity="success" size="small" @click="openAceptar(detalle)" />
            <Button label="Rechazada" icon="pi pi-times" severity="danger" outlined size="small" @click="confirmRechazar(detalle)" />
          </template>
          <template v-if="detalle.estado === 'aceptada' || detalle.estado === 'facturada'">
            <Button
              v-if="restante > 0 && detalle.planPago?.modalidad !== 'factura_por_cuota'"
              label="Facturar"
              icon="pi pi-file"
              size="small"
              :loading="facturando"
              @click="facturarMenu?.toggle($event)"
            />
            <Menu ref="facturarMenu" :model="facturarMenuItems" :popup="true" />
            <Button
              v-if="!detalle.planPago || !detalle.planPago.cuotas.some((q) => q.documentId || q.notaDebitoId || q.pagos.length)"
              :label="detalle.planPago ? 'Cambiar plan de pago' : 'Pactar cuotas'"
              icon="pi pi-calendar"
              outlined
              size="small"
              @click="openAceptar(detalle, true)"
            />
          </template>
          <Button v-if="(detalle.estado === 'aceptada' || detalle.estado === 'rechazada') && detalle.facturas.length === 0" label="Reabrir" icon="pi pi-undo" text size="small" @click="reabrir(detalle)" />
        </div>

        <h3 class="section-title">Ítems</h3>
        <table class="tabla">
          <thead>
            <tr><th>Descripción</th><th class="num">Cant.</th><th class="num">Precio</th><th class="num">Desc.</th><th class="num">Total</th></tr>
          </thead>
          <tbody>
            <tr v-for="(item, i) in detalle.items" :key="i" :class="{ 'fila-facturada': itemsFacturados.has(i) }">
              <td>{{ item.descripcion }}<span v-if="item.exento" class="muted"> (exento)</span><span v-if="itemsFacturados.has(i)" class="muted"> · facturado</span></td>
              <td class="num">{{ item.cantidad }} {{ item.unidad }}</td>
              <td class="num">${{ formatMoney(item.precioUnit) }}</td>
              <td class="num">{{ item.descuento ? `$${formatMoney(item.descuento)}` : '' }}</td>
              <td class="num">${{ formatMoney(montoItem(item)) }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr v-if="detalle.descuentoGlobalPct"><td colspan="4" class="num">Descuento global</td><td class="num">{{ detalle.descuentoGlobalPct }}%</td></tr>
            <tr><td colspan="4" class="num">Neto</td><td class="num">${{ formatMoney(detalle.montos.neto) }}</td></tr>
            <tr v-if="detalle.montos.exento"><td colspan="4" class="num">Exento</td><td class="num">${{ formatMoney(detalle.montos.exento) }}</td></tr>
            <tr><td colspan="4" class="num">IVA</td><td class="num">${{ formatMoney(detalle.montos.iva) }}</td></tr>
            <tr class="fila-total"><td colspan="4" class="num">Total</td><td class="num">${{ formatMoney(detalle.montos.total) }}</td></tr>
          </tfoot>
        </table>
        <p v-if="detalle.condiciones" class="muted" style="white-space: pre-line"><strong>Condiciones:</strong> {{ detalle.condiciones }}</p>
        <p v-if="detalle.notas" class="muted" style="white-space: pre-line"><strong>Notas internas:</strong> {{ detalle.notas }}</p>

        <!-- Plan de pago -->
        <template v-if="detalle.planPago">
          <h3 class="section-title">
            Plan de pago
            <span class="muted">
              · {{ METODO_LABEL[detalle.planPago.metodo] }}<template v-if="detalle.planPago.tasaInteresPct"> {{ detalle.planPago.tasaInteresPct }}% por período</template>
              · {{ MODALIDAD_LABEL[detalle.planPago.modalidad] }}<template v-if="detalle.planPago.pie"> · pie ${{ formatMoney(detalle.planPago.pie) }}</template>
            </span>
          </h3>
          <div class="resumen-cuotas">
            <span><strong>{{ resumenCuotas.pagadas }}</strong>/{{ detalle.planPago.numeroCuotas }} pagadas</span>
            <span>Por cobrar <strong>${{ formatMoney(resumenCuotas.porCobrar) }}</strong></span>
            <span v-if="resumenCuotas.vencidas" class="mora">{{ resumenCuotas.vencidas }} vencida(s): <strong>${{ formatMoney(resumenCuotas.enMora) }}</strong></span>
            <span>Interés total <strong>${{ formatMoney(detalle.planPago.totalInteres) }}</strong></span>
          </div>
          <table class="tabla">
            <thead>
              <tr><th>N°</th><th>Vence</th><th class="num">Capital</th><th class="num">Interés</th><th class="num">Cuota</th><th class="num">Pagado</th><th>Estado</th><th>Documento</th><th></th></tr>
            </thead>
            <tbody>
              <tr v-for="cuota in detalle.planPago.cuotas" :key="cuota.numero">
                <td>{{ cuota.numero }}</td>
                <td>{{ formatFecha(cuota.vencimiento) }}</td>
                <td class="num">${{ formatMoney(cuota.capital) }}</td>
                <td class="num">{{ cuota.interes ? `$${formatMoney(cuota.interes)}` : '—' }}</td>
                <td class="num"><strong>${{ formatMoney(cuota.monto) }}</strong></td>
                <td class="num">{{ cuota.montoPagado ? `$${formatMoney(cuota.montoPagado)}` : '' }}</td>
                <td><Tag :severity="cuotaSeverity(cuota)" :value="cuotaLabel(cuota)" /></td>
                <td>
                  <div class="stacked-cell">
                    <span v-if="cuota.documentId"><a class="link" @click="irADocumentos">{{ docLabel(cuota.documentId) }}</a> <span class="muted">{{ docEstado(cuota.documentId) }} {{ docSaldo(cuota.documentId) }}</span></span>
                    <span v-if="cuota.notaDebitoId"><a class="link" @click="irADocumentos">{{ docLabel(cuota.notaDebitoId) }}</a> <span class="muted">{{ docEstado(cuota.notaDebitoId) }}</span></span>
                  </div>
                </td>
                <td class="acciones-cuota">
                  <Button
                    v-if="detalle.planPago.modalidad === 'factura_por_cuota' && !cuota.documentId"
                    label="Facturar"
                    icon="pi pi-file"
                    text
                    size="small"
                    :loading="facturando"
                    @click="facturar({ modo: 'cuota', cuotaNumero: cuota.numero })"
                  />
                  <Button
                    v-if="detalle.planPago.modalidad === 'factura_total' && cuota.interes > 0 && !cuota.notaDebitoId"
                    label="ND interés"
                    icon="pi pi-file-plus"
                    text
                    size="small"
                    title="Nota de débito por el interés de esta cuota (requiere la factura del total emitida)"
                    :loading="facturando"
                    @click="facturar({ modo: 'interes', cuotaNumero: cuota.numero })"
                  />
                  <Button v-if="cuota.estado !== 'pagada'" label="Pagar" icon="pi pi-dollar" text size="small" @click="openPagar(cuota)" />
                </td>
              </tr>
            </tbody>
          </table>
        </template>

        <!-- Facturas generadas -->
        <template v-if="detalle.facturas.length > 0">
          <h3 class="section-title">
            Documentos generados
            <span class="muted">· facturado ${{ formatMoney(detalle.montoFacturado) }} de ${{ formatMoney(detalle.montos.total) }}<template v-if="restante > 0"> · restan ${{ formatMoney(restante) }}</template></span>
          </h3>
          <table class="tabla">
            <tbody>
              <tr v-for="f in detalle.facturas" :key="f.documentId">
                <td><a class="link" @click="irADocumentos">{{ docLabel(f.documentId) }}</a></td>
                <td class="muted">{{ f.glosa }}</td>
                <td class="muted">{{ docEstado(f.documentId) }} {{ docSaldo(f.documentId) }}</td>
                <td class="num">${{ formatMoney(f.monto) }}</td>
                <td class="muted">{{ formatFecha(f.creadoAt) }}</td>
              </tr>
            </tbody>
          </table>
        </template>

        <!-- Historial -->
        <template v-if="detalle.envios.length > 0 || detalle.versiones.length > 0 || detalle.decision">
          <h3 class="section-title">Historial</h3>
          <ul class="historial">
            <li v-for="v in detalle.versiones" :key="`v${v.version}`">
              <span class="muted">{{ formatFecha(v.reemplazadaAt) }}</span> Versión {{ v.version }} reemplazada (total ${{ formatMoney(v.montos.total) }}, {{ v.items.length }} ítems)
            </li>
            <li v-for="(e, i) in detalle.envios" :key="`e${i}`">
              <span class="muted">{{ formatFecha(e.enviadoAt) }}</span> Versión {{ e.version }} enviada a {{ e.destinatario }}
            </li>
            <li v-if="detalle.decision">
              <span class="muted">{{ formatFecha(detalle.decision.fecha) }}</span> {{ ESTADO_LABELS[detalle.estado === 'facturada' ? 'aceptada' : detalle.estado] }}<template v-if="detalle.decision.motivo"> — {{ detalle.decision.motivo }}</template>
            </li>
          </ul>
        </template>
      </div>
    </Dialog>

    <!-- ================= Enviar ================= -->
    <Dialog v-model:visible="enviarVisible" modal header="Enviar cotización por correo" style="width: min(560px, 94vw)">
      <div class="form-col">
        <label class="field">
          <span>Destinatario</span>
          <InputText v-model="envio.email" type="email" placeholder="correo@cliente.cl" fluid />
        </label>
        <label class="field">
          <span>Mensaje (opcional)</span>
          <Textarea v-model="envio.mensaje" auto-resize rows="3" fluid placeholder="Estimado cliente, adjunto la cotización solicitada…" />
        </label>
        <p class="muted">Se adjunta el PDF de la versión {{ detalle?.version }}. Sale desde la casilla de correo de la organización.</p>
      </div>
      <template #footer>
        <Button label="Cancelar" text @click="enviarVisible = false" />
        <Button label="Enviar" icon="pi pi-send" :loading="enviando" @click="handleEnviar" />
      </template>
    </Dialog>

    <!-- ================= Aceptar / plan de pago ================= -->
    <Dialog v-model:visible="aceptarVisible" modal :header="soloPlan ? 'Plan de pago' : 'Aceptar cotización'" style="width: min(900px, 96vw)">
      <div class="form-col">
        <label class="field-inline">
          <ToggleSwitch v-model="conPlan" />
          <span>Se pactó pago en cuotas</span>
        </label>

        <template v-if="conPlan">
          <div class="form-grid">
            <label class="field"><span>N° de cuotas</span><InputNumber v-model="plan.numeroCuotas" :min="1" :max="120" fluid /></label>
            <label class="field"><span>Pie (opcional)</span><InputNumber v-model="plan.pie" :min="0" prefix="$" fluid /></label>
            <label class="field"><span>Primer vencimiento</span><DatePicker v-model="plan.primerVencimiento" date-format="dd/mm/yy" show-icon icon-display="input" fluid /></label>
            <label class="field"><span>Periodicidad</span>
              <Select v-model="plan.periodicidad" :options="[{ value: 'mensual', label: 'Mensual' }, { value: 'dias', label: 'Cada N días' }]" option-label="label" option-value="value" fluid />
            </label>
            <label v-if="plan.periodicidad === 'dias'" class="field"><span>Cada (días)</span><InputNumber v-model="plan.cadaDias" :min="1" fluid /></label>
          </div>
          <div class="form-grid">
            <label class="field"><span>Interés</span><Select v-model="plan.metodo" :options="METODO_OPTIONS" option-label="label" option-value="value" fluid /></label>
            <label v-if="plan.metodo !== 'sin_interes'" class="field"><span>Tasa por período (%)</span><InputNumber v-model="plan.tasaInteresPct" :min="0" mode="decimal" :max-fraction-digits="3" suffix="%" fluid /></label>
            <label class="field field-grow"><span>Facturación</span><Select v-model="plan.modalidad" :options="MODALIDAD_OPTIONS" option-label="label" option-value="value" fluid /></label>
          </div>
          <p class="muted">
            <template v-if="plan.modalidad === 'factura_por_cuota'">Cada cuota se factura por separado cuando toca cobrarla, con su interés como línea afecta a IVA.</template>
            <template v-else>Se factura el total de una vez; cada pago de cuota queda como abono de esa factura y el interés se documenta con una nota de débito por cuota.</template>
          </p>

          <p v-if="planPreviewError" class="aviso aviso-danger">{{ planPreviewError }}</p>
          <table v-else-if="planPreview" class="tabla">
            <thead><tr><th>N°</th><th>Vence</th><th class="num">Capital</th><th class="num">Interés</th><th class="num">Cuota</th></tr></thead>
            <tbody>
              <tr v-for="c in planPreview.cuotas" :key="c.numero">
                <td>{{ c.numero }}</td><td>{{ formatFecha(c.vencimiento) }}</td>
                <td class="num">${{ formatMoney(c.capital) }}</td><td class="num">{{ c.interes ? `$${formatMoney(c.interes)}` : '—' }}</td><td class="num"><strong>${{ formatMoney(c.monto) }}</strong></td>
              </tr>
            </tbody>
            <tfoot>
              <tr class="fila-total"><td colspan="2">Total{{ planPreview.pie ? ` (más pie $${formatMoney(planPreview.pie)})` : '' }}</td><td class="num">${{ formatMoney(planPreview.totalCapital) }}</td><td class="num">${{ formatMoney(planPreview.totalInteres) }}</td><td class="num">${{ formatMoney(planPreview.totalPlan) }}</td></tr>
            </tfoot>
          </table>
        </template>
        <p v-else class="muted">Sin cuotas: se factura y se cobra contra factura, como siempre.</p>
      </div>
      <template #footer>
        <Button label="Cancelar" text @click="aceptarVisible = false" />
        <Button :label="soloPlan ? 'Guardar plan' : 'Aceptar cotización'" icon="pi pi-check" :loading="decidiendo" :disabled="conPlan && !!planPreviewError" @click="handleAceptar" />
      </template>
    </Dialog>

    <!-- ================= Facturar por ítems ================= -->
    <Dialog v-model:visible="facturarItemsVisible" modal header="Facturar por ítems" style="width: min(700px, 94vw)">
      <div v-if="detalle" class="form-col">
        <label v-for="(item, i) in detalle.items" :key="i" class="field-inline" :class="{ 'muted': itemsFacturados.has(i) }">
          <Checkbox v-model="itemsSeleccionados" :value="i" :disabled="itemsFacturados.has(i)" />
          <span>{{ item.descripcion }} — ${{ formatMoney(montoItem(item)) }}<template v-if="itemsFacturados.has(i)"> (ya facturado)</template></span>
        </label>
        <p class="muted">Si los ítems elegidos no caben en una hoja, se crean varios borradores.</p>
      </div>
      <template #footer>
        <Button label="Cancelar" text @click="facturarItemsVisible = false" />
        <Button label="Crear borrador" icon="pi pi-file" :loading="facturando" :disabled="itemsSeleccionados.length === 0" @click="facturar({ modo: 'items', itemIndices: itemsSeleccionados })" />
      </template>
    </Dialog>

    <!-- ================= Facturar por monto ================= -->
    <Dialog v-model:visible="facturarMontoVisible" modal header="Facturar por monto" style="width: min(520px, 94vw)">
      <div class="form-col">
        <label class="field"><span>Monto (con IVA) — restan ${{ formatMoney(restante) }}</span><InputNumber v-model="facturaMonto.monto" :min="1" :max="restante" prefix="$" fluid /></label>
        <label class="field"><span>Glosa</span><InputText v-model="facturaMonto.glosa" :placeholder="`A cuenta de cotización ${detalle?.numeroFormateado ?? ''}`" fluid /></label>
        <p class="muted">El monto se reparte entre afecto y exento en la misma proporción de la cotización. Por el redondeo neto/IVA, la factura puede diferir en $1.</p>
      </div>
      <template #footer>
        <Button label="Cancelar" text @click="facturarMontoVisible = false" />
        <Button label="Crear borrador" icon="pi pi-file" :loading="facturando" :disabled="!(facturaMonto.monto > 0)" @click="facturar({ modo: 'monto', monto: facturaMonto.monto, glosa: facturaMonto.glosa })" />
      </template>
    </Dialog>

    <!-- ================= Pagar cuota ================= -->
    <Dialog v-model:visible="pagarVisible" modal :header="cuotaAPagar ? `Pagar cuota ${cuotaAPagar.numero}` : ''" style="width: min(520px, 94vw)">
      <div v-if="cuotaAPagar" class="form-col">
        <p class="muted">Cuota de ${{ formatMoney(cuotaAPagar.monto) }} · vence {{ formatFecha(cuotaAPagar.vencimiento) }}<template v-if="cuotaAPagar.montoPagado"> · abonado ${{ formatMoney(cuotaAPagar.montoPagado) }}</template></p>
        <label class="field"><span>Monto</span><InputNumber v-model="pagoCuota.monto" :min="1" :max="cuotaAPagar.monto - cuotaAPagar.montoPagado" prefix="$" fluid /></label>
        <label class="field"><span>Fecha</span><DatePicker v-model="pagoCuota.fecha" date-format="dd/mm/yy" show-icon icon-display="input" fluid /></label>
        <label class="field"><span>Medio (opcional)</span><InputText v-model="pagoCuota.medio" placeholder="Transferencia, cheque…" fluid /></label>
        <label class="field"><span>Nota (opcional)</span><InputText v-model="pagoCuota.nota" fluid /></label>
        <p class="muted">
          <template v-if="detalle?.planPago?.modalidad === 'factura_por_cuota'">
            {{ cuotaAPagar.documentId ? 'Queda como abono en la factura de la cuota.' : 'La cuota aún no tiene factura: el pago queda registrado y pasará al borrador cuando se facture.' }}
          </template>
          <template v-else>La parte de capital queda como abono en la factura del total; el interés, en su nota de débito si existe.</template>
        </p>
      </div>
      <template #footer>
        <Button label="Cancelar" text @click="pagarVisible = false" />
        <Button label="Registrar pago" icon="pi pi-dollar" :loading="pagando" @click="handlePagar" />
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
.header-actions {
  display: flex;
  gap: 0.5rem;
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
.field-inline {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  font-size: 0.9rem;
}
.form-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  align-items: flex-end;
}
.form-col {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
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
.section-title {
  font-size: 0.95rem;
  margin: 1.25rem 0 0.5rem;
}
.col-right {
  text-align: right;
}

/* ---- Ítems del formulario ---- */
.items-table {
  border: 1px solid var(--card-border);
  border-radius: 10px;
  overflow: hidden;
  margin-bottom: 0.5rem;
}
/* Mismas columnas que Documentos: anchos fijos en rem para los números y
   `min-width: 0` en cada celda — sin eso, un nombre de producto largo
   estira su columna y aplasta la descripción a una letra por línea. */
.item-row {
  display: grid;
  grid-template-columns: 1.2fr 1.8fr 5rem 4rem 7rem 6rem 4rem 7rem 2.25rem;
  gap: 0.6rem;
  align-items: center;
  padding: 0.5rem 0.85rem;
  border-bottom: 1px solid #f1f4f8;
}
.item-row:last-child {
  border-bottom: none;
}
.item-row > * {
  min-width: 0;
  overflow: hidden;
}
.item-header {
  background: var(--page-bg);
  border-bottom: 1px solid var(--card-border);
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--text-secondary);
}
.descripcion-input {
  resize: none;
  line-height: 1.35;
  font-size: 0.9rem;
}
.col-total {
  text-align: right;
  font-weight: 600;
  font-size: 0.9rem;
}
.col-exento {
  display: flex;
  justify-content: center;
}
.totales {
  min-width: 260px;
  padding: 1rem 1.25rem;
  align-self: flex-end;
}
.totales-fila {
  display: flex;
  justify-content: space-between;
  padding: 0.2rem 0;
  font-size: 0.9rem;
}
.totales-total {
  border-top: 1px solid var(--card-border-strong);
  margin-top: 0.4rem;
  padding-top: 0.5rem;
  font-weight: 700;
  font-size: 1rem;
}

/* ---- Detalle ---- */
.detalle-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
}
.detalle-estado {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.3rem;
}
.detalle-total {
  font-size: 1.3rem;
}
.detalle-acciones {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 1rem 0;
}
.tabla {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}
.tabla th,
.tabla td {
  padding: 0.4rem 0.5rem;
  border-bottom: 1px solid var(--card-border);
  text-align: left;
  vertical-align: top;
}
.tabla th {
  font-size: 0.72rem;
  text-transform: uppercase;
  color: var(--text-secondary);
}
.tabla .num {
  text-align: right;
  white-space: nowrap;
}
.tabla tfoot td {
  border-bottom: none;
  padding: 0.25rem 0.5rem;
}
.fila-total td {
  font-weight: 700;
  border-top: 1px solid var(--card-border-strong);
}
.fila-facturada td {
  color: var(--text-tertiary);
}
.acciones-cuota {
  white-space: nowrap;
}
.resumen-cuotas {
  display: flex;
  flex-wrap: wrap;
  gap: 1.25rem;
  font-size: 0.85rem;
  color: var(--text-secondary);
  margin-bottom: 0.5rem;
}
.mora {
  color: var(--danger);
}
.historial {
  margin: 0;
  padding-left: 1.1rem;
  font-size: 0.85rem;
}
.historial li {
  margin-bottom: 0.25rem;
}
.link {
  color: var(--link-color);
  cursor: pointer;
}
.aviso {
  padding: 0.6rem 0.9rem;
  border-radius: var(--radius-md);
  font-size: 0.85rem;
}
.aviso-warn {
  background: var(--warning-soft);
  color: var(--warning);
}
.aviso-danger {
  background: var(--danger-soft);
  color: var(--danger);
}
</style>
