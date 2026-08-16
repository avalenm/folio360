<script setup lang="ts">
import AyudaPagina from '@/components/AyudaPagina.vue'
import { AYUDA_PANORAMA } from '@/ayudaContenidos'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import Button from 'primevue/button'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { feathersClient } from '@/services/feathers'
import { useAuthStore } from '@/stores/auth'
import type { DteDocument, IncomingInvoice, Paginated, Purchase, Supplier } from '@/types'

const auth = useAuthStore()
const confirm = useConfirm()
const toast = useToast()
const documents = ref<DteDocument[]>([])
const purchases = ref<Purchase[]>([])
const suppliers = ref<Supplier[]>([])
const incomingInvoices = ref<IncomingInvoice[]>([])
const loading = ref(true)

const tipoDteLabel: Record<number, string> = {
  33: 'Factura',
  34: 'Factura exenta',
  56: 'Nota de débito',
  61: 'Nota de crédito'
}

const ESTADOS_EMITIDOS = ['pendiente_firma', 'firmado', 'enviado', 'aceptado', 'reparo']
const ESTADOS_ANULADOS = ['draft', 'rechazado', 'anulado']

function isSameMonth(dateStr: string): boolean {
  const date = new Date(dateStr)
  const now = new Date()
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()
}

// Cuánto aporta cada tipo de documento a las ventas del período:
//
//  +1  Factura (33), Factura Exenta (34) y Nota de Débito (56): la nota de
//      débito aumenta lo facturado.
//  -1  Nota de Crédito (61): rebaja una venta ya emitida (devolución,
//      descuento o anulación), así que RESTA. Sumarla infla las ventas, el
//      IVA y la cobranza al mismo tiempo.
//   0  Guía de Despacho (52): no es una venta tributaria. La venta la
//      documenta la factura que la respalda; contar ambas duplicaría.
//   0  Factura de Compra (46): la emitimos nosotros, pero documenta una
//      COMPRA — es plata que se le debe al proveedor, no una venta ni algo
//      por cobrar.
function signoVenta(tipoDte: number): number {
  if (tipoDte === 61 || tipoDte === 112) return -1
  if (tipoDte === 52 || tipoDte === 46) return 0
  return 1
}

// Los documentos de exportación (110/111/112) llevan sus montos en la
// MONEDA de la operación: se convierten a pesos con su tipo de cambio antes
// de sumarlos — mezclar dólares con pesos daría tarjetas mentirosas.
function totalClp(doc: DteDocument): number {
  const cambio = [110, 111, 112].includes(doc.tipoDte) ? (doc.exportacion?.tipoCambio ?? 0) : 1
  return Math.round(doc.montos.total * cambio)
}

function ivaClp(doc: DteDocument): number {
  return [110, 111, 112].includes(doc.tipoDte) ? 0 : doc.montos.iva
}

// Los documentos de certificación son pruebas: no son ventas reales y no
// pueden mezclarse con las de producción. Se muestran solo los del ambiente
// en que está la organización, igual que hace el Libro de Ventas.
const documentosDelAmbiente = computed(() =>
  documents.value.filter((doc) => doc.ambiente === auth.currentOrganization?.ambiente)
)

// El período tributario lo marca la fecha de EMISIÓN, no cuándo se creó el
// borrador: un documento preparado a fin de mes y emitido al mes siguiente
// pertenece al mes en que se emitió.
const documentosDelMes = computed(() =>
  documentosDelAmbiente.value.filter(
    (doc) =>
      !ESTADOS_ANULADOS.includes(doc.estado) &&
      signoVenta(doc.tipoDte) !== 0 &&
      isSameMonth(doc.fechaEmision ?? doc.createdAt)
  )
)

const ventasDelMes = computed(() =>
  documentosDelMes.value.reduce((sum, doc) => sum + signoVenta(doc.tipoDte) * totalClp(doc), 0)
)
const ivaDelMes = computed(() =>
  documentosDelMes.value.reduce((sum, doc) => sum + signoVenta(doc.tipoDte) * ivaClp(doc), 0)
)

// Una nota de crédito no es algo "por cobrar": rebaja lo que el cliente debe
// por OTRO documento. Se descuenta del saldo de la factura que referencia, no
// como una línea suelta — si se restara por su cuenta, seguiría restando para
// siempre incluso después de que la factura quedó pagada, y la cobranza
// terminaría en negativo.
const creditosPorDocumento = computed(() => {
  const porDocumento = new Map<string, number>()

  for (const doc of documentosDelAmbiente.value) {
    if ((doc.tipoDte !== 61 && doc.tipoDte !== 112) || !ESTADOS_EMITIDOS.includes(doc.estado)) continue

    // La primera referencia a un documento real (en certificación la primera
    // es "SET", que no apunta a ningún folio nuestro).
    const referencia = (doc.referencias ?? []).find((ref) => typeof ref.tipoDteRef === 'number')
    if (!referencia) continue

    const clave = `${referencia.tipoDteRef}-${referencia.folioRef}`
    porDocumento.set(clave, (porDocumento.get(clave) ?? 0) + totalClp(doc))
  }

  return porDocumento
})

function saldoPorCobrar(doc: DteDocument): number {
  const credito = doc.folio != null ? (creditosPorDocumento.value.get(`${doc.tipoDte}-${doc.folio}`) ?? 0) : 0
  // Nunca negativo: si las notas de crédito superan lo facturado, el cliente
  // no pasa a deberte menos que cero.
  return Math.max(0, totalClp(doc) - doc.montoPagado - credito)
}

const documentosPorCobrarList = computed(() =>
  documentosDelAmbiente.value.filter(
    (doc) =>
      signoVenta(doc.tipoDte) > 0 && ESTADOS_EMITIDOS.includes(doc.estado) && saldoPorCobrar(doc) > 0
  )
)

const porCobrar = computed(() => documentosPorCobrarList.value.reduce((sum, doc) => sum + saldoPorCobrar(doc), 0))

// Una Factura de Compra (46) la emitimos nosotros, pero documenta una compra:
// es deuda con el proveedor. Se cuenta acá, no en las ventas.
//
// Para que no se cuente dos veces, se excluyen las compras registradas a mano
// como 'factura_compra': son el mismo documento cargado por el otro lado. La
// fuente que manda es el DTE emitido, que es el documento tributario real.
const facturasDeCompraEmitidas = computed(() =>
  documentosDelAmbiente.value.filter(
    (doc) => doc.tipoDte === 46 && doc.montoPagado < doc.montos.total && ESTADOS_EMITIDOS.includes(doc.estado)
  )
)

const comprasPorPagarList = computed(() =>
  purchases.value.filter((purchase) => !purchase.pagado && purchase.tipoDocumento !== 'factura_compra')
)

const porPagar = computed(
  () =>
    comprasPorPagarList.value.reduce((sum, purchase) => sum + purchase.montoTotal, 0) +
    facturasDeCompraEmitidas.value.reduce((sum, doc) => sum + (doc.montos.total - doc.montoPagado), 0)
)

function formatCurrency(value: number): string {
  return value.toLocaleString('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 })
}

// Las cuatro tarjetas comparten estructura — declararlas como datos evita
// repetir el mismo bloque de marcado cuatro veces (que es lo que hacía que
// se desalinearan entre sí).
const stats = computed(() => [
  {
    label: 'Ventas del mes',
    value: ventasDelMes.value,
    icon: 'pi-chart-line',
    tone: 'brand',
    hint: 'Ventas netas del MES CALENDARIO en curso (facturas menos notas de crédito, por fecha de emisión). Exportaciones convertidas a pesos.',
    note: `${documentosDelMes.value.length} este mes`,
    to: '/documents',
    linkLabel: 'Ver documentos'
  },
  {
    label: 'Por cobrar',
    value: porCobrar.value,
    icon: 'pi-wallet',
    tone: 'success',
    hint: 'TODO lo impago histórico (sin límite de período), neto de notas de crédito y abonos — por eso puede superar a las ventas del mes. El detalle con vencimientos está en Finanzas.',
    note: `${documentosPorCobrarList.value.length} pendientes`,
    to: '/documents',
    linkLabel: 'Ver documentos'
  },
  {
    label: 'IVA débito del mes',
    value: ivaDelMes.value,
    icon: 'pi-percentage',
    tone: 'neutral',
    hint: 'Solo el IVA de tus VENTAS del mes en curso. El IVA a pagar (débito menos crédito de compras) está en Finanzas.',
    note: '19% tasa',
    to: '/documents',
    linkLabel: 'Ver documentos'
  },
  {
    label: 'Facturas por pagar',
    value: porPagar.value,
    icon: 'pi-shopping-cart',
    tone: 'warning',
    hint: 'TODO lo impago a proveedores (sin límite de período): compras registradas más facturas de compra emitidas. El detalle con vencimientos está en Finanzas.',
    note: `${comprasPorPagarList.value.length} pendientes`,
    to: '/purchases',
    linkLabel: 'Ver compras'
  }
])

const recentDocuments = computed(() => documents.value.slice(0, 5))

const ESTADO_LABELS: Record<string, string> = {
  draft: 'Borrador',
  pendiente_firma: 'Pend. firma',
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

// Facturas de proveedor que todavía no tienen acuse/reclamo registrado ante
// el SII. Solo aplica a facturas (no boletas ni notas) — ver
// services/purchases/acuse-recibo.service.ts.
const facturasPorRecepcionar = computed(() =>
  purchases.value.filter((purchase) => purchase.tipoDocumento === 'factura' && !purchase.siiAcuse)
)

function supplierName(id: string): string {
  return suppliers.value.find((s) => s._id === id)?.razonSocial ?? id
}

const recepcionandoId = ref<string | null>(null)

function confirmRecepcionar(purchase: Purchase): void {
  confirm.require({
    message:
      'Esto registra la aceptación del documento ante el SII con el certificado digital de la organización — es una acción legal real y no se puede deshacer. ¿Aceptar esta factura?',
    header: 'Confirmar recepción',
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Aceptar factura',
    acceptProps: { severity: 'danger' },
    accept: async () => {
      recepcionandoId.value = purchase._id
      try {
        await feathersClient.service('purchases-acuse-recibo').create({ purchaseId: purchase._id, accion: 'ACD' })
        await refreshPurchases()
        toast.add({ severity: 'success', summary: 'Factura recepcionada ante el SII', life: 3000 })
      } catch (e) {
        toast.add({
          severity: 'error',
          summary: 'Error al recepcionar',
          detail: e instanceof Error ? e.message : undefined,
          life: 5000
        })
      } finally {
        recepcionandoId.value = null
      }
    }
  })
}

// Trae la colección COMPLETA paginando de a 100 (el máximo del servidor).
// Las tarjetas del Panorama suman sobre todos los documentos: pedir una
// sola página dejaba cada tarjeta calculada sobre un subconjunto distinto
// y los totales no cuadraban entre sí ni con las páginas de detalle
// (encontrado en vivo con 200+ documentos acumulados).
async function fetchColeccionCompleta<T>(service: string): Promise<T[]> {
  const items: T[] = []
  let skip = 0

  for (;;) {
    const res = (await feathersClient
      .service(service)
      .find({ query: { $limit: 100, $skip: skip, $sort: { createdAt: -1 } } })) as Paginated<T> | T[]
    const data = Array.isArray(res) ? res : res.data
    items.push(...data)
    if (Array.isArray(res) || data.length === 0 || items.length >= res.total) return items
    skip += data.length
  }
}

async function refreshPurchases(): Promise<void> {
  purchases.value = await fetchColeccionCompleta<Purchase>('purchases')
}

onMounted(async () => {
  try {
    // `purchases`/`incoming-invoices` son contador+ en el servidor (ver
    // hooks/require-role.ts) — pedirlos igual para un vendedor haría fallar
    // todo el Promise.all (incluyendo documents/suppliers) por una sola
    // llamada rechazada. Se omiten directamente: esas secciones simplemente
    // no aplican a ese rol.
    const [documentsResult, purchasesResult, suppliersResult, incomingResult] = await Promise.all([
      fetchColeccionCompleta<DteDocument>('documents'),
      auth.hasMinRole('contador') ? fetchColeccionCompleta<Purchase>('purchases') : Promise.resolve([]),
      fetchColeccionCompleta<Supplier>('suppliers'),
      auth.hasMinRole('contador')
        ? fetchColeccionCompleta<IncomingInvoice>('incoming-invoices')
        : Promise.resolve([])
    ])
    documents.value = documentsResult
    purchases.value = purchasesResult
    suppliers.value = suppliersResult
    incomingInvoices.value = incomingResult
  } finally {
    loading.value = false
  }
})

// Panorama no usa useResource (junta 3 fuentes con lógica propia), así que
// se suscribe a mano — mismo mecanismo que useResource.ts, ver la nota ahí
// sobre por qué esto importa (estado SII y facturas recibidas cambian en
// segundo plano, sin que el usuario haga nada).
function upsertDocument(doc: DteDocument): void {
  const exists = documents.value.some((d) => d._id === doc._id)
  documents.value = exists ? documents.value.map((d) => (d._id === doc._id ? doc : d)) : [doc, ...documents.value]
}
function upsertPurchase(purchase: Purchase): void {
  const exists = purchases.value.some((p) => p._id === purchase._id)
  purchases.value = exists
    ? purchases.value.map((p) => (p._id === purchase._id ? purchase : p))
    : [purchase, ...purchases.value]
}
function dropPurchase(purchase: Purchase): void {
  purchases.value = purchases.value.filter((p) => p._id !== purchase._id)
}
function addIncoming(invoice: IncomingInvoice): void {
  if (incomingInvoices.value.some((i) => i._id === invoice._id)) return
  incomingInvoices.value = [invoice, ...incomingInvoices.value]
}
function dropIncoming(invoice: IncomingInvoice): void {
  incomingInvoices.value = incomingInvoices.value.filter((i) => i._id !== invoice._id)
}

const documentsService = feathersClient.service('documents')
const purchasesService = feathersClient.service('purchases')
const incomingInvoicesService = feathersClient.service('incoming-invoices')

documentsService.on('created', upsertDocument)
documentsService.on('patched', upsertDocument)
documentsService.on('updated', upsertDocument)
purchasesService.on('created', upsertPurchase)
purchasesService.on('patched', upsertPurchase)
purchasesService.on('updated', upsertPurchase)
purchasesService.on('removed', dropPurchase)
incomingInvoicesService.on('created', addIncoming)
incomingInvoicesService.on('removed', dropIncoming)

onUnmounted(() => {
  documentsService.removeListener('created', upsertDocument)
  documentsService.removeListener('patched', upsertDocument)
  documentsService.removeListener('updated', upsertDocument)
  purchasesService.removeListener('created', upsertPurchase)
  purchasesService.removeListener('patched', upsertPurchase)
  purchasesService.removeListener('updated', upsertPurchase)
  purchasesService.removeListener('removed', dropPurchase)
  incomingInvoicesService.removeListener('created', addIncoming)
  incomingInvoicesService.removeListener('removed', dropIncoming)
})
</script>

<template>
  <div class="dashboard">
    <header class="dash-header">
      <h1 class="page-title">Panorama <AyudaPagina titulo="Panorama" :secciones="AYUDA_PANORAMA" /></h1>
      <p class="page-subtitle">Resumen de {{ auth.currentOrganization?.razonSocial }}</p>
    </header>

    <div class="stat-grid">
      <article v-for="stat in stats" :key="stat.label" class="stat-card surface-card">
        <div class="stat-top">
          <span class="stat-label">{{ stat.label }}</span>
          <i class="pi pi-info-circle stat-info" :title="stat.hint" />
        </div>

        <div class="stat-value-row">
          <span class="stat-icon" :class="`stat-icon-${stat.tone}`"><i class="pi" :class="stat.icon" /></span>
          <span class="stat-value">{{ loading ? '—' : formatCurrency(stat.value) }}</span>
        </div>

        <footer class="stat-footer">
          <span class="stat-note">{{ stat.note }}</span>
          <router-link :to="stat.to" class="stat-link">
            {{ stat.linkLabel }} <i class="pi pi-arrow-right" />
          </router-link>
        </footer>
      </article>
    </div>

    <section v-if="auth.hasMinRole('contador')" class="recent surface-card">
      <header class="recent-header">
        <h2 class="section-title">
          Facturas recibidas
          <span v-if="incomingInvoices.length > 0" class="count-badge">{{ incomingInvoices.length }}</span>
        </h2>
        <router-link to="/facturas-recibidas" class="stat-link">Revisar <i class="pi pi-arrow-right" /></router-link>
      </header>

      <p v-if="!loading && incomingInvoices.length === 0" class="recent-empty">
        No hay facturas nuevas detectadas en la Casilla de Intercambio.
      </p>

      <ul v-else class="recibida-list">
        <li v-for="factura in incomingInvoices" :key="factura._id" class="recibida-item">
          <span class="recibida-meta">
            <span class="recibida-proveedor">{{ factura.emisorRazonSocial ?? factura.emisorRut }}</span>
            <span class="recibida-sub">
              {{ tipoDteLabel[factura.tipoDte] ?? `Tipo ${factura.tipoDte}` }} folio {{ factura.folio }} ·
              {{ new Date(factura.fechaEmision).toLocaleDateString('es-CL') }}
            </span>
          </span>
          <span class="recibida-monto">{{ formatCurrency(factura.montoTotal) }}</span>
          <router-link :to="'/facturas-recibidas'"><Button label="Revisar" icon="pi pi-eye" size="small" text /></router-link>
        </li>
      </ul>
    </section>

    <section class="recent surface-card">
      <header class="recent-header">
        <h2 class="section-title">
          Facturas recibidas por recepcionar
          <span v-if="facturasPorRecepcionar.length > 0" class="count-badge">{{ facturasPorRecepcionar.length }}</span>
        </h2>
        <router-link to="/purchases" class="stat-link">Ver compras <i class="pi pi-arrow-right" /></router-link>
      </header>

      <p v-if="!loading && facturasPorRecepcionar.length === 0" class="recent-empty">
        No hay facturas pendientes de recepcionar.
      </p>

      <ul v-else class="recibida-list">
        <li v-for="factura in facturasPorRecepcionar" :key="factura._id" class="recibida-item">
          <span class="recibida-meta">
            <span class="recibida-proveedor">{{ supplierName(factura.supplierId) }}</span>
            <span class="recibida-sub">
              Folio {{ factura.folio }} · {{ new Date(factura.fecha).toLocaleDateString('es-CL') }}
            </span>
          </span>
          <span class="recibida-monto">{{ formatCurrency(factura.montoTotal) }}</span>
          <Button
            label="Recepcionar"
            icon="pi pi-check"
            size="small"
            :loading="recepcionandoId === factura._id"
            @click="confirmRecepcionar(factura)"
          />
        </li>
      </ul>
    </section>

    <section class="recent surface-card">
      <header class="recent-header">
        <h2 class="section-title">Documentos recientes</h2>
        <router-link to="/documents" class="stat-link">Ver todos <i class="pi pi-arrow-right" /></router-link>
      </header>

      <p v-if="!loading && recentDocuments.length === 0" class="recent-empty">
        Todavía no hay documentos emitidos.
      </p>

      <ul v-else class="recent-list">
        <li v-for="doc in recentDocuments" :key="doc._id" class="recent-item">
          <span class="recent-folio">{{ doc.folio ? `N° ${doc.folio}` : 'Borrador' }}</span>
          <span class="recent-date">{{ new Date(doc.fechaEmision ?? doc.createdAt).toLocaleDateString('es-CL') }}</span>
          <span class="recent-amount">{{ formatCurrency(doc.montos.total) }}</span>
          <span class="recent-state" :class="`recent-state-${doc.estado}`">{{ estadoLabel(doc.estado) }}</span>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.dashboard {
  display: flex;
  flex-direction: column;
  gap: 1.75rem;
}

.dash-header .page-title {
  margin-bottom: 0;
}

/* ---------- Tarjetas de indicador ---------- */
.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 1rem;
}

.stat-card {
  padding: 1.25rem 1.35rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  transition:
    box-shadow 0.18s ease,
    border-color 0.18s ease;
}

.stat-card:hover {
  border-color: var(--card-border-strong);
  box-shadow: var(--card-shadow-raised);
}

.stat-top {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.stat-label {
  font-size: var(--text-sm);
  font-weight: 550;
  color: var(--text-secondary);
}

.stat-info {
  font-size: 0.75rem;
  color: #cfd4dc;
  cursor: help;
}

.stat-value-row {
  display: flex;
  align-items: center;
  gap: 0.7rem;
}

/* Ícono contenido en una pastilla suave: da presencia sin competir con
   la cifra, que es el dato que realmente importa. */
.stat-icon {
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
}

.stat-icon .pi {
  font-size: 0.95rem;
}

.stat-icon-brand {
  background: var(--accent-soft);
  color: var(--accent);
}

.stat-icon-success {
  background: var(--success-soft);
  color: var(--success);
}

.stat-icon-neutral {
  background: var(--neutral-soft);
  color: var(--text-secondary);
}

.stat-icon-warning {
  background: var(--warning-soft);
  color: var(--warning);
}

.stat-value {
  font-size: var(--text-display);
  font-weight: 650;
  letter-spacing: -0.03em;
  color: var(--text-primary);
  line-height: 1.1;
}

.stat-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding-top: 0.85rem;
  border-top: 1px solid var(--card-border);
}

.stat-note {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  white-space: nowrap;
}

/* Enlace secundario: mismo color de marca que el resto de las acciones,
   en minúscula y sin negrita para no competir con la cifra. */
.stat-link {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: var(--text-xs);
  font-weight: 550;
  color: var(--accent);
  white-space: nowrap;
  transition: opacity 0.14s ease;
}

.stat-link .pi {
  font-size: 0.65rem;
}

.stat-link:hover {
  opacity: 0.7;
}

/* ---------- Facturas recibidas por recepcionar ---------- */
.count-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.25rem;
  height: 1.25rem;
  padding: 0 0.35rem;
  margin-left: 0.4rem;
  border-radius: 999px;
  background: var(--warning-soft);
  color: var(--warning);
  font-size: var(--text-xs);
  font-weight: 650;
}

.recibida-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.recibida-item {
  display: grid;
  grid-template-columns: 1fr auto auto;
  align-items: center;
  gap: 1rem;
  padding: 0.8rem 0;
  border-bottom: 1px solid #f2f4f7;
}

.recibida-item:last-child {
  border-bottom: none;
}

.recibida-meta {
  display: flex;
  flex-direction: column;
  line-height: 1.3;
  min-width: 0;
}

.recibida-proveedor {
  font-weight: 600;
  color: var(--text-primary);
}

.recibida-sub {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.recibida-monto {
  font-weight: 600;
  color: var(--text-primary);
}

/* ---------- Documentos recientes ---------- */
.recent {
  padding: 1.25rem 1.35rem 0.5rem;
}

.recent-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 0.85rem;
  border-bottom: 1px solid var(--card-border);
}

.section-title {
  margin: 0;
  font-size: var(--text-md);
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text-primary);
}

.recent-empty {
  margin: 0;
  padding: 1.75rem 0;
  text-align: center;
  font-size: var(--text-base);
  color: var(--text-tertiary);
}

.recent-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.recent-item {
  display: grid;
  grid-template-columns: 5.5rem 7rem 1fr 7rem;
  align-items: center;
  gap: 1rem;
  padding: 0.8rem 0;
  border-bottom: 1px solid #f2f4f7;
  font-size: var(--text-base);
}

.recent-item:last-child {
  border-bottom: none;
}

.recent-folio {
  font-weight: 600;
  color: var(--text-primary);
}

.recent-date {
  color: var(--text-secondary);
}

.recent-amount {
  font-weight: 600;
  color: var(--text-primary);
  text-align: right;
}

.recent-state {
  justify-self: end;
  font-size: var(--text-xs);
  font-weight: 550;
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
  background: var(--neutral-soft);
  color: var(--text-secondary);
}

.recent-state-firmado,
.recent-state-aceptado,
.recent-state-enviado {
  background: var(--success-soft);
  color: var(--success);
}

.recent-state-rechazado,
.recent-state-anulado {
  background: var(--danger-soft);
  color: var(--danger);
}

.recent-state-reparo {
  background: var(--warning-soft);
  color: var(--warning);
}
</style>
