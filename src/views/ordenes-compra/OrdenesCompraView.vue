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
import Menu from 'primevue/menu'
import type { MenuItem } from 'primevue/menuitem'
import { useToast } from 'primevue/usetoast'
import { useConfirm } from 'primevue/useconfirm'
import AyudaPagina from '@/components/AyudaPagina.vue'
import { useListaPaginada } from '@/composables/useListaPaginada'
import { useResource } from '@/composables/useResource'
import { feathersClient } from '@/services/feathers'
import type { OrdenCompra, OrdenCompraItem, Paginated, Product, Purchase, Supplier, ValorUf } from '@/types'
import { AYUDA_ORDENES_COMPRA } from './ayuda-ordenes-compra'

// Órdenes de compra: el pedido formal a un proveedor, acompañado hasta que
// se convierte en una compra (ver server/src/services/ordenes-compra/). Esta
// pantalla no toca las compras directamente: "crear compra" llama al mismo
// servicio que la pantalla Compras, y el vínculo queda en la orden.

const toast = useToast()
const confirm = useConfirm()
const router = useRouter()

// ---- Lista ----
const filterNumero = ref('')
const filterProveedor = ref('')
const filterEstado = ref<string | null>(null)
const filterFechas = ref<Date[] | null>(null)

const { items: ordenes, total, desde, porPagina, loading, cargar, irA, create, update, remove } =
  useListaPaginada<OrdenCompra>('ordenes-compra', {
    filtros: () => ({
      numero: filterNumero.value,
      proveedor: filterProveedor.value,
      estado: filterEstado.value,
      desde: filterFechas.value?.[0]?.toISOString(),
      hasta: filterFechas.value?.[1]?.toISOString()
    })
  })

function limpiarFiltros(): void {
  filterNumero.value = ''
  filterProveedor.value = ''
  filterEstado.value = null
  filterFechas.value = null
}

const { items: suppliers, fetchAll: fetchSuppliers } = useResource<Supplier>('suppliers')
const { items: products, fetchAll: fetchProducts } = useResource<Product>('products')

const supplierOptions = computed(() => suppliers.value.map((s) => ({ label: `${s.razonSocial} (${s.rut})`, value: s._id })))
const productOptions = computed(() => products.value.map((p) => ({ label: `${p.sku} — ${p.nombre}`, value: p._id })))

function supplierOf(id: string | undefined): Supplier | undefined {
  return suppliers.value.find((s) => s._id === id)
}

const ESTADO_LABELS: Record<string, string> = {
  borrador: 'Borrador',
  enviada: 'Enviada',
  atrasada: 'Atrasada',
  recibida_parcial: 'Recibida parcial',
  recibida: 'Recibida',
  cerrada: 'Cerrada',
  anulada: 'Anulada'
}
const estadoSeverity: Record<string, 'success' | 'info' | 'warn' | 'danger' | 'secondary'> = {
  borrador: 'secondary',
  enviada: 'info',
  atrasada: 'danger',
  recibida_parcial: 'warn',
  recibida: 'success',
  cerrada: 'success',
  anulada: 'secondary'
}
const ESTADO_FILTRO_OPTIONS = Object.entries(ESTADO_LABELS).map(([value, label]) => ({ value, label }))
const TIPO_DOC_LABEL: Record<string, string> = {
  factura: 'Factura',
  boleta: 'Boleta',
  factura_compra: 'Factura de compra',
  nota_credito: 'Nota de crédito',
  nota_debito: 'Nota de débito'
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
function montoItem(item: Pick<OrdenCompraItem, 'cantidad' | 'precioUnit' | 'descuento'>): number {
  return item.cantidad * item.precioUnit - (item.descuento ?? 0)
}

// ---- Formulario (crear / editar) ----
interface ItemDraft extends Omit<OrdenCompraItem, 'cantidadRecibida'> {
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
  supplierId: '',
  titulo: '',
  fechaEntrega: null as Date | null,
  lugarEntrega: '',
  condicionesPago: '',
  descuentoGlobalPct: null as number | null,
  notas: '',
  items: [blankItem()] as ItemDraft[]
})

// Mismo cálculo que el servidor (services/ordenes-compra/calculo.ts), solo
// para mostrar el total mientras se escribe.
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

// Igual que en Documentos y Cotizaciones: un producto en UF se convierte a
// pesos con la UF del día. Acá el precio del catálogo es el de VENTA, así
// que es solo un punto de partida: el de compra se corrige a mano.
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
  draft.supplierId = ''
  draft.titulo = ''
  draft.fechaEntrega = null
  draft.lugarEntrega = ''
  draft.condicionesPago = ''
  draft.descuentoGlobalPct = null
  draft.notas = ''
  draft.items = [blankItem()]
}

function openCreate(): void {
  editingId.value = null
  resetDraft()
  dialogVisible.value = true
}

function cargarEnDraft(o: OrdenCompra): void {
  draft.supplierId = o.supplierId
  draft.titulo = o.titulo ?? ''
  draft.fechaEntrega = o.fechaEntrega ? new Date(o.fechaEntrega) : null
  draft.lugarEntrega = o.lugarEntrega ?? ''
  draft.condicionesPago = o.condicionesPago ?? ''
  draft.descuentoGlobalPct = o.descuentoGlobalPct ?? null
  draft.notas = o.notas ?? ''
  draft.items = o.items.map(({ cantidadRecibida: _r, ...i }) => ({ ...i, key: ++itemKeySeq, unidad: i.unidad ?? '' }))
}

function openEdit(o: OrdenCompra): void {
  editingId.value = o._id
  cargarEnDraft(o)
  dialogVisible.value = true
}

// Duplicar: una orden nueva con el mismo contenido (un pedido que se repite).
function openDuplicate(o: OrdenCompra): void {
  editingId.value = null
  cargarEnDraft(o)
  draft.fechaEntrega = null
  dialogVisible.value = true
}

function payloadDraft() {
  return {
    supplierId: draft.supplierId,
    titulo: draft.titulo.trim() || undefined,
    fechaEntrega: draft.fechaEntrega ? draft.fechaEntrega.toISOString() : null,
    lugarEntrega: draft.lugarEntrega.trim() || undefined,
    condicionesPago: draft.condicionesPago.trim() || undefined,
    descuentoGlobalPct: draft.descuentoGlobalPct || undefined,
    notas: draft.notas.trim() || undefined,
    items: draft.items.map(({ key: _key, ...item }) => ({
      ...item,
      productId: item.productId || undefined,
      unidad: item.unidad || undefined
    }))
  }
}

async function handleSave(): Promise<void> {
  if (!draft.supplierId) {
    toast.add({ severity: 'warn', summary: 'Elija un proveedor', life: 3000 })
    return
  }
  saving.value = true
  try {
    if (editingId.value) {
      const actual = ordenes.value.find((o) => o._id === editingId.value)
      const actualizada = await update(editingId.value, payloadDraft() as unknown as Partial<OrdenCompra>)
      if (actual?.estado === 'enviada' && actualizada.version > actual.version) {
        toast.add({
          severity: 'info',
          summary: `Versión ${actualizada.version} guardada`,
          detail: 'La versión anterior quedó en el historial. Reenvíela al proveedor para que reciba los cambios.',
          life: 6000
        })
      } else {
        toast.add({ severity: 'success', summary: 'Guardado', life: 2500 })
      }
    } else {
      const creada = await create(payloadDraft() as unknown as Partial<OrdenCompra>)
      toast.add({ severity: 'success', summary: `${creada.numeroFormateado} creada`, life: 2500 })
    }
    dialogVisible.value = false
  } catch (e) {
    avisarError('Error al guardar', e)
  } finally {
    saving.value = false
  }
}

function confirmDelete(o: OrdenCompra): void {
  confirm.require({
    message: `¿Eliminar la orden de compra ${o.numeroFormateado}?`,
    header: 'Confirmar',
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Eliminar',
    rejectLabel: 'Cancelar',
    acceptClass: 'p-button-danger',
    accept: async () => {
      try {
        await remove(o._id)
        toast.add({ severity: 'success', summary: 'Eliminada', life: 2500 })
      } catch (e) {
        avisarError('No se pudo eliminar', e)
      }
    }
  })
}

// ---- PDF ----
const pdfLoading = ref<string | null>(null)
async function verPdf(o: OrdenCompra): Promise<void> {
  pdfLoading.value = o._id
  try {
    const result = (await feathersClient.service('orden-compra-pdf').create({ ordenCompraId: o._id })) as { pdfBase64: string }
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
const detalle = ref<OrdenCompra | null>(null)
const detalleVisible = ref(false)
// Las compras vinculadas, cargadas al abrir el detalle para mostrar su
// estado de pago.
const comprasDe = ref<Record<string, Purchase>>({})

async function cargarCompras(o: OrdenCompra): Promise<void> {
  const ids = o.facturas.map((f) => f.purchaseId)
  if (ids.length === 0) {
    comprasDe.value = {}
    return
  }
  try {
    const result = (await feathersClient.service('purchases').find({ query: { _id: { $in: ids }, $limit: 100 } })) as
      | Paginated<Purchase>
      | Purchase[]
    const compras = Array.isArray(result) ? result : result.data
    comprasDe.value = Object.fromEntries(compras.map((c) => [c._id, c]))
  } catch {
    comprasDe.value = {}
  }
}

async function openDetalle(o: OrdenCompra): Promise<void> {
  detalle.value = o
  detalleVisible.value = true
  await cargarCompras(o)
}

watch(ordenes, (lista) => {
  if (!detalle.value) return
  const actual = lista.find((o) => o._id === detalle.value?._id)
  if (actual) {
    detalle.value = actual
    void cargarCompras(actual)
  }
})

async function refrescarDetalle(id: string): Promise<void> {
  try {
    const actual = (await feathersClient.service('ordenes-compra').get(id)) as OrdenCompra
    detalle.value = actual
    await cargarCompras(actual)
    await cargar()
  } catch {
    // La lista se refresca sola por el evento en vivo.
  }
}

function compraEstado(id: string): string {
  const c = comprasDe.value[id]
  if (!c) return ''
  const saldo = c.montoTotal - (c.montoPagado ?? (c.pagado ? c.montoTotal : 0))
  return saldo > 0 ? `por pagar $${formatMoney(saldo)}` : 'pagada'
}
function irACompras(): void {
  void router.push({ name: 'purchases' })
}

const enCurso = computed(() => {
  const e = detalle.value?.estado
  return e === 'borrador' || e === 'enviada' || e === 'recibida_parcial' || e === 'recibida'
})
const editable = computed(() => detalle.value?.estado === 'borrador' || detalle.value?.estado === 'enviada')
const recepcionable = computed(() => {
  const e = detalle.value?.estado
  return e === 'borrador' || e === 'enviada' || e === 'recibida_parcial'
})
const pendienteReenvio = computed(() => {
  const o = detalle.value
  if (!o || o.estado !== 'enviada') return false
  const ultimo = o.envios[o.envios.length - 1]
  return !ultimo || ultimo.version < o.version
})
const resumenRecepcion = computed(() => {
  const items = detalle.value?.items ?? []
  const pedido = items.reduce((s, i) => s + i.cantidad, 0)
  const recibido = items.reduce((s, i) => s + (i.cantidadRecibida ?? 0), 0)
  return { pedido, recibido, pendiente: pedido - recibido }
})

// ---- Enviar por correo ----
const enviarVisible = ref(false)
const enviando = ref(false)
const envio = reactive({ email: '', mensaje: '' })

function openEnviar(o: OrdenCompra): void {
  detalle.value = o
  envio.email = supplierOf(o.supplierId)?.email ?? ''
  envio.mensaje = ''
  enviarVisible.value = true
}

async function handleEnviar(): Promise<void> {
  if (!detalle.value) return
  enviando.value = true
  try {
    const r = (await feathersClient.service('enviar-orden-compra').create({
      ordenCompraId: detalle.value._id,
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

// ---- Recepcionar ----
const recepcionVisible = ref(false)
const recepcionando = ref(false)
const recepcion = reactive({
  fecha: new Date(),
  guiaFolio: '',
  nota: '',
  cantidades: [] as number[]
})

function openRecepcionar(o: OrdenCompra): void {
  detalle.value = o
  recepcion.fecha = new Date()
  recepcion.guiaFolio = ''
  recepcion.nota = ''
  // Por defecto se recibe todo lo pendiente: lo normal es que llegue
  // completo, y una entrega parcial se ajusta a mano.
  recepcion.cantidades = o.items.map((i) => Math.max(0, i.cantidad - (i.cantidadRecibida ?? 0)))
  recepcionVisible.value = true
}

function pendienteDe(item: OrdenCompraItem): number {
  return Math.max(0, item.cantidad - (item.cantidadRecibida ?? 0))
}

async function handleRecepcionar(): Promise<void> {
  if (!detalle.value) return
  recepcionando.value = true
  try {
    const r = (await feathersClient.service('recepcionar-orden-compra').create({
      ordenCompraId: detalle.value._id,
      fecha: recepcion.fecha.toISOString(),
      items: recepcion.cantidades.map((cantidad, indice) => ({ indice, cantidad })).filter((l) => l.cantidad > 0),
      guiaFolio: recepcion.guiaFolio.trim() || undefined,
      nota: recepcion.nota.trim() || undefined
    })) as { estado: string }
    toast.add({ severity: 'success', summary: r.estado === 'recibida' ? 'Recepción completa' : 'Recepción parcial registrada', life: 3000 })
    recepcionVisible.value = false
    await refrescarDetalle(detalle.value._id)
  } catch (e) {
    avisarError('No se pudo registrar la recepción', e)
  } finally {
    recepcionando.value = false
  }
}

// ---- Facturar: crear compra / vincular / desvincular ----
const facturando = ref(false)
const crearCompraVisible = ref(false)
const vincularVisible = ref(false)
const compraNueva = reactive({
  tipoDocumento: 'factura' as 'factura' | 'boleta' | 'factura_compra',
  folio: '',
  fecha: new Date(),
  fechaVencimiento: null as Date | null,
  electronico: true,
  monto: 0
})
const TIPO_DOC_OPTIONS = [
  { value: 'factura', label: 'Factura' },
  { value: 'boleta', label: 'Boleta' },
  { value: 'factura_compra', label: 'Factura de compra' }
]
const comprasCandidatas = ref<Purchase[]>([])
const compraElegida = ref<string | null>(null)
const vincularMonto = ref(0)

function openCrearCompra(): void {
  if (!detalle.value) return
  compraNueva.tipoDocumento = 'factura'
  compraNueva.folio = ''
  compraNueva.fecha = new Date()
  compraNueva.fechaVencimiento = null
  compraNueva.electronico = true
  compraNueva.monto = detalle.value.saldoPorFacturar
  crearCompraVisible.value = true
}

// Compras del mismo proveedor que todavía no están vinculadas a esta orden.
// El servidor vuelve a validar proveedor, ambiente y saldo disponible.
async function openVincular(): Promise<void> {
  if (!detalle.value) return
  compraElegida.value = null
  vincularMonto.value = detalle.value.saldoPorFacturar
  try {
    const result = (await feathersClient.service('purchases').find({
      query: { supplierId: detalle.value.supplierId, $limit: 100, $sort: { fecha: -1 } }
    })) as Paginated<Purchase> | Purchase[]
    const yaVinculadas = new Set(detalle.value.facturas.map((f) => f.purchaseId))
    comprasCandidatas.value = (Array.isArray(result) ? result : result.data).filter(
      (c) => !yaVinculadas.has(c._id) && c.tipoDocumento !== 'nota_credito' && c.tipoDocumento !== 'nota_debito'
    )
  } catch (e) {
    avisarError('No se pudieron cargar las compras del proveedor', e)
    comprasCandidatas.value = []
  }
  vincularVisible.value = true
}
const compraOptions = computed(() =>
  comprasCandidatas.value.map((c) => ({
    value: c._id,
    label: `${TIPO_DOC_LABEL[c.tipoDocumento] ?? c.tipoDocumento} ${c.folio} · ${formatFecha(c.fecha)} · $${formatMoney(c.montoTotal)}`
  }))
)
watch(compraElegida, (id) => {
  const c = comprasCandidatas.value.find((x) => x._id === id)
  if (c && detalle.value) vincularMonto.value = Math.min(c.montoTotal, detalle.value.saldoPorFacturar)
})

async function facturar(data: Record<string, unknown>, exito: string): Promise<void> {
  if (!detalle.value) return
  facturando.value = true
  try {
    const r = (await feathersClient.service('facturar-orden-compra').create({ ordenCompraId: detalle.value._id, ...data })) as {
      estado: string
    }
    toast.add({
      severity: 'success',
      summary: exito,
      detail: r.estado === 'cerrada' ? 'La orden quedó facturada al 100 % y se cerró.' : undefined,
      life: 4000
    })
    crearCompraVisible.value = false
    vincularVisible.value = false
    await refrescarDetalle(detalle.value._id)
  } catch (e) {
    avisarError('No se pudo registrar', e)
  } finally {
    facturando.value = false
  }
}

function handleCrearCompra(): void {
  void facturar(
    {
      modo: 'crear',
      tipoDocumento: compraNueva.tipoDocumento,
      folio: compraNueva.folio.trim(),
      fecha: compraNueva.fecha.toISOString(),
      fechaVencimiento: compraNueva.fechaVencimiento?.toISOString(),
      electronico: compraNueva.electronico,
      monto: compraNueva.monto
    },
    'Compra registrada'
  )
}
function handleVincular(): void {
  void facturar({ modo: 'vincular', purchaseId: compraElegida.value, monto: vincularMonto.value }, 'Compra vinculada')
}
function confirmDesvincular(purchaseId: string, folio: string): void {
  confirm.require({
    message: `¿Desvincular la factura ${folio} de esta orden? La compra no se elimina.`,
    header: 'Desvincular',
    icon: 'pi pi-link',
    acceptLabel: 'Desvincular',
    rejectLabel: 'Cancelar',
    accept: () => void facturar({ modo: 'desvincular', purchaseId }, 'Factura desvinculada')
  })
}

const facturarMenu = ref()
const facturarMenuItems = computed<MenuItem[]>(() => [
  { label: 'Crear compra…', icon: 'pi pi-plus', command: openCrearCompra },
  { label: 'Vincular compra existente…', icon: 'pi pi-link', command: () => void openVincular() }
])

// ---- Cerrar / anular / reabrir ----
const cerrarVisible = ref(false)
const cerrando = ref(false)
const cierre = reactive({ accion: 'cerrar' as 'cerrar' | 'anular', motivo: '' })

function openCerrar(o: OrdenCompra, accion: 'cerrar' | 'anular'): void {
  detalle.value = o
  cierre.accion = accion
  cierre.motivo = ''
  cerrarVisible.value = true
}

async function cerrarOrden(ordenCompraId: string, accion: 'cerrar' | 'anular' | 'reabrir', motivo?: string): Promise<void> {
  cerrando.value = true
  try {
    await feathersClient.service('cerrar-orden-compra').create({ ordenCompraId, accion, motivo })
    toast.add({ severity: 'info', summary: accion === 'cerrar' ? 'Cerrada' : accion === 'anular' ? 'Anulada' : 'Reabierta', life: 2500 })
    cerrarVisible.value = false
    if (detalle.value?._id === ordenCompraId) await refrescarDetalle(ordenCompraId)
  } catch (e) {
    avisarError('No se pudo cambiar el estado', e)
  } finally {
    cerrando.value = false
  }
}

// ---- Menú por fila ----
const rowMenu = ref()
const rowMenuTarget = ref<OrdenCompra | null>(null)
function openRowMenu(event: Event, o: OrdenCompra): void {
  rowMenuTarget.value = o
  rowMenu.value?.toggle(event)
}
const rowMenuItems = computed<MenuItem[]>(() => {
  const o = rowMenuTarget.value
  if (!o) return []
  const curso = o.estado !== 'cerrada' && o.estado !== 'anulada'
  const sinMovimientos = o.recepciones.length === 0 && o.facturas.length === 0
  return [
    { label: 'Ver detalle', icon: 'pi pi-eye', command: () => void openDetalle(o) },
    { label: 'Editar', icon: 'pi pi-pencil', visible: o.estado === 'borrador' || o.estado === 'enviada', command: () => openEdit(o) },
    { label: 'Enviar por correo', icon: 'pi pi-send', visible: curso, command: () => openEnviar(o) },
    { label: 'PDF', icon: 'pi pi-file-pdf', command: () => void verPdf(o) },
    { separator: true },
    { label: 'Recepcionar…', icon: 'pi pi-inbox', visible: curso && o.estado !== 'recibida', command: () => openRecepcionar(o) },
    { label: 'Cerrar…', icon: 'pi pi-lock', visible: curso, command: () => openCerrar(o, 'cerrar') },
    { label: 'Anular…', icon: 'pi pi-ban', visible: curso && sinMovimientos, command: () => openCerrar(o, 'anular') },
    { label: 'Reabrir', icon: 'pi pi-undo', visible: !curso, command: () => void cerrarOrden(o._id, 'reabrir') },
    { separator: true },
    { label: 'Duplicar', icon: 'pi pi-copy', command: () => openDuplicate(o) },
    { label: 'Eliminar', icon: 'pi pi-trash', visible: (o.estado === 'borrador' || o.estado === 'anulada') && sinMovimientos, command: () => confirmDelete(o) }
  ]
})

onMounted(async () => {
  await Promise.all([cargar(), fetchSuppliers(), fetchProducts()])
})
</script>

<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">Órdenes de compra <AyudaPagina titulo="Órdenes de compra" :secciones="AYUDA_ORDENES_COMPRA" /></h1>
      <div class="header-actions">
        <Button label="Nueva orden" icon="pi pi-plus" @click="openCreate" />
      </div>
    </div>

    <div class="filters surface-card">
      <label class="field">
        <span>Número</span>
        <InputText v-model="filterNumero" placeholder="OC-000015" />
      </label>
      <label class="field">
        <span>Proveedor o RUT</span>
        <InputText v-model="filterProveedor" placeholder="Nombre o RUT" />
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
      :value="ordenes"
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
      @row-click="(e) => openDetalle(e.data as OrdenCompra)"
    >
      <template #empty>No hay órdenes de compra{{ filterNumero || filterProveedor || filterEstado || filterFechas ? ' con esos filtros' : '' }}.</template>
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
            <span v-if="data.fechaEntrega" class="muted">entrega {{ formatFecha(data.fechaEntrega) }}</span>
          </div>
        </template>
      </Column>
      <Column header="Proveedor">
        <template #body="{ data }">
          <div class="stacked-cell">
            <span>{{ supplierOf(data.supplierId)?.razonSocial ?? '—' }}</span>
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
      <Column header="Recibido">
        <template #body="{ data }">
          <span class="muted">
            {{ data.items.reduce((s: number, i: OrdenCompraItem) => s + (i.cantidadRecibida ?? 0), 0) }}/{{ data.items.reduce((s: number, i: OrdenCompraItem) => s + i.cantidad, 0) }}
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
    <Dialog v-model:visible="dialogVisible" modal :header="editingId ? 'Editar orden de compra' : 'Nueva orden de compra'" style="width: min(1100px, 96vw)">
      <div class="form-grid">
        <label class="field field-grow">
          <span>Proveedor</span>
          <Select v-model="draft.supplierId" :options="supplierOptions" option-label="label" option-value="value" placeholder="Seleccione" filter fluid />
        </label>
        <label class="field field-grow">
          <span>Título (opcional)</span>
          <InputText v-model="draft.titulo" placeholder="Ej: Insumos de oficina agosto" fluid />
        </label>
        <label class="field">
          <span>Fecha de entrega</span>
          <DatePicker v-model="draft.fechaEntrega" date-format="dd/mm/yy" show-icon icon-display="input" placeholder="Opcional" fluid />
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
      <p class="muted" style="margin-top: 0.5rem">
        <i class="pi pi-info-circle" /> El producto del catálogo trae su precio de venta como punto de partida: corrija el precio de compra pactado.
      </p>

      <div class="form-grid" style="margin-top: 1rem; align-items: flex-start">
        <div class="field-grow">
          <label class="field" style="max-width: 240px">
            <span>Descuento global ítems afectos (%)</span>
            <InputNumber v-model="draft.descuentoGlobalPct" :min="0" :max="100" suffix="%" fluid />
          </label>
          <label class="field" style="margin-top: 0.75rem">
            <span>Lugar de entrega (va en el PDF)</span>
            <InputText v-model="draft.lugarEntrega" fluid placeholder="Dirección o bodega" />
          </label>
          <label class="field" style="margin-top: 0.75rem">
            <span>Condiciones de pago (van en el PDF)</span>
            <Textarea v-model="draft.condicionesPago" auto-resize rows="2" fluid placeholder="30 días desde la factura, contado, etc." />
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
            <strong>{{ supplierOf(detalle.supplierId)?.razonSocial }}</strong>
            <span class="muted">{{ supplierOf(detalle.supplierId)?.rut }}<template v-if="detalle.titulo"> · {{ detalle.titulo }}</template></span>
            <span class="muted">
              Emitida {{ formatFecha(detalle.fechaEmision) }}<template v-if="detalle.fechaEntrega"> · entrega {{ formatFecha(detalle.fechaEntrega) }}</template><template v-if="detalle.lugarEntrega"> · {{ detalle.lugarEntrega }}</template>
            </span>
          </div>
          <div class="detalle-estado">
            <Tag :severity="estadoSeverity[detalle.estadoVisible]" :value="ESTADO_LABELS[detalle.estadoVisible]" />
            <strong class="detalle-total">${{ formatMoney(detalle.montos.total) }}</strong>
          </div>
        </div>

        <p v-if="pendienteReenvio" class="aviso aviso-warn">
          <i class="pi pi-exclamation-triangle" /> Esta versión todavía no se le envió al proveedor (recibió la versión
          {{ detalle.envios[detalle.envios.length - 1]?.version ?? '—' }}).
        </p>
        <p v-if="detalle.cierre" class="aviso aviso-info">
          <i class="pi pi-lock" /> {{ ESTADO_LABELS[detalle.estado] }} el {{ formatFecha(detalle.cierre.fecha) }}<template v-if="detalle.cierre.motivo"> — {{ detalle.cierre.motivo }}</template>
        </p>

        <div class="detalle-acciones">
          <Button label="PDF" icon="pi pi-file-pdf" outlined size="small" :loading="pdfLoading === detalle._id" @click="verPdf(detalle)" />
          <Button v-if="enCurso" label="Enviar por correo" icon="pi pi-send" outlined size="small" @click="openEnviar(detalle)" />
          <Button v-if="editable" label="Editar" icon="pi pi-pencil" outlined size="small" @click="openEdit(detalle)" />
          <Button v-if="recepcionable" label="Recepcionar" icon="pi pi-inbox" severity="success" size="small" @click="openRecepcionar(detalle)" />
          <template v-if="enCurso && detalle.saldoPorFacturar > 0">
            <Button label="Registrar factura" icon="pi pi-file" size="small" :loading="facturando" @click="facturarMenu?.toggle($event)" />
            <Menu ref="facturarMenu" :model="facturarMenuItems" :popup="true" />
          </template>
          <Button v-if="enCurso" label="Cerrar" icon="pi pi-lock" text size="small" @click="openCerrar(detalle, 'cerrar')" />
          <Button v-if="enCurso && detalle.recepciones.length === 0 && detalle.facturas.length === 0" label="Anular" icon="pi pi-ban" text severity="danger" size="small" @click="openCerrar(detalle, 'anular')" />
          <Button v-if="!enCurso" label="Reabrir" icon="pi pi-undo" text size="small" :loading="cerrando" @click="cerrarOrden(detalle._id, 'reabrir')" />
        </div>

        <h3 class="section-title">
          Ítems
          <span class="muted">· recibido {{ resumenRecepcion.recibido }} de {{ resumenRecepcion.pedido }}<template v-if="resumenRecepcion.pendiente > 0"> · pendiente {{ resumenRecepcion.pendiente }}</template></span>
        </h3>
        <table class="tabla">
          <thead>
            <tr><th>Descripción</th><th class="num">Pedido</th><th class="num">Recibido</th><th class="num">Precio</th><th class="num">Desc.</th><th class="num">Total</th></tr>
          </thead>
          <tbody>
            <tr v-for="(item, i) in detalle.items" :key="i" :class="{ 'fila-completa': item.cantidadRecibida >= item.cantidad }">
              <td>{{ item.descripcion }}<span v-if="item.exento" class="muted"> (exento)</span></td>
              <td class="num">{{ item.cantidad }} {{ item.unidad }}</td>
              <td class="num" :class="{ pendiente: item.cantidadRecibida < item.cantidad && item.cantidadRecibida > 0 }">{{ item.cantidadRecibida ?? 0 }}</td>
              <td class="num">${{ formatMoney(item.precioUnit) }}</td>
              <td class="num">{{ item.descuento ? `$${formatMoney(item.descuento)}` : '' }}</td>
              <td class="num">${{ formatMoney(montoItem(item)) }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr v-if="detalle.descuentoGlobalPct"><td colspan="5" class="num">Descuento global</td><td class="num">{{ detalle.descuentoGlobalPct }}%</td></tr>
            <tr><td colspan="5" class="num">Neto</td><td class="num">${{ formatMoney(detalle.montos.neto) }}</td></tr>
            <tr v-if="detalle.montos.exento"><td colspan="5" class="num">Exento</td><td class="num">${{ formatMoney(detalle.montos.exento) }}</td></tr>
            <tr><td colspan="5" class="num">IVA</td><td class="num">${{ formatMoney(detalle.montos.iva) }}</td></tr>
            <tr class="fila-total"><td colspan="5" class="num">Total</td><td class="num">${{ formatMoney(detalle.montos.total) }}</td></tr>
          </tfoot>
        </table>
        <p v-if="detalle.condicionesPago" class="muted" style="white-space: pre-line"><strong>Condiciones de pago:</strong> {{ detalle.condicionesPago }}</p>
        <p v-if="detalle.notas" class="muted" style="white-space: pre-line"><strong>Notas internas:</strong> {{ detalle.notas }}</p>

        <!-- Recepciones -->
        <template v-if="detalle.recepciones.length > 0">
          <h3 class="section-title">Recepciones</h3>
          <table class="tabla">
            <tbody>
              <tr v-for="(r, i) in detalle.recepciones" :key="i">
                <td>{{ formatFecha(r.fecha) }}</td>
                <td>{{ r.items.map((l) => `${l.cantidad} × ${detalle!.items[l.indice]?.descripcion ?? `ítem ${l.indice + 1}`}`).join(', ') }}</td>
                <td class="muted">{{ r.guiaFolio ? `Guía ${r.guiaFolio}` : '' }}</td>
                <td class="muted">{{ r.nota }}</td>
              </tr>
            </tbody>
          </table>
        </template>

        <!-- Facturas del proveedor -->
        <template v-if="detalle.facturas.length > 0">
          <h3 class="section-title">
            Facturas del proveedor
            <span class="muted">· facturado ${{ formatMoney(detalle.montoFacturado) }} de ${{ formatMoney(detalle.montos.total) }}<template v-if="detalle.saldoPorFacturar > 0"> · restan ${{ formatMoney(detalle.saldoPorFacturar) }}</template></span>
          </h3>
          <table class="tabla">
            <tbody>
              <tr v-for="f in detalle.facturas" :key="f.purchaseId">
                <td><a class="link" @click="irACompras">{{ TIPO_DOC_LABEL[f.tipoDocumento] ?? f.tipoDocumento }} N° {{ f.folio }}</a></td>
                <td class="muted">{{ compraEstado(f.purchaseId) }}</td>
                <td class="num">${{ formatMoney(f.monto) }}</td>
                <td class="muted">{{ formatFecha(f.creadoAt) }}</td>
                <td class="num"><Button icon="pi pi-times" text size="small" severity="secondary" title="Desvincular" @click="confirmDesvincular(f.purchaseId, f.folio)" /></td>
              </tr>
            </tbody>
          </table>
        </template>

        <!-- Historial -->
        <template v-if="detalle.envios.length > 0 || detalle.versiones.length > 0">
          <h3 class="section-title">Historial</h3>
          <ul class="historial">
            <li v-for="v in detalle.versiones" :key="`v${v.version}`">
              <span class="muted">{{ formatFecha(v.reemplazadaAt) }}</span> Versión {{ v.version }} reemplazada (total ${{ formatMoney(v.montos.total) }}, {{ v.items.length }} ítems)
            </li>
            <li v-for="(e, i) in detalle.envios" :key="`e${i}`">
              <span class="muted">{{ formatFecha(e.enviadoAt) }}</span> Versión {{ e.version }} enviada a {{ e.destinatario }}
            </li>
          </ul>
        </template>
      </div>
    </Dialog>

    <!-- ================= Enviar ================= -->
    <Dialog v-model:visible="enviarVisible" modal header="Enviar orden de compra por correo" style="width: min(560px, 94vw)">
      <div class="form-col">
        <label class="field">
          <span>Destinatario</span>
          <InputText v-model="envio.email" type="email" placeholder="ventas@proveedor.cl" fluid />
        </label>
        <label class="field">
          <span>Mensaje (opcional)</span>
          <Textarea v-model="envio.mensaje" auto-resize rows="3" fluid placeholder="Estimados, adjuntamos la orden de compra…" />
        </label>
        <p class="muted">Se adjunta el PDF de la versión {{ detalle?.version }}. Sale desde la casilla de correo de la organización.</p>
      </div>
      <template #footer>
        <Button label="Cancelar" text @click="enviarVisible = false" />
        <Button label="Enviar" icon="pi pi-send" :loading="enviando" @click="handleEnviar" />
      </template>
    </Dialog>

    <!-- ================= Recepcionar ================= -->
    <Dialog v-model:visible="recepcionVisible" modal header="Registrar recepción" style="width: min(760px, 96vw)">
      <div v-if="detalle" class="form-col">
        <div class="form-grid">
          <label class="field"><span>Fecha</span><DatePicker v-model="recepcion.fecha" date-format="dd/mm/yy" show-icon icon-display="input" fluid /></label>
          <label class="field"><span>Guía de despacho (opcional)</span><InputText v-model="recepcion.guiaFolio" placeholder="Folio" fluid /></label>
          <label class="field field-grow"><span>Nota (opcional)</span><InputText v-model="recepcion.nota" fluid /></label>
        </div>
        <table class="tabla">
          <thead><tr><th>Ítem</th><th class="num">Pedido</th><th class="num">Ya recibido</th><th class="num">Recibir ahora</th></tr></thead>
          <tbody>
            <tr v-for="(item, i) in detalle.items" :key="i" :class="{ 'fila-completa': pendienteDe(item) === 0 }">
              <td>{{ item.descripcion }}</td>
              <td class="num">{{ item.cantidad }} {{ item.unidad }}</td>
              <td class="num">{{ item.cantidadRecibida ?? 0 }}</td>
              <td class="num recibir">
                <InputNumber v-model="recepcion.cantidades[i]" :min="0" :max="pendienteDe(item)" mode="decimal" :max-fraction-digits="2" :disabled="pendienteDe(item) === 0" fluid />
              </td>
            </tr>
          </tbody>
        </table>
        <p class="muted">Viene marcado todo lo pendiente; ajuste las cantidades si la entrega fue parcial. Con la primera recepción los ítems quedan congelados.</p>
      </div>
      <template #footer>
        <Button label="Cancelar" text @click="recepcionVisible = false" />
        <Button label="Registrar recepción" icon="pi pi-inbox" :loading="recepcionando" :disabled="!recepcion.cantidades.some((c) => c > 0)" @click="handleRecepcionar" />
      </template>
    </Dialog>

    <!-- ================= Crear compra desde la orden ================= -->
    <Dialog v-model:visible="crearCompraVisible" modal header="Registrar la factura del proveedor" style="width: min(640px, 96vw)">
      <div v-if="detalle" class="form-col">
        <p class="muted">
          Se crea una compra igual a las de la pantalla Compras (entra al Libro de Compras y a las cuentas por pagar). Proveedor: <strong>{{ supplierOf(detalle.supplierId)?.razonSocial }}</strong>.
        </p>
        <div class="form-grid">
          <label class="field"><span>Tipo</span><Select v-model="compraNueva.tipoDocumento" :options="TIPO_DOC_OPTIONS" option-label="label" option-value="value" fluid /></label>
          <label class="field"><span>Folio</span><InputText v-model="compraNueva.folio" fluid /></label>
          <label class="field"><span>Fecha</span><DatePicker v-model="compraNueva.fecha" date-format="dd/mm/yy" show-icon icon-display="input" fluid /></label>
          <label class="field"><span>Vencimiento</span><DatePicker v-model="compraNueva.fechaVencimiento" date-format="dd/mm/yy" show-icon icon-display="input" placeholder="Opcional" fluid /></label>
        </div>
        <div class="form-grid">
          <label class="field"><span>Monto (con IVA) — restan ${{ formatMoney(detalle.saldoPorFacturar) }}</span><InputNumber v-model="compraNueva.monto" :min="1" :max="detalle.saldoPorFacturar" prefix="$" fluid /></label>
          <label class="field-inline" style="align-self: flex-end; padding-bottom: 0.5rem"><ToggleSwitch v-model="compraNueva.electronico" /><span>Documento electrónico</span></label>
        </div>
        <p class="muted">Si el monto es menor que el saldo, el neto, IVA y exento se reparten en la misma proporción de la orden. El IVA con tratamiento especial (uso común, no recuperable) se ajusta después en Compras.</p>
      </div>
      <template #footer>
        <Button label="Cancelar" text @click="crearCompraVisible = false" />
        <Button label="Registrar compra" icon="pi pi-file" :loading="facturando" :disabled="!compraNueva.folio.trim() || !(compraNueva.monto > 0)" @click="handleCrearCompra" />
      </template>
    </Dialog>

    <!-- ================= Vincular compra existente ================= -->
    <Dialog v-model:visible="vincularVisible" modal header="Vincular una compra existente" style="width: min(640px, 96vw)">
      <div v-if="detalle" class="form-col">
        <label class="field">
          <span>Compra del proveedor</span>
          <Select v-model="compraElegida" :options="compraOptions" option-label="label" option-value="value" placeholder="Seleccione" filter fluid :empty-message="'No hay compras de este proveedor sin vincular'" />
        </label>
        <label class="field"><span>Cuánto de la orden cubre — restan ${{ formatMoney(detalle.saldoPorFacturar) }}</span><InputNumber v-model="vincularMonto" :min="1" :max="detalle.saldoPorFacturar" prefix="$" fluid /></label>
        <p class="muted">Sirve para facturas que ya entraron por Facturas recibidas o se cargaron a mano en Compras. La compra no se modifica.</p>
      </div>
      <template #footer>
        <Button label="Cancelar" text @click="vincularVisible = false" />
        <Button label="Vincular" icon="pi pi-link" :loading="facturando" :disabled="!compraElegida || !(vincularMonto > 0)" @click="handleVincular" />
      </template>
    </Dialog>

    <!-- ================= Cerrar / anular ================= -->
    <Dialog v-model:visible="cerrarVisible" modal :header="cierre.accion === 'cerrar' ? 'Cerrar orden de compra' : 'Anular orden de compra'" style="width: min(520px, 94vw)">
      <div class="form-col">
        <p class="muted">
          <template v-if="cierre.accion === 'cerrar'">Cerrar significa que el resto no va a llegar ni facturarse. Se puede reabrir.</template>
          <template v-else>Anular es para una orden que nunca corrió. Se puede reabrir.</template>
        </p>
        <label class="field"><span>Motivo (opcional)</span><InputText v-model="cierre.motivo" fluid placeholder="Proveedor sin stock, pedido duplicado…" /></label>
      </div>
      <template #footer>
        <Button label="Cancelar" text @click="cerrarVisible = false" />
        <Button :label="cierre.accion === 'cerrar' ? 'Cerrar orden' : 'Anular orden'" :severity="cierre.accion === 'anular' ? 'danger' : undefined" :loading="cerrando" @click="cerrarOrden(detalle!._id, cierre.accion, cierre.motivo.trim() || undefined)" />
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

/* ---- Ítems del formulario (mismas columnas que Cotizaciones) ---- */
.items-table {
  border: 1px solid var(--card-border);
  border-radius: 10px;
  overflow: hidden;
  margin-bottom: 0.5rem;
}
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
.tabla .recibir {
  width: 9rem;
}
.tabla tfoot td {
  border-bottom: none;
  padding: 0.25rem 0.5rem;
}
.fila-total td {
  font-weight: 700;
  border-top: 1px solid var(--card-border-strong);
}
.fila-completa td {
  color: var(--text-tertiary);
}
.pendiente {
  color: var(--warning);
  font-weight: 600;
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
  margin: 0.75rem 0 0;
}
.aviso-warn {
  background: var(--warning-soft);
  color: var(--warning);
}
.aviso-info {
  background: var(--page-bg);
  color: var(--text-secondary);
}
</style>
