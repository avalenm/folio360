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
import ProgressBar from 'primevue/progressbar'
import type { MenuItem } from 'primevue/menuitem'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { useResource } from '@/composables/useResource'
import { useListaPaginada } from '@/composables/useListaPaginada'
import { useCatalogoReferencias } from '@/composables/useCatalogoReferencias'
import { useAuthStore } from '@/stores/auth'
import { feathersClient } from '@/services/feathers'
import FacturaPreview from './FacturaPreview.vue'
import AyudaPagina from '@/components/AyudaPagina.vue'
import { AYUDA_DOCUMENTOS } from './ayuda-documentos.js'
import type { Customer, DteDocument, DteExportacion, DteItem, DtePago, Product, Supplier, ValorUf } from '@/types'
import { TIPOS_DTE_EMITIBLES, nombreCortoTipoDte, tipoDteCorto, tipoDteLabel } from '@/tiposDte'
import { esMonedaExtranjera, formatMonto, monedaDe } from '@/cuentas'

import {
  CLAUSULAS_VENTA,
  FORMAS_PAGO_EXPORTACION,
  INDICADORES_SERVICIO_EXPORTACION,
  MODALIDADES_VENTA,
  MONEDAS_EXPORTACION,
  codigoIsoMoneda,
  PAISES,
  PUERTOS,
  TIPOS_BULTO,
  UNIDADES_ADUANA,
  VIAS_TRANSPORTE
} from '@/codigosAduana'

// La lista la pagina el SERVIDOR y los filtros viajan con la consulta: antes
// se cargaban los 100 más recientes y se filtraba sobre esos, así que buscar
// un folio anterior a ese corte respondía que no existía.
const {
  items: documents,
  total: totalDocumentos,
  desde: desdeDocumentos,
  porPagina,
  loading,
  cargar: fetchAll,
  irA,
  create,
  update,
  remove
} = useListaPaginada<DteDocument>('documents', { filtros: () => filtrosDocumentos.value })

// Los referenciables NO salen de la página: una nota de crédito sobre una
// factura de hace tres meses es el caso normal. Proyectado a lo que las
// etiquetas necesitan, se puede traer completo.
const { items: documentosReferenciables, cargar: cargarReferenciables, invalidar: invalidarReferenciables } =
  useCatalogoReferencias<DteDocument>('documents', [
    'tipoDte',
    'folio',
    'estado',
    'customerId',
    'supplierId',
    'montos',
    'items',
    'ambiente',
    'createdAt'
  ])
const { items: customers, fetchAll: fetchCustomers } = useResource<Customer>('customers')
const { items: suppliers, fetchAll: fetchSuppliers } = useResource<Supplier>('suppliers')
const { items: products, fetchAll: fetchProducts } = useResource<Product>('products')
const auth = useAuthStore()
const confirm = useConfirm()
const toast = useToast()

// --- Importar DTE emitidos en otro sistema ---
// Dos vías: el XML firmado (completo, con timbre y PDF) o el Registro de
// Ventas del SII (solo montos — para cuando el XML ya no es accesible, p.
// ej. el facturador gratuito queda bloqueado al pasar a sistema de mercado).
const importInput = ref<HTMLInputElement | null>(null)
const importMenu = ref()
const importando = ref(false)

const importMenuItems: MenuItem[] = [
  { label: 'Desde XML firmado (con timbre y PDF)', icon: 'pi pi-upload', command: () => importInput.value?.click() },
  { label: 'Desde el Registro de Ventas del SII', icon: 'pi pi-sync', command: () => importarDesdeRcv() }
]

async function importarDesdeRcv(): Promise<void> {
  importando.value = true
  try {
    const result = await feathersClient.service('import-ventas-rcv').create({})
    if (result.importados.length === 0) {
      toast.add({
        severity: 'success',
        summary: 'Nada que importar',
        detail: `${result.revisados} documento(s) del registro ya estaban en el sistema`,
        life: 4000
      })
    } else {
      for (const doc of result.importados) {
        toast.add({
          severity: 'success',
          summary: `Importado: tipo ${doc.tipoDte} folio ${doc.folio}`,
          detail: `${doc.receptor} — $${doc.total.toLocaleString('es-CL')} (sin XML: el PDF no estará disponible)`,
          life: 6000
        })
      }
      await Promise.all([fetchAll(), fetchCustomers()])
    }
  } catch (e) {
    toast.add({
      severity: 'error',
      summary: 'Error al importar desde el Registro de Ventas',
      detail: e instanceof Error ? e.message : undefined,
      life: 6000
    })
  } finally {
    importando.value = false
  }
}

async function importarXml(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (files.length === 0) return

  importando.value = true
  try {
    for (const file of files) {
      try {
        const buffer = new Uint8Array(await file.arrayBuffer())
        let binario = ''
        for (const byte of buffer) binario += String.fromCharCode(byte)
        const result = await feathersClient.service('import-dte-emitido').create({ xmlBase64: btoa(binario) })
        toast.add({
          severity: 'success',
          summary: `Importado: tipo ${result.tipoDte} folio ${result.folio}`,
          detail: file.name,
          life: 3500
        })
      } catch (e) {
        toast.add({
          severity: 'error',
          summary: `No se pudo importar ${file.name}`,
          detail: e instanceof Error ? e.message : undefined,
          life: 6000
        })
      }
    }
    await Promise.all([fetchAll(), fetchCustomers()])
  } finally {
    importando.value = false
  }
}

const ambientes = [
  { label: 'Certificación', value: 'certificacion' },
  { label: 'Producción', value: 'produccion' }
]


// Las notas de crédito/débito normales (61/56) y las de exportación
// (112/111) siempre corrigen o anulan un documento anterior.
const TIPOS_DTE_REQUIEREN_REFERENCIA = [56, 61, 111, 112]
const TIPOS_DTE_REQUIEREN_TRASLADO = [52]
// El <Receptor> del DTE lleva los datos del PROVEEDOR, no de un cliente —
// ver document.model.ts en el servidor.
const TIPOS_DTE_COMPRA = [46]

// Exportación (110/111/112): todo exento, montos en moneda extranjera CON
// decimales, receptor extranjero y zona de aduana — ver document.model.ts
// en el servidor y codigosAduana.ts para las tablas.
const TIPOS_DTE_EXPORTACION = [110, 111, 112]

// Documentos de aduana que una exportación referencia (tabla "Tipo
// Documento Referencia" del Formato DTE del SII, códigos 801-815). No son
// DTE del sistema: folio y fecha se escriben a mano.
const REFERENCIAS_ADUANA = [
  { label: 'DUS (807)', value: 807 },
  { label: 'B/L — Conocimiento de embarque (808)', value: 808 },
  { label: 'AWB — Air Way Bill (809)', value: 809 },
  { label: 'MIC/DTA (810)', value: 810 },
  { label: 'Carta de Porte (811)', value: 811 },
  { label: 'Resolución SNA que califica el servicio (812)', value: 812 },
  { label: 'Pasaporte (813)', value: 813 },
  { label: 'Orden de compra (801)', value: 801 },
  { label: 'Contrato (803)', value: 803 },
  { label: 'Resolución (804)', value: 804 }
]

// Liquidación-Factura: cada línea resume un conjunto de documentos, así que
// lleva el monto directo (no cantidad × precio) y el código del documento
// que liquida. Además tiene su propia zona de comisiones — lo que cobra el
// mandatario, que se resta del total.
const TIPO_DTE_LIQUIDACION = 43

// Códigos válidos para <TpoDocLiq>. El código identifica el DOCUMENTO, no si
// la línea es neta o exenta: las dos líneas de una misma factura llevan el
// mismo. Ver sii-dte-montos-cero en la memoria del proyecto.
const DOCUMENTOS_LIQUIDABLES = [
  { label: 'Factura (30)', value: 30 },
  { label: 'Factura electrónica (33)', value: 33 },
  { label: 'Boletas (35)', value: 35 },
  { label: 'Boleta electrónica (39)', value: 39 },
  { label: 'Nota de crédito (60)', value: 60 },
  { label: 'Nota de crédito electrónica (61)', value: 61 },
  { label: 'Liquidación-factura electrónica (43)', value: 43 },
  { label: 'Anticipo u otra transacción (99)', value: 99 }
]
// "El documento no podrá exceder de 60 líneas de ítem Detalle" — límite del
// SII (Formato Documentos Tributarios Electrónicos §2.1), también validado
// server-side en documents.service.ts. Acá solo evita que el usuario llegue
// a chocar con ese rechazo.
const MAX_DETALLE_LINES = 60


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

// Traslado interno: la mercadería se mueve entre instalaciones de la propia
// empresa, así que el receptor es el mismo emisor y no hay de quién sea "por
// cuenta" el despacho — ver documents.service.ts, que también lo descarta.
const IND_TRASLADO_INTERNO = 5

// Quién se hace cargo del traslado — distinto del motivo (INDICADORES_TRASLADO).
// El SII no lo pide cuando el documento no acompaña bienes, por eso se puede
// dejar vacío; ver <TpoDespacho> en el Formato DTE.
const TIPOS_DESPACHO = [
  { label: 'Por cuenta del cliente', value: 1 },
  { label: 'Por cuenta del emisor, al local del cliente', value: 2 },
  { label: 'Por cuenta del emisor, a otras instalaciones', value: 3 }
]

const esTrasladoInterno = computed(
  () => TIPOS_DTE_REQUIEREN_TRASLADO.includes(draft.tipoDte) && draft.indTraslado === IND_TRASLADO_INTERNO
)

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
// El selector muestra "USD — DOLAR USA": el código ISO para reconocerla de
// una, y el nombre del SII porque es el que queda en el documento.
const opcionesMoneda = MONEDAS_EXPORTACION.map((moneda) => {
  const iso = codigoIsoMoneda(moneda)
  return { label: iso === moneda ? moneda : `${iso} — ${moneda}`, value: moneda }
})

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

// El saldo lo calcula el SERVIDOR y viene en cada documento, descontando los
// abonos Y las notas de crédito que lo corrigen (ver saldo.ts en el server).
//
// Antes se calculaba acá, sobre los documentos cargados en esta vista: una
// nota de crédito más antigua que el corte de la lista no alcanzaba a
// descontarse y el saldo salía inflado. El servidor siempre la encuentra,
// esté o no en la página que se está mirando.
//
// El `??` cubre solo el caso de un documento que todavía no pasó por una
// lectura del servidor; en la práctica siempre viene calculado.
// En PESOS: la cifra sumable, la que muestran Panorama y Finanzas.
function saldoOf(document: DteDocument): number {
  return document.saldo ?? Math.max(0, document.montos.total - document.montoPagado)
}

// En la MONEDA del documento: la que se muestra junto a él, donde poner pesos
// contradiría lo que dice el DTE. Para todo lo que ya está en pesos las dos
// son la misma cifra.
function saldoOrigenOf(document: DteDocument): number {
  return document.saldoOrigen ?? Math.max(0, document.montos.total - document.montoPagado)
}

// Las notas de crédito que explican por qué el saldo es menor que el total.
// Mostrarlas no es adorno: un saldo rebajado sin motivo visible se lee como
// un error del sistema, y con el tiempo uno deja de creerle a la cifra.
function creditosOf(document: DteDocument): { tipoDte: number; folio: number; monto: number }[] {
  return document.creditosAplicados ?? []
}

function totalCreditos(document: DteDocument): number {
  return creditosOf(document).reduce((suma, credito) => suma + credito.monto, 0)
}

function glosaCreditos(document: DteDocument): string {
  const creditos = creditosOf(document)
  if (creditos.length === 0) return ''
  const folios = creditos.map((c) => `N° ${c.folio}`).join(', ')
  return creditos.length === 1 ? `menos nota de crédito ${folios}` : `menos notas de crédito ${folios}`
}

// --- Filtros (client-side: el volumen de esta app no justifica paginación
// server-side todavía) ---
const filterFolio = ref('')
const filterTipo = ref<number | null>(null)
const filterCliente = ref('')
const filterEstado = ref<string | null>(null)
// Mientras la organización certifica no hay nada que separar.
const esCertificacion = computed(() => auth.currentOrganization?.ambiente === 'certificacion')
// En producción la lista parte mostrando SOLO los documentos reales: los de
// certificación quedan como historial, visibles solo eligiendo ese ambiente
// en el filtro. Mezclarlos por defecto se presta a confusión (y a mandarle
// a un cliente un documento de prueba).
const filterAmbiente = ref<string | null>(esCertificacion.value ? null : 'produccion')
const filterFechas = ref<Date[] | null>(null)

const filtrosDocumentos = computed(() => ({
  folio: filterFolio.value.trim(),
  receptor: filterCliente.value.trim(),
  tipoDte: filterTipo.value,
  estado: filterEstado.value,
  ambiente: filterAmbiente.value,
  desde: filterFechas.value?.[0]?.toISOString(),
  hasta: filterFechas.value?.[1]?.toISOString()
}))

function limpiarFiltros(): void {
  filterFolio.value = ''
  filterTipo.value = null
  filterCliente.value = ''
  filterEstado.value = null
  // "Limpiar" vuelve al punto de partida de la vista, y en producción ese
  // punto de partida es ver solo producción — no "todos los ambientes".
  filterAmbiente.value = esCertificacion.value ? null : 'produccion'
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

interface ComisionDraft {
  key: number
  tipoMovim: 'C' | 'O'
  glosa: string
  neto: number
  exento: number
  iva: number
}

let comisionKeySeq = 0

function blankComision(): ComisionDraft {
  comisionKeySeq += 1
  return { key: comisionKeySeq, tipoMovim: 'C', glosa: '', neto: 0, exento: 0, iva: 0 }
}

interface ItemDraft extends DteItem {
  key: number
}

// Una línea de recargo/descuento global (exportación): el flete y el seguro
// van como dos recargos separados —lo exige el SII— más las comisiones al
// exterior. El <IndExeDR>1 (opera sobre exentos) lo pone handleSave: en
// exportación todo es exento, no es una decisión del usuario.
interface DscRcgDraft {
  key: number
  tpoMov: 'D' | 'R'
  glosa: string
  tpoValor: '%' | '$'
  valor: number
}

let dscRcgKeySeq = 0

function blankDscRcg(): DscRcgDraft {
  dscRcgKeySeq += 1
  return { key: dscRcgKeySeq, tpoMov: 'R', glosa: '', tpoValor: '$', valor: 0 }
}

// Una referencia a un documento de aduana (DUS, AWB, MIC...): no es un DTE
// del sistema, así que folio y fecha se escriben a mano.
interface ReferenciaAduanaDraft {
  key: number
  tipoDteRef: number
  folioRef: number
  fecha: Date
  razon: string
}

let refAduanaKeySeq = 0

function blankReferenciaAduana(): ReferenciaAduanaDraft {
  refAduanaKeySeq += 1
  return { key: refAduanaKeySeq, tipoDteRef: 807, folioRef: 0, fecha: new Date(), razon: '' }
}

let itemKeySeq = 0

// Exportación: mismo cálculo que el servidor (montos.ts). El monto de un
// porcentual se aplica ENTERO cuando alcanza 1 —el XML lo declara entero y
// el SII exige que la línea calce exacto con lo declarado— y exacto con
// decimales cuando es menor (no se declara y la tolerancia lo cubre).
function montoPorcentualExp(base: number, pct: number | undefined): number {
  const exacto = Math.round(base * (pct ?? 0)) / 100
  return exacto >= 1 ? Math.round(exacto) : exacto
}

function montoItemExportacion(item: ItemDraft): number {
  const bruto = item.cantidad * item.precioUnit
  const descuento = montoPorcentualExp(bruto, item.descuentoPct)
  const recargo = montoPorcentualExp(bruto - descuento, item.recargoPct)
  return Math.round((bruto - descuento + recargo) * 100) / 100
}

function montoItem(item: ItemDraft): number {
  if (sinMontos.value) return 0
  if (esExportacion.value) return montoItemExportacion(item)
  if (item.montoLinea !== undefined) return item.montoLinea
  return Math.round(item.cantidad * item.precioUnit - (item.descuento ?? 0))
}

// `exento` se recibe por parámetro (no se lee `draft.tipoDte` acá adentro):
// esta función se usa dentro del propio inicializador de `draft`
// (`items: [blankItem()]`), donde `draft` todavía no termina de construirse
// — referenciarlo ahí revienta con "Cannot access 'draft' before
// initialization" (encontrado en vivo con Playwright, no era solo hipotético).
function blankItem(exento = false): ItemDraft {
  itemKeySeq += 1
  return { key: itemKeySeq, descripcion: '', cantidad: 1, precioUnit: 0, descuento: 0, exento, unidad: '' }
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
  item.unidad = product.unidad

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

// La zona de exportación del borrador, con todos sus campos en blanco. Los
// null son "sin dato": handleSave arma el objeto final solo con lo lleno.
function blankExportacion() {
  return {
    moneda: 'DOLAR USA',
    tipoCambio: null as number | null,
    indServicio: null as number | null,
    fmaPagExp: null as number | null,
    modalidadVenta: null as number | null,
    clausulaVenta: null as number | null,
    totalClausula: null as number | null,
    viaTransporte: null as number | null,
    puertoEmbarque: null as number | null,
    puertoDesembarque: null as number | null,
    tara: null as number | null,
    unidadTara: null as number | null,
    pesoBruto: null as number | null,
    unidadPesoBruto: null as number | null,
    pesoNeto: null as number | null,
    unidadPesoNeto: null as number | null,
    totalBultos: null as number | null,
    tipoBultos: null as number | null,
    marcas: '',
    idContainer: '',
    sello: '',
    flete: null as number | null,
    seguro: null as number | null,
    paisRecep: null as number | null,
    paisDestino: null as number | null
  }
}

const draft = reactive({
  tipoDte: 33,
  customerId: '',
  supplierId: '',
  giroReceptor: '',
  referenciaDocId: '',
  referenciaCodRef: 1,
  referenciaRazon: '',
  indTraslado: 1,
  tpoDespacho: null as number | null,
  descuentoGlobalPct: 0,
  items: [blankItem()] as ItemDraft[],
  comisiones: [] as ComisionDraft[],
  exportacion: blankExportacion(),
  dscRcgGlobales: [] as DscRcgDraft[],
  referenciasAduana: [] as ReferenciaAduanaDraft[]
})

const esExportacion = computed(() => TIPOS_DTE_EXPORTACION.includes(draft.tipoDte))

// Una Factura No Afecta o Exenta (34) y los documentos de exportación
// (110/111/112, que no llevan IVA) solo pueden tener ítems exentos (ver
// documents.service.ts) — se fuerza acá para que el usuario nunca llegue a
// chocar con ese rechazo del servidor; el switch "Exento" de cada ítem se
// deshabilita para estos tipos en el template.
watch(
  () => draft.tipoDte,
  (tipoDte) => {
    if (tipoDte === 34 || TIPOS_DTE_EXPORTACION.includes(tipoDte)) {
      draft.items.forEach((item) => {
        item.exento = true
      })
    }
  }
)

// Si el traslado pasa a ser interno, el despacho "por cuenta de" deja de
// tener sentido: se limpia para no arrastrar un valor que el formulario ya
// no muestra (el servidor lo descarta igual, esto es para que el borrador
// guardado coincida con lo que se ve).
watch(esTrasladoInterno, (interno) => {
  if (interno) draft.tpoDespacho = null
})

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
  documentosReferenciables.value
    .filter((d) => d.customerId === draft.customerId && d.folio != null && d._id !== editingId.value)
    .map((d) => ({
      label: `${tipoDteLabel(d.tipoDte)} · folio ${d.folio} · $${d.montos.total.toLocaleString('es-CL')}`,
      value: d._id
    }))
)

const referenciaDoc = computed(() => documentosReferenciables.value.find((d) => d._id === draft.referenciaDocId))

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
const esLiquidacion = computed(() => draft.tipoDte === TIPO_DTE_LIQUIDACION)

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
    return { netoBruto: 0, descuentoGlobal: 0, neto: 0, exento: 0, iva: 0, comision: 0, total: 0 }
  }

  // Exportación: todo exento, y los recargos/descuentos globales
  // suman/restan directo — mismo criterio que el servidor
  // (calcularMontosExportacion en montos.ts), trabajando en centésimas. El
  // total del encabezado se redondea a entero, igual que el servidor (el
  // timbre del SII no admite decimales).
  if (esExportacion.value) {
    const itemsCent = draft.items.reduce((sum, item) => sum + Math.round(montoItemExportacion(item) * 100), 0)
    let exentoCent = itemsCent
    for (const linea of draft.dscRcgGlobales) {
      const montoCent = linea.tpoValor === '%' ? Math.round((itemsCent * linea.valor) / 100) : Math.round(linea.valor * 100)
      exentoCent += linea.tpoMov === 'R' ? montoCent : -montoCent
    }
    const exento = Math.round(exentoCent / 100)
    return { netoBruto: 0, descuentoGlobal: 0, neto: 0, exento, iva: 0, comision: 0, total: exento }
  }

  let netoBruto = 0
  let exento = 0

  for (const item of draft.items) {
    const monto = item.montoLinea ?? Math.round(item.cantidad * item.precioUnit - (item.descuento ?? 0))
    if (item.exento) exento += monto
    else netoBruto += monto
  }

  const descuentoGlobal = draft.descuentoGlobalPct ? Math.round(netoBruto * (draft.descuentoGlobalPct / 100)) : 0
  const neto = netoBruto - descuentoGlobal
  const iva = Math.round(neto * 0.19)
  // Lo que cobra el mandatario se resta del total: el documento liquida lo
  // que se le entrega al mandante ya descontada la comisión.
  const comision = draft.comisiones.reduce((sum, c) => sum + c.neto + c.exento + c.iva, 0)
  return { netoBruto, descuentoGlobal, neto, exento, iva, comision, total: neto + iva + exento - comision }
})

function openCreate(): void {
  editingId.value = null
  draft.tipoDte = 33
  draft.customerId = ''
  draft.supplierId = ''
  draft.giroReceptor = ''
  draft.referenciaDocId = ''
  draft.referenciaCodRef = 1
  draft.referenciaRazon = ''
  draft.indTraslado = 1
  draft.tpoDespacho = null
  draft.descuentoGlobalPct = 0
  draft.items = [blankItem()]
  draft.comisiones = []
  draft.exportacion = blankExportacion()
  draft.dscRcgGlobales = []
  draft.referenciasAduana = []
  dialogVisible.value = true
  void cargarReferenciables()
}

function openEdit(document: DteDocument): void {
  editingId.value = document._id
  draft.tipoDte = document.tipoDte
  draft.customerId = document.customerId ?? ''
  draft.supplierId = document.supplierId ?? ''
  draft.giroReceptor = document.giroReceptor ?? ''
  const referencia = document.referencias?.[0]
  draft.referenciaCodRef = referencia?.codRef ?? 1
  draft.referenciaRazon = referencia?.razon ?? ''
  draft.referenciaDocId = referencia
    ? (documentosReferenciables.value.find((d) => d.tipoDte === referencia.tipoDteRef && d.folio === referencia.folioRef)?._id ?? '')
    : ''
  draft.indTraslado = document.indTraslado ?? 1
  draft.tpoDespacho = document.tpoDespacho ?? null
  draft.descuentoGlobalPct = document.descuentoGlobalPct ?? 0
  draft.items = document.items.map((item) => ({ ...item, key: (itemKeySeq += 1) }))
  draft.comisiones = (document.comisiones ?? []).map((c) => ({ ...c, key: (comisionKeySeq += 1) }))
  draft.exportacion = { ...blankExportacion(), ...(document.exportacion ?? {}) }
  draft.dscRcgGlobales = (document.dscRcgGlobales ?? []).map((linea) => ({
    ...linea,
    glosa: linea.glosa ?? '',
    key: (dscRcgKeySeq += 1)
  }))
  // Las referencias a documentos de aduana usan los códigos 801-815 del SII
  // — todo lo demás (un tipoDte real) es la referencia NC/ND de más arriba.
  draft.referenciasAduana = (document.referencias ?? [])
    .filter((referencia) => typeof referencia.tipoDteRef === 'number' && referencia.tipoDteRef >= 800)
    .map((referencia) => ({
      key: (refAduanaKeySeq += 1),
      tipoDteRef: referencia.tipoDteRef,
      folioRef: referencia.folioRef,
      fecha: new Date(referencia.fechaRef),
      razon: referencia.razon
    }))
  dialogVisible.value = true
  void cargarReferenciables()
}

function addItem(): void {
  draft.items.push(blankItem(draft.tipoDte === 34 || esExportacion.value))
}

function removeItem(key: number): void {
  draft.items = draft.items.filter((item) => item.key !== key)
}

function addDscRcg(): void {
  draft.dscRcgGlobales.push(blankDscRcg())
}

function removeDscRcg(key: number): void {
  draft.dscRcgGlobales = draft.dscRcgGlobales.filter((linea) => linea.key !== key)
}

function addReferenciaAduana(): void {
  draft.referenciasAduana.push(blankReferenciaAduana())
}

function removeReferenciaAduana(key: number): void {
  draft.referenciasAduana = draft.referenciasAduana.filter((referencia) => referencia.key !== key)
}

// El objeto `exportacion` que se manda al servidor: solo los campos con
// dato (los null del formulario no viajan) — el servidor guarda lo que
// llega y el XML omite lo ausente.
function exportacionPayload(): DteExportacion {
  const entries = Object.entries(draft.exportacion).filter(([, value]) => value !== null && value !== '')
  return Object.fromEntries(entries) as unknown as DteExportacion
}

// --- Ocupación de la hoja ---
// El SII exige que el documento quepa en UNA hoja impresa, y el guardado lo
// rechaza si no cabe (documents.service.ts). Para no enterarse recién al
// guardar, mientras se editan los ítems se le pide al servidor la misma
// medición (document-hoja) y se muestra como barra: 100 % = ya no entra ni
// un ítem más. Con retardo, para no medir en cada tecla.
const hoja = ref<{ cabe: boolean; ocupacion: number; itemFontSize: number } | null>(null)
let hojaTimer: ReturnType<typeof setTimeout> | undefined
let hojaSeq = 0

async function medirHoja(): Promise<void> {
  const seq = (hojaSeq += 1)
  try {
    const medida = await feathersClient.service('document-hoja').create({
      tipoDte: draft.tipoDte,
      customerId: draft.customerId || undefined,
      supplierId: draft.supplierId || undefined,
      descuentoGlobalPct: draft.descuentoGlobalPct || undefined,
      items: draft.items.map(({ key: _key, ...item }) => item),
      comisiones: draft.comisiones.map(({ key: _key, ...c }) => c),
      exportacion: esExportacion.value ? draft.exportacion : undefined,
      dscRcgGlobales: draft.dscRcgGlobales.map(({ key: _key, ...linea }) => linea),
      referencias: referenciaDoc.value ? [{ tipoDteRef: referenciaDoc.value.tipoDte, folioRef: referenciaDoc.value.folio }] : []
    })
    if (seq === hojaSeq) hoja.value = medida
  } catch {
    // Es solo un aviso: si falla la medición no se molesta al usuario, el
    // guardado igual valida.
  }
}

watch(
  () => [dialogVisible.value, draft.tipoDte, draft.customerId, draft.supplierId, draft.descuentoGlobalPct, JSON.stringify(draft.items), draft.comisiones.length, draft.dscRcgGlobales.length],
  () => {
    if (!dialogVisible.value) {
      hoja.value = null
      return
    }
    clearTimeout(hojaTimer)
    hojaTimer = setTimeout(() => void medirHoja(), 500)
  }
)

const hojaPct = computed(() => (hoja.value ? Math.min(100, Math.round(hoja.value.ocupacion * 100)) : 0))

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

  if (!editingId.value && esExportacion.value && !draft.exportacion.moneda) {
    toast.add({ severity: 'warn', summary: 'Falta la moneda de la operación', life: 3000 })
    return
  }

  // El SII exige la sección OtraMoneda con los montos en pesos: sin tipo de
  // cambio el servidor rechaza el borrador (ver documents.service.ts).
  if (!editingId.value && esExportacion.value && draft.exportacion.moneda !== 'PESO CL' && !draft.exportacion.tipoCambio) {
    toast.add({ severity: 'warn', summary: 'Falta el tipo de cambio a pesos', life: 3000 })
    return
  }

  saving.value = true
  try {
    const items = draft.items.map(({ key: _key, ...item }) => ({
      ...item,
      // Los porcentuales solo viajan con dato: un 0 guardado sería un
      // descuento/recargo declarado en el XML.
      descuentoPct: item.descuentoPct || undefined,
      recargoPct: item.recargoPct || undefined
    }))
    // <IndExeDR>1: en exportación todo es exento, así que cada recargo o
    // descuento global opera sobre los montos exentos — no es una decisión
    // del usuario, se fija acá (ver dte-xml.ts en el servidor).
    const dscRcgGlobales = esExportacion.value
      ? draft.dscRcgGlobales
          .filter((linea) => linea.valor > 0)
          .map(({ key: _key, glosa, ...linea }) => ({ ...linea, glosa: glosa.trim() || undefined, indExeDR: 1 }))
      : []

    if (editingId.value) {
      await update(
        editingId.value,
        esExportacion.value
          ? { items, exportacion: exportacionPayload(), dscRcgGlobales }
          : { items }
      )
    } else {
      const doc = referenciaDoc.value
      const referencias: Array<{ tipoDteRef: number; folioRef: number; fechaRef: string; codRef?: number; razon: string }> =
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

      // Las referencias a documentos de aduana (DUS, AWB, MIC...) van
      // después de la referencia NC/ND si la hay.
      if (esExportacion.value) {
        for (const referencia of draft.referenciasAduana) {
          if (!referencia.folioRef && !referencia.razon.trim()) continue
          referencias.push({
            tipoDteRef: referencia.tipoDteRef,
            folioRef: referencia.folioRef,
            fechaRef: referencia.fecha.toISOString(),
            razon: referencia.razon.trim()
          })
        }
      }

      await create({
        tipoDte: draft.tipoDte,
        customerId: TIPOS_DTE_COMPRA.includes(draft.tipoDte) ? undefined : draft.customerId,
        supplierId: TIPOS_DTE_COMPRA.includes(draft.tipoDte) ? draft.supplierId : undefined,
        giroReceptor: draft.giroReceptor || undefined,
        indTraslado: TIPOS_DTE_REQUIEREN_TRASLADO.includes(draft.tipoDte) ? draft.indTraslado : undefined,
        tpoDespacho:
          TIPOS_DTE_REQUIEREN_TRASLADO.includes(draft.tipoDte) && draft.tpoDespacho
            ? draft.tpoDespacho
            : undefined,
        descuentoGlobalPct: draft.tipoDte !== 34 && draft.descuentoGlobalPct ? draft.descuentoGlobalPct : undefined,
        exportacion: esExportacion.value ? exportacionPayload() : undefined,
        dscRcgGlobales: esExportacion.value && dscRcgGlobales.length > 0 ? dscRcgGlobales : undefined,
        referencias,
        items,
        comisiones: esLiquidacion.value
          ? draft.comisiones.map(({ key: _key, ...comision }) => comision)
          : undefined
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
  pagoMonto.value = saldoOrigenOf(document)
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

    if (saldoOrigenOf(updated) <= 0) {
      pagoVisible.value = false
    } else {
      pagoMonto.value = saldoOrigenOf(updated)
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
    pagoMonto.value = saldoOrigenOf(updated)
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

// --- Qué pasó con una Guía de Despacho después de emitida ---
// Una guía que constituye venta todavía no declaró la venta: la declarará la
// factura que la reemplace. El Libro de Guías (LibrosView) es el que le
// informa eso al SII, y para poder armarlo hay que registrar acá cuál se
// facturó y cuál se anuló — ver document.model.ts en el servidor.
const TIPO_DTE_GUIA_DESPACHO = 52

// Estados en que la guía existe ante el SII y por lo tanto se puede facturar
// o anular. Un borrador todavía no tiene folio: se elimina, no se anula.
const ESTADOS_GUIA_VIGENTE = ['enviado', 'aceptado', 'reparo']

function esGuiaVigente(document: DteDocument): boolean {
  return (
    document.tipoDte === TIPO_DTE_GUIA_DESPACHO &&
    document.folio !== undefined &&
    ESTADOS_GUIA_VIGENTE.includes(document.estado)
  )
}

const guiaDocument = ref<DteDocument | null>(null)
const guiaSending = ref(false)

const facturadaVisible = ref(false)
const facturadaDocId = ref<string>('')

const anularVisible = ref(false)
const anularFecha = ref<Date>(new Date())
const anularMotivo = ref('')

// Candidatos a "quién facturó esta guía": documentos emitidos que no son
// guías. El <TpoDocRef> del Libro de Guías no admite el código 52 — una guía
// no se reemplaza con otra guía, sino con una factura o una nota.
const documentosQuePuedenFacturar = computed(() =>
  documentosReferenciables.value
    .filter(
      (d) =>
        d.tipoDte !== TIPO_DTE_GUIA_DESPACHO &&
        d.folio !== undefined &&
        ESTADOS_GUIA_VIGENTE.includes(d.estado)
    )
    .map((d) => ({
      value: d._id,
      label: `${nombreCortoTipoDte(d.tipoDte)} N° ${d.folio} — $${formatMoney(d.montos.total)}`
    }))
)

function openFacturada(document: DteDocument): void {
  guiaDocument.value = document
  facturadaDocId.value = ''
  facturadaVisible.value = true
  void cargarReferenciables()
}

async function confirmFacturada(): Promise<void> {
  const guia = guiaDocument.value
  const factura = documentosReferenciables.value.find((d) => d._id === facturadaDocId.value)
  if (!guia || !factura) return

  guiaSending.value = true
  try {
    // Se guarda la tripleta tipo/folio/fecha, no el id: es exactamente lo que
    // el Libro declara en <TpoDocRef>/<FolioDocRef>/<FchDocRef>.
    await update(guia._id, {
      guiaFacturada: {
        tipoDte: factura.tipoDte,
        folio: factura.folio as number,
        fecha: factura.fechaEmision ?? factura.createdAt
      }
    })
    facturadaVisible.value = false
    toast.add({ severity: 'success', summary: 'Guía marcada como facturada', life: 2500 })
  } catch (e) {
    toast.add({
      severity: 'error',
      summary: 'Error al marcar la guía',
      detail: e instanceof Error ? e.message : undefined,
      life: 4000
    })
  } finally {
    guiaSending.value = false
  }
}

function openAnular(document: DteDocument): void {
  guiaDocument.value = document
  anularFecha.value = new Date()
  anularMotivo.value = ''
  anularVisible.value = true
}

async function confirmAnular(): Promise<void> {
  const guia = guiaDocument.value
  if (!guia) return

  guiaSending.value = true
  try {
    // El estado 'anulado' lo pone el servidor junto con este campo: las dos
    // cosas no se pueden separar (ver documents.service.ts).
    await update(guia._id, {
      guiaAnulada: { fecha: anularFecha.value.toISOString(), motivo: anularMotivo.value.trim() || undefined }
    })
    anularVisible.value = false
    toast.add({ severity: 'success', summary: 'Guía anulada', life: 2500 })
  } catch (e) {
    toast.add({
      severity: 'error',
      summary: 'Error al anular la guía',
      detail: e instanceof Error ? e.message : undefined,
      life: 4000
    })
  } finally {
    guiaSending.value = false
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
        invalidarReferenciables()
        await fetchAll()
        previewVisible.value = false
        toast.add({ severity: 'success', summary: 'Documento emitido y firmado', life: 3000 })
        // Emitir y enviar son dos pasos (ver send-document.service.ts): un
        // documento firmado pero no enviado no es un DTE válido ante el SII y
        // el cliente no recibe nada. Para que no quede olvidado, se ofrece el
        // envío enseguida (el usuario prefirió que se pregunte, 2026-08-27).
        // El botón "Enviar al SII" sigue disponible si acá se responde que no.
        confirmSend(document, { header: 'Documento firmado — ¿enviar al SII ahora?' })
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
        invalidarReferenciables()
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

function confirmSend(document: DteDocument, opciones: { header?: string } = {}): void {
  confirm.require({
    message:
      'Esto sube el documento firmado al SII (sobre EnvioDTE) y, si el SII lo recibe, se le envía al cliente por correo (XML + PDF) — es una acción real, no se puede deshacer. ¿Enviar al SII?',
    header: opciones.header ?? 'Confirmar envío al SII',
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Enviar',
    acceptProps: { severity: 'danger' },
    accept: async () => {
      sending.value = true
      try {
        await feathersClient.service('send-document').create({ documentId: document._id })
        invalidarReferenciables()
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

  // En un borrador, la vista previa es también el lugar donde se emite y
  // firma: el nombre lo dice para que no haya que descubrirlo entrando
  // (feedback del usuario, 2026-08-13). Para vendedor —que no puede
  // emitir— y para documentos ya emitidos, sigue siendo solo vista previa.
  const puedeEmitir = document.estado === 'draft' && auth.hasMinRole('contador')
  const items: MenuItem[] = [
    {
      label: puedeEmitir ? 'Revisar y emitir…' : 'Vista previa',
      icon: puedeEmitir ? 'pi pi-verified' : 'pi pi-eye',
      command: () => openPreview(document)
    }
  ]

  // Un borrador también tiene PDF: la vista previa con marca de agua, con el
  // mismo layout que saldrá al SII — para revisar el formato ANTES de emitir
  // (feedback del usuario, 2026-08-26).
  items.push({
    label: document.estado === 'draft' ? 'PDF como irá al SII' : 'Descargar PDF',
    icon: 'pi pi-file-pdf',
    command: () => downloadPdf(document)
  })

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

  // Qué pasó con la guía después de emitida: es lo que declara el Libro de
  // Guías, y sin esto los dos casos no se pueden registrar desde la UI.
  // Contador+ por el mismo criterio que el resto: cambia lo que se le
  // declara al SII.
  if (esGuiaVigente(document) && auth.hasMinRole('contador')) {
    if (!document.guiaFacturada) {
      items.push({ label: 'Marcar como facturada', icon: 'pi pi-file-check', command: () => openFacturada(document) })
    }
    items.push({ label: 'Anular guía', icon: 'pi pi-ban', command: () => openAnular(document) })
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

// Para el filtro por estado de la tabla — mismas etiquetas que los tags.
const ESTADO_FILTRO_OPTIONS = Object.entries(ESTADO_LABELS).map(([value, label]) => ({ value, label }))

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
      <h1 class="page-title">Documentos <AyudaPagina titulo="Documentos" :secciones="AYUDA_DOCUMENTOS" /></h1>
      <div class="header-actions">
        <Button label="Importar" icon="pi pi-download" outlined :loading="importando" @click="importMenu?.toggle($event)" />
        <Menu ref="importMenu" :model="importMenuItems" :popup="true" />
        <input ref="importInput" type="file" accept=".xml,text/xml" multiple hidden @change="importarXml" />
        <Button label="Nuevo documento" icon="pi pi-plus" @click="openCreate" />
      </div>
    </div>

    <div class="filters surface-card">
      <label class="field">
        <span>Folio</span>
        <InputText v-model="filterFolio" placeholder="N° folio" />
      </label>
      <label class="field">
        <span>Tipo de documento</span>
        <Select
          v-model="filterTipo"
          :options="TIPOS_DTE_EMITIBLES"
          option-label="corto"
          option-value="value"
          placeholder="Todos"
          show-clear
        />
      </label>
      <label class="field">
        <span>Cliente/proveedor o RUT</span>
        <InputText v-model="filterCliente" placeholder="Nombre o RUT" />
      </label>
      <label class="field">
        <span>Estado</span>
        <Select
          v-model="filterEstado"
          :options="ESTADO_FILTRO_OPTIONS"
          option-label="label"
          option-value="value"
          placeholder="Todos"
          show-clear
        />
      </label>
      <!-- Aparece solo cuando hay algo que separar: mientras la organización
           certifica, TODO es de certificación y el filtro sería ruido. -->
      <label v-if="!esCertificacion" class="field">
        <span>Ambiente</span>
        <Select
          v-model="filterAmbiente"
          :options="ambientes"
          option-label="label"
          option-value="value"
          placeholder="Todos"
          show-clear
        />
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
      :value="documents"
      :loading="loading"
      data-key="_id"
      striped-rows
      lazy
      paginator
      :rows="porPagina"
      :total-records="totalDocumentos"
      :first="desdeDocumentos"
      current-page-report-template="{first}–{last} de {totalRecords}"
      paginator-template="FirstPageLink PrevPageLink CurrentPageReport NextPageLink LastPageLink"
      @page="irA($event.first)"
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
            <span class="muted">{{ tipoDteCorto(data.tipoDte) }}</span>
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
            <!-- En la moneda del documento: una exportación en dólares con un
                 signo $ delante se lee como pesos y no lo es. -->
            <strong>{{ formatMonto(data.montos.total, monedaDe(data)) }}</strong>
            <span v-if="!esMonedaExtranjera(data)" class="muted">IVA ${{ formatMoney(data.montos.iva) }}</span>
          </div>
        </template>
      </Column>

      <Column header="Saldo">
        <template #body="{ data }">
          <div class="stacked-cell">
            <!-- El saldo va en la moneda del documento, para que se pueda
                 comparar con el monto de al lado sin traducir nada. -->
            <span v-if="saldoOrigenOf(data) > 0" class="saldo-pendiente">
              {{ formatMonto(saldoOrigenOf(data), monedaDe(data)) }}
            </span>
            <span v-else class="saldo-pagado"><i class="pi pi-check-circle" /> Pagado</span>
            <!-- Por qué el saldo es menor que el total. Sin esto la rebaja
                 parece un error del sistema. -->
            <span v-if="creditosOf(data).length > 0" class="muted">{{ glosaCreditos(data) }}</span>
            <!-- En moneda extranjera se muestra además el equivalente en
                 pesos y el cambio con que se calculó: es la cifra que suman
                 el Panorama y Finanzas, y así se puede auditar. -->
            <span v-if="esMonedaExtranjera(data) && saldoOrigenOf(data) > 0" class="muted">
              ${{ formatMoney(saldoOf(data)) }} al cambio {{ formatMoney(data.exportacion?.tipoCambio ?? 0) }}
            </span>
          </div>
        </template>
      </Column>

      <Column header="Estado">
        <template #body="{ data }">
          <Tag :severity="estadoSeverity[data.estado]" :value="estadoLabel(data.estado)" :title="data.envioSiiGlosa" />
          <!-- Solo se marca lo de prueba: en producción, marcar cada fila como
               "producción" sería ruido en todas. Lo que hay que poder
               distinguir de un vistazo es lo que NO es real. -->
          <Tag
            v-if="data.ambiente === 'certificacion'"
            severity="warn"
            value="Prueba"
            title="Documento de certificación: no tiene validez tributaria"
            class="estado-extra"
          />
          <!-- Una guía facturada sigue aceptada ante el SII, pero su monto ya
               lo declara la factura: conviene verlo en el listado, porque es
               lo que decide cómo entra al Libro de Guías. -->
          <Tag
            v-if="data.guiaFacturada"
            severity="info"
            :value="`Facturada ${data.guiaFacturada.folio}`"
            :title="`Facturada por el documento tipo ${data.guiaFacturada.tipoDte} folio ${data.guiaFacturada.folio}`"
            class="estado-extra"
          />
          <!-- Correo al receptor (XML + PDF), que sale tras un envío exitoso
               al SII: se muestra para no tener que inferirlo. -->
          <div
            v-if="data.correoReceptor"
            class="muted correo-receptor"
            :title="`XML y PDF enviados por correo a ${data.correoReceptor.destinatario}`"
          >
            <i class="pi pi-envelope" />
            {{ data.correoReceptor.destinatario }} ·
            {{ new Date(data.correoReceptor.enviadoAt).toLocaleDateString('es-CL') }}
          </div>
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
                :options="TIPOS_DTE_EMITIBLES"
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

          <label v-if="TIPOS_DTE_REQUIEREN_TRASLADO.includes(draft.tipoDte) && !esTrasladoInterno" class="field">
            <span>Traslado por cuenta de</span>
            <Select
              v-model="draft.tpoDespacho"
              :options="TIPOS_DESPACHO"
              option-label="label"
              option-value="value"
              placeholder="Sin especificar"
              show-clear
              :disabled="!!editingId"
            />
            <small class="giro-hint">
              <i class="pi pi-info-circle" /> Quién se hace cargo del despacho. Se puede dejar vacío solo si la
              guía no acompaña bienes.
            </small>
          </label>

          <p v-if="esTrasladoInterno" class="giro-hint">
            <i class="pi pi-info-circle" /> En un traslado interno la mercadería se mueve entre instalaciones de
            la propia empresa, así que el receptor debe ser la empresa misma y no corresponde indicar por cuenta
            de quién va el despacho.
          </p>
        </section>

        <section v-if="esExportacion" class="doc-section">
          <h3 class="section-title">Exportación</h3>
          <p class="giro-hint">
            <i class="pi pi-info-circle" /> Los montos van en la moneda de la operación, con decimales. El cliente
            debe tener el RUT genérico de extranjeros (55555555-5) y su país en la ficha. Los campos de aduana que
            no apliquen se dejan vacíos.
          </p>
          <div class="form-row">
            <label class="field">
              <span>Moneda de la operación</span>
              <!-- Se elige por código ISO pero se GUARDA el nombre del SII: es
                   el literal que exige el <TpoMoneda> del DTE. -->
              <Select
                v-model="draft.exportacion.moneda"
                :options="opcionesMoneda"
                option-label="label"
                option-value="value"
                filter
                :disabled="!!editingId"
              />
            </label>
            <label class="field">
              <span>Tipo de cambio (pesos por unidad)</span>
              <InputNumber v-model="draft.exportacion.tipoCambio" :min="0" mode="decimal" :max-fraction-digits="4" fluid />
            </label>
            <label class="field">
              <span>Forma de pago exportación</span>
              <Select
                v-model="draft.exportacion.fmaPagExp"
                :options="FORMAS_PAGO_EXPORTACION"
                option-label="label"
                option-value="value"
                placeholder="Sin especificar"
                show-clear
              />
            </label>
            <label class="field">
              <span>Indicador de servicio</span>
              <Select
                v-model="draft.exportacion.indServicio"
                :options="INDICADORES_SERVICIO_EXPORTACION"
                option-label="label"
                option-value="value"
                placeholder="No es un servicio"
                show-clear
              />
            </label>
          </div>
          <div class="form-row">
            <label class="field">
              <span>Modalidad de venta</span>
              <Select
                v-model="draft.exportacion.modalidadVenta"
                :options="MODALIDADES_VENTA"
                option-label="label"
                option-value="value"
                placeholder="Sin especificar"
                show-clear
              />
            </label>
            <label class="field">
              <span>Cláusula de venta</span>
              <Select
                v-model="draft.exportacion.clausulaVenta"
                :options="CLAUSULAS_VENTA"
                option-label="label"
                option-value="value"
                placeholder="Sin especificar"
                show-clear
              />
            </label>
            <label class="field">
              <span>Total cláusula de venta</span>
              <InputNumber v-model="draft.exportacion.totalClausula" :min="0" mode="decimal" :max-fraction-digits="2" fluid />
            </label>
          </div>
          <div class="form-row">
            <label class="field">
              <span>Vía de transporte</span>
              <Select
                v-model="draft.exportacion.viaTransporte"
                :options="VIAS_TRANSPORTE"
                option-label="label"
                option-value="value"
                placeholder="Sin especificar"
                show-clear
              />
            </label>
            <label class="field">
              <span>Puerto de embarque</span>
              <Select
                v-model="draft.exportacion.puertoEmbarque"
                :options="PUERTOS"
                option-label="label"
                option-value="value"
                placeholder="Sin especificar"
                filter
                show-clear
              />
            </label>
            <label class="field">
              <span>Puerto de desembarque</span>
              <Select
                v-model="draft.exportacion.puertoDesembarque"
                :options="PUERTOS"
                option-label="label"
                option-value="value"
                placeholder="Sin especificar"
                filter
                show-clear
              />
            </label>
          </div>
          <div class="form-row">
            <label class="field">
              <span>País receptor</span>
              <Select
                v-model="draft.exportacion.paisRecep"
                :options="PAISES"
                option-label="label"
                option-value="value"
                placeholder="Sin especificar"
                filter
                show-clear
              />
            </label>
            <label class="field">
              <span>País de destino</span>
              <Select
                v-model="draft.exportacion.paisDestino"
                :options="PAISES"
                option-label="label"
                option-value="value"
                placeholder="Sin especificar"
                filter
                show-clear
              />
            </label>
            <label class="field">
              <span>Tipo de bulto</span>
              <Select
                v-model="draft.exportacion.tipoBultos"
                :options="TIPOS_BULTO"
                option-label="label"
                option-value="value"
                placeholder="Sin especificar"
                filter
                show-clear
              />
            </label>
          </div>
          <div class="form-row">
            <label class="field">
              <span>Total de bultos</span>
              <InputNumber v-model="draft.exportacion.totalBultos" :min="0" fluid />
            </label>
            <label class="field">
              <span>Marcas de los bultos</span>
              <InputText v-model="draft.exportacion.marcas" placeholder="S/M si no llevan" />
            </label>
            <label class="field">
              <span>Flete</span>
              <InputNumber v-model="draft.exportacion.flete" :min="0" mode="decimal" :max-fraction-digits="2" fluid />
            </label>
            <label class="field">
              <span>Seguro</span>
              <InputNumber v-model="draft.exportacion.seguro" :min="0" mode="decimal" :max-fraction-digits="2" fluid />
            </label>
          </div>
          <div class="form-row">
            <label class="field">
              <span>Id. del contenedor</span>
              <InputText v-model="draft.exportacion.idContainer" placeholder="Solo si el bulto es contenedor" />
            </label>
            <label class="field">
              <span>Sello del contenedor</span>
              <InputText v-model="draft.exportacion.sello" placeholder="Solo si el bulto es contenedor" />
            </label>
          </div>
          <div class="form-row">
            <label class="field">
              <span>Tara</span>
              <InputNumber v-model="draft.exportacion.tara" :min="0" fluid />
            </label>
            <label class="field">
              <span>Unidad de la tara</span>
              <Select
                v-model="draft.exportacion.unidadTara"
                :options="UNIDADES_ADUANA"
                option-label="label"
                option-value="value"
                placeholder="Sin especificar"
                show-clear
              />
            </label>
            <label class="field">
              <span>Peso bruto</span>
              <InputNumber v-model="draft.exportacion.pesoBruto" :min="0" mode="decimal" :max-fraction-digits="2" fluid />
            </label>
          </div>
          <div class="form-row">
            <label class="field">
              <span>Unidad peso bruto</span>
              <Select
                v-model="draft.exportacion.unidadPesoBruto"
                :options="UNIDADES_ADUANA"
                option-label="label"
                option-value="value"
                placeholder="Sin especificar"
                show-clear
              />
            </label>
            <label class="field">
              <span>Peso neto</span>
              <InputNumber v-model="draft.exportacion.pesoNeto" :min="0" mode="decimal" :max-fraction-digits="2" fluid />
            </label>
            <label class="field">
              <span>Unidad peso neto</span>
              <Select
                v-model="draft.exportacion.unidadPesoNeto"
                :options="UNIDADES_ADUANA"
                option-label="label"
                option-value="value"
                placeholder="Sin especificar"
                show-clear
              />
            </label>
          </div>

          <div class="section-header-row" style="margin-top: 0.75rem">
            <h3 class="section-title">Recargos y descuentos globales</h3>
            <Button label="Agregar línea" icon="pi pi-plus" text size="small" type="button" @click="addDscRcg" />
          </div>
          <p class="giro-hint">
            <i class="pi pi-info-circle" /> El flete y el seguro del encabezado deben declararse ADEMÁS acá, como
            dos recargos separados en monto — lo exige el SII para exportación.
          </p>
          <div v-for="linea in draft.dscRcgGlobales" :key="linea.key" class="form-row dscrcg-row">
            <label class="field">
              <span>Tipo</span>
              <Select
                v-model="linea.tpoMov"
                :options="[
                  { label: 'Recargo', value: 'R' },
                  { label: 'Descuento', value: 'D' }
                ]"
                option-label="label"
                option-value="value"
              />
            </label>
            <label class="field field-grow">
              <span>Glosa</span>
              <InputText v-model="linea.glosa" placeholder="Ej: FLETE" :maxlength="45" />
            </label>
            <label class="field">
              <span>En</span>
              <Select
                v-model="linea.tpoValor"
                :options="[
                  { label: 'Monto', value: '$' },
                  { label: 'Porcentaje', value: '%' }
                ]"
                option-label="label"
                option-value="value"
              />
            </label>
            <label class="field">
              <span>Valor</span>
              <InputNumber v-model="linea.valor" :min="0" mode="decimal" :max-fraction-digits="2" fluid />
            </label>
            <Button
              icon="pi pi-times"
              text
              severity="secondary"
              type="button"
              title="Quitar línea"
              class="dscrcg-remove"
              @click="removeDscRcg(linea.key)"
            />
          </div>

          <div class="section-header-row" style="margin-top: 0.75rem">
            <h3 class="section-title">Referencias de aduana</h3>
            <Button label="Agregar referencia" icon="pi pi-plus" text size="small" type="button" :disabled="!!editingId" @click="addReferenciaAduana" />
          </div>
          <p class="giro-hint">
            <i class="pi pi-info-circle" /> Documentos de la operación de exportación: DUS, conocimiento de
            embarque (B/L), guía aérea (AWB), MIC/DTA o la resolución del SNA que califica el servicio.
          </p>
          <div v-for="referencia in draft.referenciasAduana" :key="referencia.key" class="form-row dscrcg-row">
            <label class="field field-grow">
              <span>Documento</span>
              <Select
                v-model="referencia.tipoDteRef"
                :options="REFERENCIAS_ADUANA"
                option-label="label"
                option-value="value"
                :disabled="!!editingId"
              />
            </label>
            <label class="field">
              <span>Folio / número</span>
              <InputNumber v-model="referencia.folioRef" :min="0" :use-grouping="false" fluid :disabled="!!editingId" />
            </label>
            <label class="field">
              <span>Fecha</span>
              <DatePicker v-model="referencia.fecha" date-format="dd/mm/yy" :disabled="!!editingId" />
            </label>
            <label class="field">
              <span>Razón</span>
              <InputText v-model="referencia.razon" placeholder="Ej: DUS" :maxlength="90" :disabled="!!editingId" />
            </label>
            <Button
              icon="pi pi-times"
              text
              severity="secondary"
              type="button"
              title="Quitar referencia"
              class="dscrcg-remove"
              :disabled="!!editingId"
              @click="removeReferenciaAduana(referencia.key)"
            />
          </div>
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
          <div v-if="hoja" class="hoja-ocupacion" :title="'El SII exige que el documento quepa en una sola hoja impresa'">
            <div class="hoja-ocupacion-texto">
              <span>Ocupación de la hoja: <strong>{{ hojaPct }} %</strong></span>
              <span v-if="!hoja.cabe" class="hoja-ocupacion-alerta">
                <i class="pi pi-exclamation-triangle" /> No cabe en una hoja: quite ítems, acorte descripciones o emita otro documento
              </span>
              <span v-else-if="hoja.itemFontSize < 8.5" class="muted">
                el detalle se imprime con letra reducida ({{ hoja.itemFontSize }} pt)
              </span>
            </div>
            <ProgressBar :value="hojaPct" :show-value="false" :class="{ 'hoja-llena': !hoja.cabe, 'hoja-justa': hoja.cabe && hoja.itemFontSize < 8.5 }" style="height: 6px" />
          </div>
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
            <div class="items-head" :class="{ 'items-liquidacion': esLiquidacion, 'items-exportacion': esExportacion }">
              <span class="col-producto">Producto</span>
              <span class="col-descripcion">Descripción</span>
              <span v-if="esLiquidacion" class="col-num">Documento</span>
              <span class="col-num">Cantidad</span>
              <span v-if="!esLiquidacion" class="col-unidad">Unidad</span>
              <span v-if="!esLiquidacion" class="col-num">Precio unit.</span>
              <template v-if="esExportacion">
                <span class="col-num">Dcto. %</span>
                <span class="col-num">Recargo %</span>
              </template>
              <span v-else class="col-num">{{ esLiquidacion ? 'Total línea' : 'Descuento' }}</span>
              <span class="col-exento">Exento</span>
              <span class="col-total">Total</span>
              <span class="col-remove"></span>
            </div>

            <div v-for="item in draft.items" :key="item.key" class="item-row" :class="{ 'items-liquidacion': esLiquidacion, 'items-exportacion': esExportacion }">
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
              <div v-if="esLiquidacion" class="col-num">
                <Select
                  v-model="item.tipoDocLiq"
                  :options="DOCUMENTOS_LIQUIDABLES"
                  option-label="label"
                  option-value="value"
                  placeholder="Tipo"
                />
              </div>
              <div class="col-num">
                <InputNumber v-model="item.cantidad" :min="0" fluid />
              </div>
              <div v-if="!esLiquidacion" class="col-unidad">
                <InputText v-model="item.unidad" :maxlength="4" placeholder="Un" fluid />
              </div>
              <div v-if="!esLiquidacion" class="col-num">
                <InputNumber
                  v-model="item.precioUnit"
                  :min="0"
                  mode="decimal"
                  :max-fraction-digits="esExportacion ? 4 : undefined"
                  fluid
                  :disabled="sinMontos"
                />
              </div>
              <template v-if="esExportacion">
                <!-- Exportación: los montos llevan decimales y el XSD solo
                     admite el descuento/recargo de línea como PORCENTAJE —
                     ver document.model.ts en el servidor. -->
                <div class="col-num">
                  <InputNumber v-model="item.descuentoPct" :min="0" :max="100" mode="decimal" :max-fraction-digits="2" suffix="%" fluid />
                </div>
                <div class="col-num">
                  <InputNumber v-model="item.recargoPct" :min="0" mode="decimal" :max-fraction-digits="2" suffix="%" fluid />
                </div>
              </template>
              <div v-else class="col-num">
                <!-- En una liquidación la línea resume documentos: el monto
                     viene dado (y puede ser negativo si es una nota de
                     crédito), no se calcula como cantidad × precio. -->
                <InputNumber v-if="esLiquidacion" v-model="item.montoLinea" mode="decimal" fluid />
                <InputNumber v-else v-model="item.descuento" :min="0" mode="decimal" fluid :disabled="sinMontos" />
              </div>
              <div class="col-exento">
                <ToggleSwitch v-model="item.exento" :disabled="draft.tipoDte === 34 || esExportacion" />
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

          <label v-if="draft.tipoDte !== 34 && !esExportacion" class="field" style="max-width: 260px; margin-top: 0.75rem">
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
          <div v-if="montosPreview.comision !== 0" class="totals-row">
            <span>Comisiones</span><span>−${{ montosPreview.comision.toLocaleString('es-CL') }}</span>
          </div>
          <div v-if="montosPreview.descuentoGlobal > 0" class="totals-row">
            <span>Subtotal afecto</span><span>${{ montosPreview.netoBruto.toLocaleString('es-CL') }}</span>
          </div>
          <div v-if="montosPreview.descuentoGlobal > 0" class="totals-row">
            <span>Dscto. global ({{ draft.descuentoGlobalPct }}%)</span>
            <span>-${{ montosPreview.descuentoGlobal.toLocaleString('es-CL') }}</span>
          </div>
          <div v-if="!esExportacion" class="totals-row"><span>Neto</span><span>${{ montosPreview.neto.toLocaleString('es-CL') }}</span></div>
          <div v-if="montosPreview.exento > 0" class="totals-row">
            <span>Exento</span>
            <span v-if="esExportacion">{{ formatMonto(montosPreview.exento, draft.exportacion.moneda) }}</span>
            <span v-else>${{ montosPreview.exento.toLocaleString('es-CL') }}</span>
          </div>
          <div v-if="!esExportacion" class="totals-row"><span>IVA (19%)</span><span>${{ montosPreview.iva.toLocaleString('es-CL') }}</span></div>
          <div class="totals-row totals-total">
            <span>Total</span>
            <span v-if="esExportacion">{{ formatMonto(montosPreview.total, draft.exportacion.moneda) }}</span>
            <span v-else>${{ montosPreview.total.toLocaleString('es-CL') }}</span>
          </div>
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
          <!-- Todo el diálogo va en la MONEDA del documento: los abonos de una
               exportación se registran en su moneda, no en pesos. Mostrar el
               total en dólares y el saldo en pesos hacía que la resta no
               cuadrara a la vista. -->
          <div class="pago-resumen-item">
            <span class="pago-resumen-label">Total documento</span>
            <span class="pago-resumen-value">{{ formatMonto(pagoDocument.montos.total, monedaDe(pagoDocument)) }}</span>
          </div>
          <div class="pago-resumen-item">
            <span class="pago-resumen-label">Abonado</span>
            <span class="pago-resumen-value pago-abonado">{{ formatMonto(pagoDocument.montoPagado, monedaDe(pagoDocument)) }}</span>
          </div>
          <!-- Las notas de crédito rebajan el saldo igual que un abono, así
               que tienen que estar en el resumen: si el saldo baja y acá solo
               figura lo abonado, la resta no cuadra y parece un error. -->
          <div v-if="creditosOf(pagoDocument).length > 0" class="pago-resumen-item">
            <span class="pago-resumen-label">Notas de crédito</span>
            <span class="pago-resumen-value pago-abonado">−{{ formatMonto(totalCreditos(pagoDocument), monedaDe(pagoDocument)) }}</span>
          </div>
          <div class="pago-resumen-item">
            <span class="pago-resumen-label">Saldo pendiente</span>
            <span class="pago-resumen-value pago-saldo">{{ formatMonto(saldoOrigenOf(pagoDocument), monedaDe(pagoDocument)) }}</span>
          </div>
          <div v-if="esMonedaExtranjera(pagoDocument)" class="pago-resumen-item">
            <span class="pago-resumen-label">Equivale a</span>
            <span class="pago-resumen-value">
              ${{ formatMoney(saldoOf(pagoDocument)) }}
              <span class="muted">al cambio {{ formatMoney(pagoDocument.exportacion?.tipoCambio ?? 0) }} del día de emisión</span>
            </span>
          </div>
        </div>

        <section v-if="creditosOf(pagoDocument).length > 0" class="pago-section">
          <h3 class="section-title">Notas de crédito aplicadas</h3>
          <p class="pago-empty">
            Rebajan lo que el cliente debe por este documento. No son abonos: no entraron como plata, corrigen
            lo facturado.
          </p>
          <ul class="pago-list">
            <li v-for="credito in creditosOf(pagoDocument)" :key="`${credito.tipoDte}-${credito.folio}`" class="pago-item">
              <span class="pago-item-detalle">
                <span class="pago-item-medio">{{ nombreCortoTipoDte(credito.tipoDte) }} N° {{ credito.folio }}</span>
              </span>
              <span class="pago-item-monto">−{{ formatMonto(credito.monto, monedaDe(pagoDocument)) }}</span>
            </li>
          </ul>
        </section>

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
              <span class="pago-item-monto">{{ formatMonto(pago.monto, monedaDe(pagoDocument)) }}</span>
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

        <section v-if="saldoOrigenOf(pagoDocument) > 0" class="pago-section">
          <h3 class="section-title">Registrar nuevo abono</h3>
          <div class="pago-form">
            <label class="field">
              <span>Monto</span>
              <InputNumber
                v-model="pagoMonto"
                :min="0"
                :max="saldoOrigenOf(pagoDocument)"
                mode="decimal"
                :max-fraction-digits="esMonedaExtranjera(pagoDocument) ? 2 : 0"
                :suffix="esMonedaExtranjera(pagoDocument) ? ` ${monedaDe(pagoDocument)}` : ''"
              />
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

    <Dialog v-model:visible="facturadaVisible" modal header="Marcar la guía como facturada" style="width: 520px">
      <p class="dialog-hint">
        Una guía que constituye venta arrastra su monto hasta que se factura. Al indicar qué documento la facturó, el
        Libro de Guías declara ese monto como modificado y el SII no cuenta la venta dos veces.
      </p>

      <label class="field">
        <span>Documento que la facturó</span>
        <Select
          v-model="facturadaDocId"
          :options="documentosQuePuedenFacturar"
          option-label="label"
          option-value="value"
          placeholder="Elige la factura o nota"
          filter
        />
      </label>

      <template #footer>
        <Button label="Cancelar" text @click="facturadaVisible = false" />
        <Button
          label="Marcar como facturada"
          icon="pi pi-file-check"
          :disabled="!facturadaDocId"
          :loading="guiaSending"
          @click="confirmFacturada"
        />
      </template>
    </Dialog>

    <Dialog v-model:visible="anularVisible" modal header="Anular la guía" style="width: 520px">
      <p class="dialog-hint">
        La guía queda anulada y su monto deja de estar vigente. Si ya se envió al SII, el Libro de Guías lo declara como
        anulación posterior al envío. No se puede deshacer.
      </p>

      <div class="anular-form">
        <label class="field">
          <span>Fecha de anulación</span>
          <DatePicker v-model="anularFecha" date-format="dd/mm/yy" />
        </label>
        <label class="field anular-motivo">
          <span>Motivo</span>
          <InputText v-model="anularMotivo" placeholder="Opcional — queda en el registro interno" />
        </label>
      </div>

      <template #footer>
        <Button label="Cancelar" text @click="anularVisible = false" />
        <Button label="Anular guía" icon="pi pi-ban" severity="danger" :loading="guiaSending" @click="confirmAnular" />
      </template>
    </Dialog>

    <Dialog
      v-model:visible="previewVisible"
      modal
      :header="previewDocument?.estado === 'draft' ? 'Revisar y emitir' : 'Vista previa'"
      style="width: 640px"
    >
      <FacturaPreview
        v-if="previewDocument"
        :document="previewDocument"
        :customer="receptorOf(previewDocument)"
        :organization="auth.currentOrganization"
      />

      <template #footer>
        <Button label="Cerrar" text @click="previewVisible = false" />
        <Button
          v-if="previewDocument"
          label="PDF como irá al SII"
          icon="pi pi-file-pdf"
          outlined
          :loading="downloadingPdf"
          @click="downloadPdf(previewDocument)"
        />
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
.hoja-ocupacion {
  margin: 0.25rem 0 0.75rem;
}

.hoja-ocupacion-texto {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  font-size: 0.82rem;
  margin-bottom: 0.3rem;
}

.hoja-ocupacion-alerta {
  color: var(--p-red-600);
}

.hoja-justa :deep(.p-progressbar-value) {
  background: var(--p-amber-500);
}

.hoja-llena :deep(.p-progressbar-value) {
  background: var(--p-red-500);
}

.correo-receptor {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  margin-top: 0.35rem;
  font-size: 0.78rem;
}

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

.estado-extra {
  margin-left: 0.35rem;
}

.dialog-hint {
  margin: 0 0 1rem;
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.anular-form {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}

.anular-motivo {
  flex: 1;
  min-width: 14rem;
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
  grid-template-columns: 1.2fr 1.8fr 5rem 4rem 7rem 6rem 4rem 7rem 2.25rem;
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

/* La liquidación cambia las columnas: aparece el documento que se liquida y
   el total de la línea, y desaparecen unidad, precio y descuento. */
.items-head.items-liquidacion,
.item-row.items-liquidacion {
  grid-template-columns: 1.1fr 1.6fr 11rem 5rem 8rem 4rem 7rem 2.25rem;
}

/* Exportación: en lugar del descuento en monto van dos columnas de
   porcentaje (descuento y recargo de línea). */
.items-head.items-exportacion,
.item-row.items-exportacion {
  grid-template-columns: 1.1fr 1.5fr 4.5rem 3.5rem 6rem 5rem 5rem 4rem 6.5rem 2.25rem;
}

/* Fila de recargo/descuento global o de referencia de aduana: los campos en
   línea con su botón de quitar al final, alineado con los inputs. */
.dscrcg-row {
  align-items: end;
}

.dscrcg-remove {
  margin-bottom: 0.15rem;
}

.comisiones-head,
.comisiones-row {
  display: grid;
  grid-template-columns: 8rem 1fr 7rem 7rem 7rem 2.25rem;
  gap: 0.5rem;
  align-items: center;
  padding: 0.5rem 0.75rem;
}

.comisiones-head {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border);
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
