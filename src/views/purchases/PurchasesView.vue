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
  PurchaseSiiAcuse,
  PurchaseWrite,
  Supplier
} from '@/types'
import {
  acuseFueraDePlazo,
  acuseNoAplicaPorContado,
  acuseSinRegistroEnSii,
  COD_RESP_EVENTO_PREVIO,
  EXPLICACION_DTE_CONTADO,
  EXPLICACION_PLAZO_VENCIDO,
  EXPLICACION_SIN_REGISTRO_EN_SII
} from '@/types'
import { acuseSegunSii, discrepanciaClasificacion, estadoVencimiento, fechaCorta, vencimientoDe } from '@/compras-sii'
import type { NominaFormato, NominaPago } from '@/types'
import { datosBancariosCompletos, descargarArchivoTexto, nombreBanco } from '@/pagos'
import { useAuthStore } from '@/stores/auth'

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

// Nombre del documento distinguiendo la factura exenta (tipo SII 34) de la
// afecta (33), como lo muestra el RCV. Las compras de hoy en adelante traen
// tipoDte desde el XML; las anteriores y las manuales se infieren por los
// montos, igual que hace el server para el acuse (tipoDteDeCompra): una
// factura sin neto ni IVA y con exento solo puede ser exenta.
// "MM-AAAA" del período del SII cuando no coincide con el mes de emisión.
function periodoSiiDistinto(p: Purchase): string | null {
  const periodo = p.siiRcv?.periodo
  if (!periodo) return null
  const f = new Date(p.fecha)
  const emision = `${f.getUTCFullYear()}${String(f.getUTCMonth() + 1).padStart(2, '0')}`
  if (periodo === emision) return null
  return `${periodo.slice(4)}-${periodo.slice(0, 4)}`
}

function nombreDocumento(p: Purchase): string {
  if (p.tipoDocumento !== 'factura') return tipoDocumentoLabel[p.tipoDocumento]
  const exenta = p.tipoDte === 34 || (p.tipoDte === undefined && p.montoNeto === 0 && p.montoIva === 0 && p.montoExento > 0)
  return exenta ? 'Factura exenta' : 'Factura'
}

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

function tooltipSinRegistro(acuse: PurchaseSiiAcuse): string {
  const intento = new Date(acuse.fecha).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })
  const reintentos = acuse.reintentos ? ` Reintentos automáticos: ${acuse.reintentos}.` : ''
  return `${EXPLICACION_SIN_REGISTRO_EN_SII} Último intento: ${intento}.${reintentos}`
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

// Lo que queda por pagarle al proveedor. Las compras anteriores a los abonos
// no tienen `montoPagado`: ahí manda el switch, que era todo o nada.
function abonadoDe(purchase: Purchase): number {
  if (typeof purchase.montoPagado === 'number') return purchase.montoPagado
  return purchase.pagado ? purchase.montoTotal : 0
}

function formatMoney(valor: number): string {
  return valor.toLocaleString('es-CL')
}

function saldoDe(purchase: Purchase): number {
  return Math.max(0, purchase.montoTotal - abonadoDe(purchase))
}

const selectedPurchases = ref<Purchase[]>([])

// ---- Abonos ----
const pagoVisible = ref(false)
const pagoPurchase = ref<Purchase | null>(null)
const pagoMonto = ref<number | null>(null)
const pagoFecha = ref<Date>(new Date())
const pagoMedio = ref('')
const pagoNota = ref('')
const pagoSending = ref(false)

const pagosDelDocumento = computed(() => pagoPurchase.value?.pagos ?? [])

// Una compra anterior a los abonos puede estar marcada pagada sin detalle:
// se dice, en vez de mostrar un historial vacío que parecería un error.
const pagadaSinDetalle = computed(
  () => !!pagoPurchase.value && abonadoDe(pagoPurchase.value) > 0 && pagosDelDocumento.value.length === 0
)

function abrirPagos(purchase: Purchase): void {
  pagoPurchase.value = purchase
  pagoMonto.value = saldoDe(purchase) || null
  pagoFecha.value = new Date()
  pagoMedio.value = ''
  pagoNota.value = ''
  pagoVisible.value = true
}

async function guardarPagos(pagos: Purchase['pagos']): Promise<void> {
  const purchase = pagoPurchase.value
  if (!purchase) return

  pagoSending.value = true
  try {
    const actualizada = await update(purchase._id, { pagos } as Partial<Purchase>)
    pagoPurchase.value = actualizada
    pagoMonto.value = saldoDe(actualizada) || null
  } catch (e) {
    toast.add({
      severity: 'error',
      summary: 'Error al registrar el abono',
      detail: e instanceof Error ? e.message : undefined,
      life: 4000
    })
  } finally {
    pagoSending.value = false
  }
}

async function agregarPago(): Promise<void> {
  if (!pagoPurchase.value || !pagoMonto.value || pagoMonto.value <= 0) return
  await guardarPagos([
    ...pagosDelDocumento.value,
    {
      monto: pagoMonto.value,
      fecha: pagoFecha.value.toISOString(),
      medio: pagoMedio.value || undefined,
      nota: pagoNota.value || undefined
    }
  ])
}

async function eliminarPago(indice: number): Promise<void> {
  await guardarPagos(pagosDelDocumento.value.filter((_, i) => i !== indice))
}

// ---- Nómina de pago masivo (server/src/services/pagos) ----
// Se paga el SALDO de cada factura seleccionada; el archivo se sube a mano
// al portal del banco y se confirma después en Nóminas de pago.
const auth = useAuthStore()
const nominaVisible = ref(false)
const nominaFormatos = ref<NominaFormato[]>([])
const nominaFormatoId = ref<string | null>(null)
const nominaFechaPago = ref<Date>(new Date())
const nominaGlosa = ref('')
const nominaConvenio = ref('')
const nominaGenerando = ref(false)

const nominaFormato = computed(() => nominaFormatos.value.find((f) => f.id === nominaFormatoId.value) ?? null)

// Las seleccionadas que efectivamente se pueden pagar: con saldo y de un
// tipo que se paga (una nota de crédito no se transfiere).
const nominaCandidatas = computed(() =>
  selectedPurchases.value.filter((p) => saldoDe(p) > 0 && ['factura', 'boleta', 'nota_debito'].includes(p.tipoDocumento))
)
const nominaSinDatos = computed(() => nominaCandidatas.value.filter((p) => !datosBancariosCompletos(supplierOf(p.supplierId))))
const nominaListas = computed(() => nominaCandidatas.value.filter((p) => datosBancariosCompletos(supplierOf(p.supplierId))))
const nominaTotal = computed(() => nominaListas.value.reduce((s, p) => s + saldoDe(p), 0))

async function openNomina(): Promise<void> {
  nominaVisible.value = true
  nominaGlosa.value = ''
  nominaFechaPago.value = new Date()
  if (nominaFormatos.value.length === 0) {
    try {
      nominaFormatos.value = (await feathersClient.service('nomina-formatos').find()) as NominaFormato[]
    } catch (e) {
      toast.add({ severity: 'error', summary: 'No se pudieron cargar los formatos de banco', detail: e instanceof Error ? e.message : undefined, life: 5000 })
    }
  }
  const org = auth.currentOrganization
  nominaFormatoId.value = org?.pagosMasivos?.formatoId ?? nominaFormatos.value[0]?.id ?? null
  nominaConvenio.value = org?.pagosMasivos?.codigoConvenio ?? '001'
}

async function generarNomina(): Promise<void> {
  if (!nominaFormatoId.value || nominaListas.value.length === 0) return
  nominaGenerando.value = true
  try {
    const nomina = (await feathersClient.service('nominas-pago').create({
      formatoId: nominaFormatoId.value,
      purchaseIds: nominaListas.value.map((p) => p._id),
      fechaPago: nominaFechaPago.value.toISOString(),
      glosa: nominaGlosa.value || undefined,
      codigoConvenio: nominaFormato.value?.pideConvenio ? nominaConvenio.value : undefined
    })) as NominaPago
    if (nomina.archivoContenido) descargarArchivoTexto(nomina.archivoNombre, nomina.archivoContenido, nomina.archivoMimeType)
    nominaVisible.value = false
    selectedPurchases.value = []
    toast.add({
      severity: 'success',
      summary: `Nómina N° ${nomina.numero} generada y descargada`,
      detail: `${nomina.items.length} documento(s), $${nomina.total.toLocaleString('es-CL')}. Súbela al portal del banco y confírmala en Nóminas de pago cuando esté pagada.`,
      life: 8000
    })
  } catch (e) {
    toast.add({ severity: 'error', summary: 'No se pudo generar la nómina', detail: e instanceof Error ? e.message : undefined, life: 9000 })
  } finally {
    nominaGenerando.value = false
  }
}

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
      label: `${nombreDocumento(p)} ${p.folio} — $${p.montoTotal.toLocaleString('es-CL')}`,
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

// El switch es el atajo para el caso más común —pagar todo de una— y por eso
// escribe ABONOS, no el derivado: `pagado` lo calcula el servidor a partir de
// ellos. Apagarlo borra los abonos, que es lo que significa "no está pagada".
async function togglePagado(purchase: Purchase): Promise<void> {
  const saldado = saldoDe(purchase) <= 0
  try {
    await update(purchase._id, {
      pagos: saldado ? [] : [{ monto: saldoDe(purchase), fecha: new Date().toISOString(), nota: 'Pago total' }]
    } as Partial<Purchase>)
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
        const r = await feathersClient
          .service('purchases-acuse-recibo')
          .create({ purchaseId: purchase._id, accion: acuseAccion.value })
        await fetchAll()
        acuseVisible.value = false
        // El servicio no lanza cuando el SII contesta con un código distinto
        // de 0 — la llamada funcionó, es el SII el que no pudo registrar.
        if (acuseSinRegistroEnSii(r)) {
          toast.add({
            severity: 'warn',
            summary: 'El SII aún no tiene este documento',
            detail: EXPLICACION_SIN_REGISTRO_EN_SII,
            life: 12000
          })
        } else if (acuseFueraDePlazo(r)) {
          toast.add({ severity: 'info', summary: 'Ya operó la aceptación tácita', detail: EXPLICACION_PLAZO_VENCIDO, life: 10000 })
        } else if (acuseNoAplicaPorContado(r)) {
          toast.add({ severity: 'info', summary: 'Factura al contado: no lleva acuse', detail: EXPLICACION_DTE_CONTADO, life: 10000 })
        } else if (r.codResp === COD_RESP_EVENTO_PREVIO) {
          toast.add({ severity: 'success', summary: 'El SII ya tenía registrada esta acción', detail: r.descResp, life: 4000 })
        } else if (r.codResp !== 0) {
          toast.add({
            severity: 'warn',
            summary: `El SII rechazó la acción (código ${r.codResp})`,
            detail: r.descResp,
            life: 8000
          })
        } else {
          toast.add({ severity: 'success', summary: 'Acción registrada ante el SII', life: 3000 })
        }
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

  const items: MenuItem[] = [
    { label: 'Editar', icon: 'pi pi-pencil', command: () => openEdit(purchase) },
    // También en las saldadas: el diálogo es el historial de abonos, no solo
    // el formulario — hay que poder consultarlo y corregirlo después.
    {
      label: saldoDe(purchase) > 0 ? 'Registrar abono' : 'Ver abonos',
      icon: 'pi pi-dollar',
      command: () => abrirPagos(purchase)
    }
  ]

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
      <Button
        label="Nómina de pago"
        icon="pi pi-money-bill"
        text
        :disabled="nominaCandidatas.length === 0"
        :title="nominaCandidatas.length === 0 ? 'Ninguna de las seleccionadas tiene saldo por pagar' : 'Generar el archivo de pago masivo para el banco'"
        @click="openNomina"
      />
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
            <span class="muted">{{ nombreDocumento(data) }}</span>
          </div>
        </template>
      </Column>

      <Column header="Fecha">
        <template #body="{ data }">
          <div class="stacked-cell">
            <span>{{ fechaCorta(data.fecha) }}</span>
            <!-- El SII asigna la compra al mes en que la recibió; si no es el
                 de emisión, se dice, porque es el mes en que cuenta para el
                 F29 y para Finanzas. -->
            <span v-if="periodoSiiDistinto(data)" class="muted" :title="`El SII la recibió en otro mes: cuenta en ${periodoSiiDistinto(data)} para el F29 y en Finanzas`">
              SII: {{ periodoSiiDistinto(data) }}
            </span>
          </div>
        </template>
      </Column>

      <!-- Antigüedad de la deuda por fila (Finanzas tiene el agregado). -->
      <Column header="Vencimiento">
        <template #body="{ data }">
          <div v-if="estadoVencimiento(data)" class="stacked-cell">
            <Tag :severity="estadoVencimiento(data)!.severity" :value="estadoVencimiento(data)!.value" :title="estadoVencimiento(data)!.title" />
            <span v-if="saldoDe(data) > 0" class="muted">{{ fechaCorta(vencimientoDe(data)) }}</span>
          </div>
          <span v-else class="muted">—</span>
        </template>
      </Column>

      <Column header="Total">
        <template #body="{ data }">${{ data.montoTotal.toLocaleString('es-CL') }}</template>
      </Column>

      <Column header="Pagado">
        <template #body="{ data }">
          <div class="stacked-cell">
            <ToggleSwitch :model-value="saldoDe(data) <= 0" @update:model-value="togglePagado(data)" />
            <!-- Un abono parcial no se ve en un switch: sin esto, la fila
                 diría "no pagada" igual que una en la que no se abonó nada. -->
            <span v-if="abonadoDe(data) > 0 && saldoDe(data) > 0" class="muted">
              abonado ${{ formatMoney(abonadoDe(data)) }}, quedan ${{ formatMoney(saldoDe(data)) }}
            </span>
          </div>
        </template>
      </Column>

      <Column header="Acuse SII">
        <template #body="{ data }">
          <div class="stacked-cell">
          <!-- Primero lo que el SII tiene registrado (siiRcv, lo traiga quien
               lo traiga); solo si no hay dato del RCV se muestra lo que
               Folio360 intentó (siiAcuse). -->
          <Tag
            v-if="acuseSegunSii(data)"
            :severity="acuseSegunSii(data)!.severity"
            :value="acuseSegunSii(data)!.value"
            :icon="acuseSegunSii(data)!.icon"
            :title="acuseSegunSii(data)!.title"
          />
          <!-- Código 9: el SII no tiene el DTE. Antes se veía como "Aceptado"
               en rojo, que no dice nada; ahora dice qué pasa y que se está
               reintentando solo. -->
          <Tag
            v-else-if="data.siiAcuse && acuseSinRegistroEnSii(data.siiAcuse)"
            severity="warn"
            icon="pi pi-clock"
            value="Sin registro en SII"
            :title="tooltipSinRegistro(data.siiAcuse)"
          />
          <!-- Código 27: DTE al contado o gratuito — el SII no admite eventos
               para esos, así que no es un rechazo ni algo pendiente. -->
          <Tag
            v-else-if="data.siiAcuse && acuseFueraDePlazo(data.siiAcuse)"
            severity="secondary"
            value="Aceptación tácita"
            :title="EXPLICACION_PLAZO_VENCIDO"
          />
          <Tag
            v-else-if="data.siiAcuse && acuseNoAplicaPorContado(data.siiAcuse)"
            severity="secondary"
            value="Contado, sin acuse"
            :title="EXPLICACION_DTE_CONTADO"
          />
          <Tag
            v-else-if="data.siiAcuse && data.siiAcuse.codResp !== 0 && data.siiAcuse.codResp !== COD_RESP_EVENTO_PREVIO"
            severity="danger"
            :value="`Rechazado por el SII (${data.siiAcuse.codResp})`"
            :title="data.siiAcuse.descResp"
          />
          <Tag
            v-else-if="data.siiAcuse"
            :severity="ACCIONES_DISPUTA.includes(data.siiAcuse.accion as PurchaseAccionSii) ? 'warn' : 'success'"
            :value="accionSiiLabel[data.siiAcuse.accion as PurchaseAccionSii]"
            :title="data.siiAcuse.descResp"
          />
          <span v-else-if="data.tipoDocumento === 'factura'" class="acuse-pendiente">Pendiente</span>
          <span v-else>—</span>
          <!-- Clasificación tributaria del SII distinta del tratamiento de
               IVA de acá: afecta el crédito que el SII propone en el F29. -->
          <Tag
            v-if="discrepanciaClasificacion(data)"
            :severity="discrepanciaClasificacion(data)!.severity"
            :value="discrepanciaClasificacion(data)!.value"
            :icon="discrepanciaClasificacion(data)!.icon"
            :title="discrepanciaClasificacion(data)!.title"
          />
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

    <Dialog v-model:visible="nominaVisible" modal header="Nómina de pago masivo" style="width: 720px">
      <div class="form-grid">
        <p class="acuse-hint">
          Se paga el <strong>saldo</strong> de cada documento. El archivo se descarga y se sube a mano al portal del banco;
          los abonos se registran cuando confirmes la nómina en <RouterLink to="/nominas-pago">Nóminas de pago</RouterLink>.
        </p>
        <div class="nomina-campos">
          <label class="field">
            <span>Banco / formato</span>
            <Select v-model="nominaFormatoId" :options="nominaFormatos" option-label="nombre" option-value="id" placeholder="Elige el banco" />
          </label>
          <label class="field">
            <span>Fecha de pago</span>
            <DatePicker v-model="nominaFechaPago" date-format="dd/mm/yy" show-icon icon-display="input" :min-date="new Date()" />
          </label>
          <label v-if="nominaFormato?.pideConvenio" class="field">
            <span>Código de convenio</span>
            <InputText v-model="nominaConvenio" inputmode="numeric" maxlength="3" placeholder="001" />
          </label>
          <label class="field">
            <span>Glosa (opcional)</span>
            <InputText v-model="nominaGlosa" maxlength="30" placeholder="Ej: Pago proveedores septiembre" />
          </label>
        </div>
        <p v-if="nominaFormato" class="muted">{{ nominaFormato.ayuda }}</p>

        <table class="nomina-tabla">
          <thead>
            <tr><th>Proveedor</th><th>Documento</th><th>Cuenta</th><th class="num">A pagar</th></tr>
          </thead>
          <tbody>
            <tr v-for="p in nominaListas" :key="p._id">
              <td>{{ supplierOf(p.supplierId)?.razonSocial ?? p.supplierId }}</td>
              <td>{{ nombreDocumento(p) }} {{ p.folio }}</td>
              <td class="muted">{{ nombreBanco(supplierOf(p.supplierId)?.datosBancarios?.banco) }} · {{ supplierOf(p.supplierId)?.datosBancarios?.numeroCuenta }}</td>
              <td class="num">${{ saldoDe(p).toLocaleString('es-CL') }}</td>
            </tr>
            <tr v-for="p in nominaSinDatos" :key="p._id" class="fila-falta">
              <td>{{ supplierOf(p.supplierId)?.razonSocial ?? p.supplierId }}</td>
              <td>{{ nombreDocumento(p) }} {{ p.folio }}</td>
              <td colspan="2">
                <Tag severity="warn" value="Sin datos bancarios" />
                <span class="muted"> queda fuera: completa banco y cuenta en <RouterLink to="/suppliers">Proveedores</RouterLink></span>
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td colspan="3"><strong>Total de la nómina ({{ nominaListas.length }} documento{{ nominaListas.length === 1 ? '' : 's' }})</strong></td>
              <td class="num"><strong>${{ nominaTotal.toLocaleString('es-CL') }}</strong></td>
            </tr>
          </tfoot>
        </table>

        <div class="form-actions">
          <Button label="Cancelar" text @click="nominaVisible = false" />
          <Button
            label="Generar y descargar archivo"
            icon="pi pi-download"
            :loading="nominaGenerando"
            :disabled="!nominaFormatoId || nominaListas.length === 0"
            @click="generarNomina"
          />
        </div>
      </div>
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
    <Dialog v-model:visible="pagoVisible" modal header="Abonos de la compra" style="width: 540px">
      <div v-if="pagoPurchase" class="pago-body">
        <div class="pago-resumen">
          <div class="pago-resumen-item">
            <span class="pago-resumen-label">Total</span>
            <span class="pago-resumen-value">${{ formatMoney(pagoPurchase.montoTotal) }}</span>
          </div>
          <div class="pago-resumen-item">
            <span class="pago-resumen-label">Abonado</span>
            <span class="pago-resumen-value pago-abonado">${{ formatMoney(abonadoDe(pagoPurchase)) }}</span>
          </div>
          <div class="pago-resumen-item">
            <span class="pago-resumen-label">Saldo</span>
            <span class="pago-resumen-value pago-saldo">${{ formatMoney(saldoDe(pagoPurchase)) }}</span>
          </div>
        </div>

        <section class="pago-section">
          <h3 class="section-title">Historial</h3>

          <p v-if="pagadaSinDetalle" class="pago-empty">
            Esta compra quedó marcada como pagada antes de que se guardara el detalle por abono, por eso no
            aparece desglosada.
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

        <section v-if="saldoDe(pagoPurchase) > 0" class="pago-section">
          <h3 class="section-title">Registrar abono</h3>
          <div class="pago-form">
            <label class="field">
              <span>Monto</span>
              <InputNumber v-model="pagoMonto" :min="0" :max="saldoDe(pagoPurchase)" :max-fraction-digits="0" fluid />
            </label>
            <label class="field">
              <span>Fecha</span>
              <DatePicker v-model="pagoFecha" date-format="dd/mm/yy" show-icon icon-display="input" fluid />
            </label>
            <label class="field">
              <span>Medio</span>
              <InputText v-model="pagoMedio" placeholder="Transferencia, cheque…" />
            </label>
            <label class="field">
              <span>Nota</span>
              <InputText v-model="pagoNota" />
            </label>
          </div>
          <div class="form-actions">
            <Button label="Agregar abono" icon="pi pi-plus" :loading="pagoSending" @click="agregarPago" />
          </div>
        </section>
      </div>
    </Dialog>
  </div>
</template>

<style scoped>
.pago-body { display: flex; flex-direction: column; gap: 1.1rem; }
.pago-resumen { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.75rem; background: #f8fafc; border-radius: 8px; padding: 0.85rem 1rem; }
.pago-resumen-item { display: flex; flex-direction: column; gap: 0.15rem; }
.pago-resumen-label { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; color: #94a3b8; font-weight: 700; }
.pago-resumen-value { font-weight: 700; font-variant-numeric: tabular-nums; }
.pago-abonado { color: #15803d; }
.pago-saldo { color: #b45309; }
.pago-section { display: flex; flex-direction: column; gap: 0.5rem; }
.section-title { margin: 0; font-size: 0.85rem; color: #475569; }
.pago-empty { margin: 0; font-size: 0.83rem; color: #64748b; }
.pago-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.25rem; }
.pago-item { display: grid; grid-template-columns: auto 1fr auto auto; align-items: center; gap: 0.6rem; padding: 0.35rem 0; border-bottom: 1px solid #f1f5f9; font-size: 0.85rem; }
.pago-item-fecha { color: #64748b; font-variant-numeric: tabular-nums; }
.pago-item-detalle { display: flex; flex-direction: column; }
.pago-item-nota { font-size: 0.75rem; color: #94a3b8; }
.pago-item-monto { font-weight: 650; font-variant-numeric: tabular-nums; }
.pago-form { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }

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
.nomina-campos { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0.75rem; }
.nomina-tabla { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
.nomina-tabla th, .nomina-tabla td { text-align: left; padding: 0.35rem 0.4rem; border-bottom: 1px solid #f1f4f8; }
.nomina-tabla .num { text-align: right; font-variant-numeric: tabular-nums; }
.nomina-tabla tfoot td { border-top: 2px solid #e2e8f0; border-bottom: none; }
.fila-falta td { color: #64748b; }
</style>
