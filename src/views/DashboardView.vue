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
import { formatMonto, type ResumenCuentas } from '@/cuentas'

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

// Las cifras las calcula el SERVIDOR y llegan sumadas (ver
// server/src/services/cuentas/calculo.ts). Esta pantalla ya no se trae la
// colección de documentos para sumarla: pide un objeto con números.
const resumen = ref<ResumenCuentas | null>(null)

const ventasDelMes = computed(() => resumen.value?.mes.ventas ?? 0)
const ivaDelMes = computed(() => resumen.value?.mes.ivaDebito ?? 0)
const documentosDelMes = computed(() => resumen.value?.mes.documentos ?? 0)
const porCobrar = computed(() => resumen.value?.porCobrar.total ?? 0)
const porPagar = computed(() => resumen.value?.porPagar.total ?? 0)

// Qué parte del por cobrar está en moneda extranjera: ese pedazo del total
// quedó fijado al cambio del día de emisión, así que no es exactamente lo que
// se va a cobrar. El detalle está en Finanzas.
const exposicionCobrar = computed(() => resumen.value?.porCobrar.exposicion ?? [])

function formatCurrency(value: number): string {
  return value.toLocaleString('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 })
}

// Las cuatro tarjetas comparten estructura — declararlas como datos evita
// repetir el mismo bloque de marcado cuatro veces (que es lo que hacía que
// se desalinearan entre sí).
const statsDelMes = computed(() => [
  {
    label: 'Ventas del mes',
    value: ventasDelMes.value,
    icon: 'pi-chart-line',
    tone: 'brand',
    hint: 'Ventas netas del MES CALENDARIO en curso (facturas menos notas de crédito, por fecha de emisión). Exportaciones convertidas a pesos.',
    note: `${documentosDelMes.value} este mes`,
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
  }
])

// Acumulado histórico: sin límite de período — deuda viva total.
const statsAcumulado = computed(() => [
  {
    label: 'Por cobrar',
    value: porCobrar.value,
    icon: 'pi-wallet',
    tone: 'success',
    hint: 'TODO lo impago histórico (sin límite de período), neto de notas de crédito y abonos — por eso puede superar a las ventas del mes. El detalle documento por documento está en Finanzas.',
    note:
      exposicionCobrar.value.length > 0
        ? `${resumen.value?.porCobrar.documentos ?? 0} documentos · incluye ${exposicionCobrar.value.map((e: ResumenCuentas['porCobrar']['exposicion'][number]) => formatMonto(e.monto, e.moneda)).join(' + ')}`
        : `${resumen.value?.porCobrar.documentos ?? 0} documentos`,
    to: '/finanzas',
    linkLabel: 'Ver en Finanzas'
  },
  {
    label: 'Facturas por pagar',
    value: porPagar.value,
    icon: 'pi-shopping-cart',
    tone: 'warning',
    // El conteo cuenta TODAS las líneas del total, no solo las compras: decir
    // "4 pendientes" al lado de un total que incluye además las facturas de
    // compra emitidas es lo que hacía imposible cuadrar el número contra la
    // página de Compras.
    hint: 'TODO lo impago a proveedores (sin límite de período): las compras registradas MÁS las facturas de compra que emitiste tú (esas viven en Documentos, no en Compras). El detalle documento por documento está en Finanzas.',
    note: `${resumen.value?.porPagar.documentos ?? 0} documentos`,
    to: '/finanzas',
    linkLabel: 'Ver en Finanzas'
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

async function fetchColeccionCompleta<T>(service: string, select?: string[]): Promise<T[]> {
  // Solo los campos que los cálculos usan: sin $select cada documento viaja
  // con su XML firmado completo y sus ítems (~10-30 KB c/u) — varios MB para
  // sumar cuatro números, que era lo que hacía lenta la página. La primera
  // página revela el total y el resto se pide EN PARALELO.
  const query = (skip: number): Record<string, unknown> => ({
    $limit: 100,
    $skip: skip,
    $sort: { createdAt: -1 },
    ...(select ? { $select: select } : {})
  })

  const primera = (await feathersClient.service(service).find({ query: query(0) })) as Paginated<T> | T[]
  if (Array.isArray(primera)) return primera

  const items = [...primera.data]
  const pendientes: Promise<Paginated<T> | T[]>[] = []
  for (let skip = 100; skip < primera.total; skip += 100) {
    pendientes.push(feathersClient.service(service).find({ query: query(skip) }) as Promise<Paginated<T> | T[]>)
  }
  for (const res of await Promise.all(pendientes)) {
    items.push(...(Array.isArray(res) ? res : res.data))
  }
  return items
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
    const [resumenResult, documentsResult, purchasesResult, suppliersResult, incomingResult] = await Promise.all([
      // Un objeto con los totales ya sumados, en vez de miles de documentos
      // para sumarlos acá.
      feathersClient.service('resumen-cuentas').find() as Promise<ResumenCuentas>,
      // Los recientes para la tabla del final: 5 filas, no la colección.
      fetchColeccionCompleta<DteDocument>('documents', ['tipoDte', 'folio', 'estado', 'montos', 'fechaEmision', 'createdAt', 'customerId', 'supplierId', 'trackId']),
      auth.hasMinRole('contador') ? fetchColeccionCompleta<Purchase>('purchases') : Promise.resolve([]),
      fetchColeccionCompleta<Supplier>('suppliers'),
      auth.hasMinRole('contador')
        ? fetchColeccionCompleta<IncomingInvoice>('incoming-invoices')
        : Promise.resolve([])
    ])
    resumen.value = resumenResult
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

    <div class="grupos-fila">
      <div class="grupo-box">
    <h2 class="grupo-titulo">Este mes</h2>
    <div class="stat-grid">
      <article v-for="stat in statsDelMes" :key="stat.label" class="stat-card surface-card">
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
      </div>
      <div class="grupo-box">
    <h2 class="grupo-titulo">Acumulado histórico (todo lo pendiente)</h2>
    <div class="stat-grid">
      <article v-for="stat in statsAcumulado" :key="stat.label" class="stat-card surface-card">
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
      </div>
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
.grupos-fila { display: flex; gap: 1rem; flex-wrap: wrap; }
.grupo-box { flex: 1; min-width: 420px; }
.grupo-titulo {
  margin: 0 0 0.6rem;
  font-size: 0.78rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #64748b;
}

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
