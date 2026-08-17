<script setup lang="ts">
import AyudaPagina from '@/components/AyudaPagina.vue'
import { computed, onMounted, ref } from 'vue'
import { feathersClient } from '@/services/feathers'
import { useAuthStore } from '@/stores/auth'
import type { Customer, DteDocument, Paginated, Purchase, Supplier } from '@/types'
import type { SeccionAyuda } from '@/components/AyudaPagina.vue'
import {
  GLOSA_CREDITO_SIN_APLICAR,
  agingDe,
  cuentasPorCobrar,
  documentosVigentes,
  esNotaDeCompra,
  ivaClp,
  lineasPorPagar,
  rankingDe,
  signoVenta,
  totalClp
} from '@/cuentas'

// Tablero financiero: evolución mensual, cuentas por cobrar y por pagar con
// antigüedad POR VENCIMIENTO (no por emisión: una factura a 30 días emitida
// ayer no está atrasada), el desglose documento por documento de lo que se
// debe, y el IVA estimado del mes (débito − crédito).
//
// Las reglas de qué documento suma y cuál resta viven en cuentas.ts, no acá:
// esta pantalla y el Panorama las tenían duplicadas y se descuadraban entre
// sí. Lo propio de esta vista es la evolución mensual y el IVA.

const auth = useAuthStore()
const loading = ref(true)
const documents = ref<DteDocument[]>([])
const purchases = ref<Purchase[]>([])
const customers = ref<Customer[]>([])
const suppliers = ref<Supplier[]>([])

async function fetchTodo<T>(service: string, select?: string[]): Promise<T[]> {
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

const docsEmitidos = computed(() => documentosVigentes(documents.value, auth.currentOrganization?.ambiente))

// ---- Evolución mensual (últimos 12 meses) ----
function claveMes(fecha: string | Date): string {
  const d = new Date(fecha)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const meses = computed(() => {
  const lista: string[] = []
  const hoy = new Date()
  for (let i = 11; i >= 0; i--) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1)
    lista.push(claveMes(d))
  }
  return lista
})

const evolucion = computed(() => {
  const ventas = new Map<string, number>()
  const compras = new Map<string, number>()

  for (const doc of docsEmitidos.value) {
    const signo = esNotaDeCompra(doc) ? 0 : signoVenta(doc.tipoDte)
    const mes = claveMes(doc.fechaEmision ?? doc.createdAt)
    if (signo !== 0) ventas.set(mes, (ventas.get(mes) ?? 0) + signo * totalClp(doc))
    if (doc.tipoDte === 46) compras.set(mes, (compras.get(mes) ?? 0) + doc.montos.total)
    // Las NC/ND que corrigen facturas de compra ajustan las compras del mes.
    if (esNotaDeCompra(doc)) {
      const signoNota = doc.tipoDte === 61 || doc.tipoDte === 112 ? -1 : 1
      compras.set(mes, (compras.get(mes) ?? 0) + signoNota * doc.montos.total)
    }
  }
  for (const compra of purchases.value) {
    if (compra.tipoDocumento === 'factura_compra') continue // ya contada como DTE 46
    const mes = claveMes(compra.fecha)
    const signo = compra.tipoDocumento === 'nota_credito' ? -1 : 1
    compras.set(mes, (compras.get(mes) ?? 0) + signo * compra.montoTotal)
  }

  const maximo = Math.max(1, ...meses.value.map((m) => Math.max(ventas.get(m) ?? 0, compras.get(m) ?? 0)))
  return meses.value.map((mes) => {
    const v = ventas.get(mes) ?? 0
    const c = compras.get(mes) ?? 0
    return { mes, ventas: v, compras: c, margen: v - c, altoVentas: Math.max(0, (v / maximo) * 100), altoCompras: Math.max(0, (c / maximo) * 100) }
  })
})

// ---- Cuentas por cobrar y por pagar (aging por vencimiento) ----
// Las líneas son la unidad: el aging, el ranking por contraparte y el
// desglose de abajo salen todos de la MISMA lista que suma el total, así que
// no pueden contradecirse entre sí ni contra el Panorama (ver cuentas.ts).
const cobranza = computed(() => cuentasPorCobrar(docsEmitidos.value, customers.value))
const lineasCobrar = computed(() => cobranza.value.lineas)
const lineasPagar = computed(() => lineasPorPagar(docsEmitidos.value, purchases.value, suppliers.value))

const porCobrar = computed(() => ({ aging: agingDe(lineasCobrar.value), ranking: rankingDe(lineasCobrar.value) }))
const porPagar = computed(() => ({ aging: agingDe(lineasPagar.value), ranking: rankingDe(lineasPagar.value) }))

// El desglose se ordena por monto: lo que más pesa en el total es lo primero
// que uno quiere ver cuando el número no calza con lo que esperaba.
const desglosePagar = computed(() => [...lineasPagar.value].sort((a, b) => b.monto - a.monto))

// El mes en curso es la última columna de la evolución.
const mesActual = computed(() => evolucion.value[evolucion.value.length - 1])

const posicionNeta = computed(() => porCobrar.value.aging.total - porPagar.value.aging.total)

// ---- IVA estimado del mes (débito − crédito) ----
const ivaMes = computed(() => {
  const mesActual = claveMes(new Date())
  let debito = 0
  let credito = 0
  for (const doc of docsEmitidos.value) {
    if (claveMes(doc.fechaEmision ?? doc.createdAt) !== mesActual) continue
    const signo = signoVenta(doc.tipoDte)
    if (signo !== 0) debito += signo * ivaClp(doc)
    if (doc.tipoDte === 46) credito += doc.montos.iva
  }
  for (const compra of purchases.value) {
    if (compra.tipoDocumento === 'factura_compra' || claveMes(compra.fecha) !== mesActual) continue
    const signo = compra.tipoDocumento === 'nota_credito' ? -1 : 1
    credito += signo * compra.montoIva
  }
  return { debito, credito, neto: debito - credito }
})

function fm(valor: number): string {
  return valor.toLocaleString('es-CL')
}

function nombreMes(clave: string): string {
  const [a, m] = clave.split('-')
  return `${['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][Number(m) - 1]} ${a.slice(2)}`
}

const AYUDA_FINANZAS: SeccionAyuda[] = [
  {
    titulo: '¿Qué se muestra aquí?',
    texto:
      'El estado financiero del negocio: evolución mensual de ventas y compras, todo lo que te deben y todo lo que debes con su antigüedad, y el IVA estimado del mes.'
  },
  {
    titulo: 'Cómo se calcula',
    items: [
      { nombre: 'Vencimientos', descripcion: 'Fecha de emisión + plazo pactado del cliente (ficha del cliente); sin pacto rigen los 30 días de la Ley 21.131. "Por vencer" es deuda sana; los tramos vencidos son la que hay que cobrar.' },
      { nombre: 'Notas de crédito', descripcion: 'Rebajan el saldo de la factura que referencian, no cuentan como línea aparte.' },
      { nombre: 'De dónde sale el "por pagar"', descripcion: 'De DOS lugares: las compras que registras (página Compras) y las facturas de compra que emites tú por cambio de sujeto, que viven en Documentos. El desglose de abajo muestra cada documento y en qué pantalla está.' },
      { nombre: 'Certificación', descripcion: 'Los documentos y compras de prueba nunca se suman a los de producción: cada uno cuenta solo en su ambiente.' },
      { nombre: 'Exportaciones', descripcion: 'Se convierten a pesos con el tipo de cambio del documento.' },
      { nombre: 'IVA estimado', descripcion: 'Débito (ventas del mes) menos crédito (compras del mes): lo que se pagaría en el F29. Es referencial — el definitivo depende de los tratamientos de IVA de cada compra.' },
      { nombre: 'Liquidaciones (43)', descripcion: 'No se cuentan como venta ni cobranza: su total es la rendición al mandante, no ingreso propio.' },
      { nombre: 'Posición neta', descripcion: 'Por cobrar menos por pagar: el capital de trabajo que tienes en la calle.' }
    ]
  }
]

onMounted(async () => {
  try {
    const [docs, compras, clientes, proveedores] = await Promise.all([
      fetchTodo<DteDocument>('documents', ['tipoDte', 'folio', 'ambiente', 'estado', 'montos', 'montoPagado', 'fechaEmision', 'createdAt', 'referencias', 'exportacion', 'retencionIvaCompra', 'customerId', 'supplierId', 'guiaFacturada', 'trackId']),
      auth.hasMinRole('contador') ? fetchTodo<Purchase>('purchases') : Promise.resolve([]),
      fetchTodo<Customer>('customers', ['razonSocial', 'plazoPagoDias']),
      fetchTodo<Supplier>('suppliers', ['razonSocial'])
    ])
    documents.value = docs
    purchases.value = compras
    customers.value = clientes
    suppliers.value = proveedores
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div>
    <h1 class="page-title">Finanzas <AyudaPagina titulo="Finanzas" :secciones="AYUDA_FINANZAS" /></h1>
    <p v-if="loading" class="cargando">Calculando…</p>

    <template v-else>
      <h2 class="grupo-titulo">Este mes</h2>
      <div class="tarjetas">
        <div class="tarjeta">
          <span class="etiqueta">Ventas netas</span>
          <span class="valor">${{ fm(mesActual.ventas) }}</span>
          <span class="detalle">mes en curso, por fecha de emisión</span>
        </div>
        <div class="tarjeta">
          <span class="etiqueta">Compras</span>
          <span class="valor">${{ fm(mesActual.compras) }}</span>
          <span class="detalle">mes en curso</span>
        </div>
        <div class="tarjeta">
          <span class="etiqueta">Margen</span>
          <span class="valor" :class="mesActual.margen >= 0 ? 'positivo' : 'negativo'">${{ fm(mesActual.margen) }}</span>
          <span class="detalle">ventas − compras</span>
        </div>
        <div class="tarjeta">
          <span class="etiqueta">IVA estimado del mes</span>
          <span class="valor">${{ fm(ivaMes.neto) }}</span>
          <span class="detalle">débito ${{ fm(ivaMes.debito) }} − crédito ${{ fm(ivaMes.credito) }}</span>
        </div>
      </div>

      <h2 class="grupo-titulo">Acumulado histórico (todo lo pendiente)</h2>
      <div class="tarjetas">
        <div class="tarjeta">
          <span class="etiqueta">Por cobrar (total)</span>
          <span class="valor">${{ fm(porCobrar.aging.total) }}</span>
          <span class="detalle">vencido: ${{ fm(porCobrar.aging.total - porCobrar.aging.porVencer) }}</span>
        </div>
        <div class="tarjeta">
          <span class="etiqueta">Por pagar (total)</span>
          <span class="valor">${{ fm(porPagar.aging.total) }}</span>
          <span class="detalle">vencido: ${{ fm(porPagar.aging.total - porPagar.aging.porVencer) }}</span>
        </div>
        <div class="tarjeta">
          <span class="etiqueta">Posición neta</span>
          <span class="valor" :class="posicionNeta >= 0 ? 'positivo' : 'negativo'">${{ fm(posicionNeta) }}</span>
          <span class="detalle">por cobrar − por pagar</span>
        </div>
      </div>

      <section class="panel">
        <h2>Evolución mensual (12 meses)</h2>
        <div class="grafico">
          <div v-for="fila in evolucion" :key="fila.mes" class="columna" :title="`Ventas $${fm(fila.ventas)} · Compras $${fm(fila.compras)} · Margen $${fm(fila.margen)}`">
            <div class="barras">
              <div class="barra ventas" :style="{ height: fila.altoVentas + '%' }" />
              <div class="barra compras" :style="{ height: fila.altoCompras + '%' }" />
            </div>
            <span class="mes">{{ nombreMes(fila.mes) }}</span>
          </div>
        </div>
        <div class="leyenda">
          <span><i class="cuadro ventas" /> Ventas netas</span>
          <span><i class="cuadro compras" /> Compras</span>
        </div>
      </section>

      <div class="dos-columnas">
        <section class="panel">
          <h2>Por cobrar — antigüedad</h2>
          <table class="tabla-aging">
            <tbody>
              <tr><td>Por vencer</td><td class="num sano">${{ fm(porCobrar.aging.porVencer) }}</td></tr>
              <tr><td>Vencido 1–30 días</td><td class="num">${{ fm(porCobrar.aging.v1a30) }}</td></tr>
              <tr><td>Vencido 31–60 días</td><td class="num alerta">${{ fm(porCobrar.aging.v31a60) }}</td></tr>
              <tr><td>Vencido 61–90 días</td><td class="num alerta">${{ fm(porCobrar.aging.v61a90) }}</td></tr>
              <tr><td>Vencido +90 días</td><td class="num critico">${{ fm(porCobrar.aging.vMas90) }}</td></tr>
            </tbody>
          </table>
          <h3>Quién te debe</h3>
          <table class="tabla-ranking">
            <tbody>
              <tr v-for="fila in porCobrar.ranking" :key="fila.nombre">
                <td>{{ fila.nombre }}</td>
                <td class="num">${{ fm(fila.saldo) }}</td>
                <td class="num" :class="{ critico: fila.vencido > 0 }">{{ fila.vencido > 0 ? `vencido $${fm(fila.vencido)}` : 'al día' }}</td>
              </tr>
              <tr v-if="porCobrar.ranking.length === 0"><td colspan="3" class="vacio">Nada pendiente de cobro 🎉</td></tr>
            </tbody>
          </table>

          <!-- Notas de crédito que no alcanzaron a descontarse de ninguna
               factura. No entran al total a propósito (rebajarían la cobranza
               para siempre), pero tampoco pueden desaparecer sin decir nada:
               son plata a favor del cliente que no está reflejada. -->
          <template v-if="cobranza.creditosSinAplicar.length > 0">
            <h3>Notas de crédito sin aplicar</h3>
            <p class="detalle">
              No se descuentan del total de arriba porque no se pudieron asociar a un saldo por cobrar. Vale la pena
              revisarlas.
            </p>
            <table class="tabla-ranking">
              <tbody>
                <tr v-for="credito in cobranza.creditosSinAplicar" :key="credito.id">
                  <td>{{ credito.descripcion }}</td>
                  <td>{{ credito.contraparte }}</td>
                  <td class="num">${{ fm(credito.monto) }}</td>
                  <td class="detalle">{{ GLOSA_CREDITO_SIN_APLICAR[credito.motivo] }}</td>
                </tr>
              </tbody>
            </table>
          </template>
        </section>

        <section class="panel">
          <h2>Por pagar — antigüedad</h2>
          <table class="tabla-aging">
            <tbody>
              <tr><td>Por vencer</td><td class="num sano">${{ fm(porPagar.aging.porVencer) }}</td></tr>
              <tr><td>Vencido 1–30 días</td><td class="num">${{ fm(porPagar.aging.v1a30) }}</td></tr>
              <tr><td>Vencido 31–60 días</td><td class="num alerta">${{ fm(porPagar.aging.v31a60) }}</td></tr>
              <tr><td>Vencido 61–90 días</td><td class="num alerta">${{ fm(porPagar.aging.v61a90) }}</td></tr>
              <tr><td>Vencido +90 días</td><td class="num critico">${{ fm(porPagar.aging.vMas90) }}</td></tr>
            </tbody>
          </table>
          <h3>A quién le debes</h3>
          <table class="tabla-ranking">
            <tbody>
              <tr v-for="fila in porPagar.ranking" :key="fila.nombre">
                <td>{{ fila.nombre }}</td>
                <td class="num">${{ fm(fila.saldo) }}</td>
                <td class="num" :class="{ critico: fila.vencido > 0 }">{{ fila.vencido > 0 ? `vencido $${fm(fila.vencido)}` : 'al día' }}</td>
              </tr>
              <tr v-if="porPagar.ranking.length === 0"><td colspan="3" class="vacio">Nada pendiente de pago 🎉</td></tr>
            </tbody>
          </table>
        </section>
      </div>

      <!-- El desglose: de dónde sale cada peso del total, y en qué pantalla
           está cada documento. La columna "Dónde" existe porque la mitad de
           esta lista NO está en Compras (las facturas de compra las emites
           tú, así que viven en Documentos) — no saberlo era exactamente lo
           que hacía imposible cuadrar el total. -->
      <section class="panel">
        <h2>Por pagar — documento por documento</h2>
        <p class="detalle">
          Todo lo que suma el total de arriba, de mayor a menor. Las notas de crédito aparecen en negativo
          porque rebajan la deuda.
        </p>
        <table class="tabla-ranking">
          <thead>
            <tr>
              <th>Documento</th>
              <th>Proveedor</th>
              <th class="num">Monto</th>
              <th>Dónde</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="linea in desglosePagar" :key="linea.id">
              <td>{{ linea.descripcion }}</td>
              <td>{{ linea.contraparte }}</td>
              <td class="num" :class="{ sano: linea.monto < 0 }">${{ fm(linea.monto) }}</td>
              <td>
                <router-link :to="linea.verEn === 'compras' ? '/purchases' : '/documents'">
                  {{ linea.verEn === 'compras' ? 'Compras' : 'Documentos' }}
                </router-link>
              </td>
            </tr>
            <tr v-if="desglosePagar.length === 0"><td colspan="4" class="vacio">Nada pendiente de pago 🎉</td></tr>
          </tbody>
          <tfoot v-if="desglosePagar.length > 0">
            <tr>
              <td colspan="2"><strong>Total por pagar</strong></td>
              <td class="num"><strong>${{ fm(porPagar.aging.total) }}</strong></td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </section>
    </template>
  </div>
</template>

<style scoped>
.page-title { margin: 0 0 1.25rem; font-size: 1.4rem; }
.cargando { color: var(--text-secondary, #64748b); }
.grupo-titulo { margin: 0 0 0.6rem; font-size: 0.78rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; }
.tarjetas { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-bottom: 1rem; }
.tarjeta { background: #fff; border-radius: 10px; padding: 1.1rem 1.25rem; display: flex; flex-direction: column; gap: 0.3rem; }
.etiqueta { font-size: 0.8rem; color: #64748b; font-weight: 600; }
.valor { font-size: 1.45rem; font-weight: 750; }
.positivo { color: #15803d; }
.negativo { color: #b91c1c; }
.detalle { font-size: 0.78rem; color: #64748b; }
.panel { background: #fff; border-radius: 10px; padding: 1.25rem; margin-bottom: 1rem; }
.panel h2 { margin: 0 0 1rem; font-size: 1rem; }
.panel h3 { margin: 1.1rem 0 0.5rem; font-size: 0.85rem; color: #475569; }
.grafico { display: flex; align-items: flex-end; gap: 0.6rem; height: 180px; }
.columna { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 0.3rem; height: 100%; }
.barras { flex: 1; width: 100%; display: flex; align-items: flex-end; justify-content: center; gap: 3px; }
.barra { width: 40%; border-radius: 3px 3px 0 0; min-height: 1px; }
.barra.ventas, .cuadro.ventas { background: #4f46e5; }
.barra.compras, .cuadro.compras { background: #f59e0b; }
.mes { font-size: 0.68rem; color: #64748b; }
.leyenda { display: flex; gap: 1.25rem; margin-top: 0.75rem; font-size: 0.78rem; color: #475569; }
.cuadro { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; }
.dos-columnas { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 1rem; }
.tabla-aging, .tabla-ranking { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
.tabla-aging td, .tabla-ranking td, .tabla-ranking th { padding: 0.35rem 0.25rem; border-bottom: 1px solid #f1f4f8; }
.tabla-ranking th { text-align: left; font-size: 0.78rem; color: #64748b; font-weight: 600; }
.tabla-ranking tfoot td { border-bottom: none; border-top: 2px solid #e2e8f0; padding-top: 0.5rem; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.sano { color: #15803d; }
.alerta { color: #b45309; }
.critico { color: #b91c1c; font-weight: 650; }
.vacio { color: #64748b; text-align: center; padding: 0.75rem 0; }
</style>
