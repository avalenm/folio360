<script setup lang="ts">
import AyudaPagina from '@/components/AyudaPagina.vue'
import { computed, onMounted, ref } from 'vue'
import Select from 'primevue/select'
import { feathersClient } from '@/services/feathers'
import type { SeccionAyuda } from '@/components/AyudaPagina.vue'
import {
  DIAS_PARA_REVISAR_INCOBRABLE,
  GLOSA_CREDITO_SIN_APLICAR,
  formatMonto,
  type ResumenCuentas
} from '@/cuentas'

// Tablero financiero: evolución mensual, cuentas por cobrar y por pagar con
// antigüedad POR VENCIMIENTO (no por emisión: una factura a 30 días emitida
// ayer no está atrasada), el desglose documento por documento de lo que se
// debe, y el IVA estimado del mes.
//
// Los números NO se calculan acá: llegan sumados del servicio
// `resumen-cuentas` (ver server/src/services/cuentas/calculo.ts). Esta
// pantalla y el Panorama tenían las reglas duplicadas y se descuadraban entre
// sí; ahora las dos muestran lo mismo porque piden lo mismo.

const loading = ref(true)
const resumen = ref<ResumenCuentas | null>(null)

// Con valores por defecto en vez de `undefined`: la plantilla los usa antes
// de que llegue la respuesta, y un cero se muestra bien mientras carga.
const AGING_CERO = { total: 0, porVencer: 0, v1a30: 0, v31a60: 0, v61a90: 0, vMas90: 0 }
const CUENTA_VACIA = { total: 0, documentos: 0, aging: AGING_CERO, ranking: [], lineas: [] }

const porCobrar = computed(() => resumen.value?.porCobrar ?? { ...CUENTA_VACIA, exposicion: [], creditosSinAplicar: [] })
const porPagar = computed(() => resumen.value?.porPagar ?? CUENTA_VACIA)
const exposicionCobrar = computed(() => resumen.value?.porCobrar.exposicion ?? [])
const creditosSinAplicar = computed(() => resumen.value?.porCobrar.creditosSinAplicar ?? [])
const desglosePagar = computed(() => resumen.value?.porPagar.lineas ?? [])
const ivaMes = computed(() => ({
  debito: resumen.value?.mes.ivaDebito ?? 0,
  credito: resumen.value?.mes.ivaCredito ?? 0,
  neto: resumen.value?.mes.ivaNeto ?? 0,
  usoComun: resumen.value?.mes.ivaUsoComun ?? 0,
  factor: resumen.value?.mes.factorProporcionalidad ?? 1,
  sinCredito: resumen.value?.mes.ivaSinDerechoACredito ?? 0
}))
const posicionNeta = computed(() => resumen.value?.posicionNeta ?? 0)

// El IVA que la empresa puso de su bolsillo por facturas que no le pagaron.
const AGING_CERO_IVA = { total: 0, porVencer: 0, v1a30: 0, v31a60: 0, v61a90: 0, vMas90: 0 }
const ivaFinanciado = computed(
  () => resumen.value?.ivaFinanciado ?? { enterado: 0, porEnterar: 0, aging: AGING_CERO_IVA, lineas: [] }
)

// Las que llevan tanto tiempo impagas que ya no parecen un desfase de
// cobranza. No se afirma que califiquen para recuperar el IVA: eso tiene
// requisitos que esta app no puede evaluar. Solo se señalan para revisarlas.
const paraRevisar = computed(() =>
  ivaFinanciado.value.lineas.filter((l) => l.enterado && l.diasVencido > DIAS_PARA_REVISAR_INCOBRABLE)
)

const ivaParaRevisar = computed(() => paraRevisar.value.reduce((suma, l) => suma + l.iva, 0))

// La evolución llega con los montos; el alto de cada barra es presentación,
// así que se calcula acá.
const evolucion = computed(() => {
  const meses = resumen.value?.evolucion ?? []
  const maximo = Math.max(1, ...meses.map((m) => Math.max(m.ventas, m.compras)))
  return meses.map((m) => ({
    ...m,
    altoVentas: Math.max(0, (m.ventas / maximo) * 100),
    altoCompras: Math.max(0, (m.compras / maximo) * 100)
  }))
})

// ---- Selector de mes ----
// Por omisión el mes en curso (la última columna de la evolución). Elegir
// otro re-pide el resumen al servidor con ?mes=AAAA-MM: el bloque de
// ventas/IVA se recalcula para ese período; el aging y la posición neta
// siguen siendo la foto de hoy (no tendría sentido "lo pendiente de julio").
const mesSeleccionado = ref<string | null>(null)
const cambiandoMes = ref(false)

const opcionesMes = computed(() =>
  [...evolucion.value].reverse().map((m) => ({ label: nombreMesLargo(m.mes), value: m.mes }))
)

const esMesEnCurso = computed(() => {
  const ultimo = evolucion.value[evolucion.value.length - 1]?.mes
  return !mesSeleccionado.value || mesSeleccionado.value === ultimo
})

async function cambiarMes(): Promise<void> {
  cambiandoMes.value = true
  try {
    resumen.value = (await feathersClient
      .service('resumen-cuentas')
      .find({ query: mesSeleccionado.value ? { mes: mesSeleccionado.value } : {} })) as ResumenCuentas
  } finally {
    cambiandoMes.value = false
  }
}

// Ventas/compras/margen del mes elegido salen de la evolución (que siempre
// trae los 12 meses); el IVA sale del bloque `mes` recalculado en el server.
const mesActual = computed(() => {
  const porClave = evolucion.value.find((m) => m.mes === mesSeleccionado.value)
  return porClave ?? evolucion.value[evolucion.value.length - 1]
})

function fm(valor: number): string {
  return valor.toLocaleString('es-CL')
}

function nombreMes(clave: string): string {
  const [a, m] = clave.split('-')
  return `${['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][Number(m) - 1]} ${a.slice(2)}`
}

function nombreMesLargo(clave: string): string {
  const [a, m] = clave.split('-')
  const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
  return `${meses[Number(m) - 1]} ${a}`
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
      { nombre: 'Selector de mes', descripcion: 'Las tarjetas del período (ventas, compras, margen, IVA) se pueden ver para cualquiera de los últimos 12 meses. El resto de la página (por cobrar/pagar, aging, posición neta) siempre es la foto de HOY: lo pendiente no tiene "mes".' },
      { nombre: 'Vencimientos', descripcion: 'Fecha de emisión + plazo pactado del cliente (ficha del cliente); sin pacto rigen los 30 días de la Ley 21.131. "Por vencer" es deuda sana; los tramos vencidos son la que hay que cobrar.' },
      { nombre: 'Notas de crédito', descripcion: 'Rebajan el saldo de la factura que referencian, no cuentan como línea aparte.' },
      { nombre: 'De dónde sale el "por pagar"', descripcion: 'De DOS lugares: las compras que registras (página Compras) y las facturas de compra que emites tú por cambio de sujeto, que viven en Documentos. El desglose de abajo muestra cada documento y en qué pantalla está.' },
      { nombre: 'Certificación', descripcion: 'Los documentos y compras de prueba nunca se suman a los de producción: cada uno cuenta solo en su ambiente.' },
      { nombre: 'Exportaciones', descripcion: 'Los totales van en pesos, convertidos con el tipo de cambio del DÍA DE EMISIÓN de cada documento — es lo único sumable y lo que calza con lo que declaras al SII. Junto a cada documento se muestra su moneda real, y acá aparece aparte cuánto del total depende del tipo de cambio.' },
      { nombre: 'IVA estimado', descripcion: 'Débito (ventas del mes) menos crédito (compras del mes): lo que se pagaría en el F29. Es referencial.' },
      { nombre: 'IVA de uso común', descripcion: 'El de compras que sirven a la vez a ventas afectas y exentas. Da crédito solo en la proporción de ventas afectas del mes (el factor). OJO: el factor legal se acumula desde enero del año comercial, así que este es una estimación del mes — el definitivo lo determina quien declara.' },
      { nombre: 'IVA sin derecho a crédito', descripcion: 'Se pagó pero no se descuenta (gastos rechazados, entregas gratuitas, facturas fuera de plazo). Se informa aparte porque es un costo real que no aparece en ninguna otra cifra.' },
      { nombre: 'Liquidaciones (43)', descripcion: 'No se cuentan como venta ni cobranza: su total es la rendición al mandante, no ingreso propio.' },
      { nombre: 'Posición neta', descripcion: 'Por cobrar menos por pagar: el capital de trabajo que tienes en la calle.' },
      { nombre: 'IVA que estás financiando', descripcion: 'El IVA de tus ventas se declara y se paga por la FECHA DE EMISIÓN, no por la de cobro. Si el cliente no te paga, ese 19% igual salió de tu caja. Se separa lo ya enterado al SII (plata que pusiste) de lo del mes en curso (que todavía no pagas). Se prorratea: si te pagaron la mitad de una factura, financias la mitad de su IVA.' },
      { nombre: 'Facturas con mucha mora', descripcion: 'Se señalan para que las revises con tu contador. El SII permite recuperar el IVA de deudas incobrables bajo ciertas condiciones, pero los requisitos hay que evaluarlos caso a caso — la app no determina si califican.' }
    ]
  }
]

onMounted(async () => {
  try {
    resumen.value = (await feathersClient.service('resumen-cuentas').find()) as ResumenCuentas
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
      <div class="grupo-cabecera">
        <h2 class="grupo-titulo">{{ esMesEnCurso ? 'Este mes' : nombreMesLargo(mesActual.mes) }}</h2>
        <Select
          v-model="mesSeleccionado"
          :options="opcionesMes"
          option-label="label"
          option-value="value"
          :placeholder="opcionesMes[0]?.label"
          :loading="cambiandoMes"
          size="small"
          @change="cambiarMes"
        />
      </div>
      <div class="tarjetas" :class="{ atenuado: cambiandoMes }">
        <div class="tarjeta">
          <span class="etiqueta">Ventas netas</span>
          <span class="valor">${{ fm(mesActual.ventas) }}</span>
          <span class="detalle">{{ esMesEnCurso ? 'mes en curso' : nombreMesLargo(mesActual.mes).toLowerCase() }}, por fecha de emisión</span>
        </div>
        <div class="tarjeta">
          <span class="etiqueta">Compras</span>
          <span class="valor">${{ fm(mesActual.compras) }}</span>
          <span class="detalle">{{ esMesEnCurso ? 'mes en curso' : nombreMesLargo(mesActual.mes).toLowerCase() }}</span>
        </div>
        <div class="tarjeta">
          <span class="etiqueta">Margen</span>
          <span class="valor" :class="mesActual.margen >= 0 ? 'positivo' : 'negativo'">${{ fm(mesActual.margen) }}</span>
          <span class="detalle">ventas − compras</span>
        </div>
        <div class="tarjeta">
          <span class="etiqueta">{{ esMesEnCurso ? 'IVA estimado del mes' : `IVA estimado de ${nombreMesLargo(mesActual.mes).toLowerCase()}` }}</span>
          <span class="valor">${{ fm(ivaMes.neto) }}</span>
          <span class="detalle">débito ${{ fm(ivaMes.debito) }} − crédito ${{ fm(ivaMes.credito) }}</span>
          <!-- El uso común da crédito solo en la proporción de ventas
               afectas: sin decirlo, el crédito no cuadra con la suma del IVA
               de las compras del mes. -->
          <span v-if="ivaMes.usoComun !== 0" class="detalle">
            incluye ${{ fm(Math.round(ivaMes.usoComun * ivaMes.factor)) }} de uso común
            (${{ fm(ivaMes.usoComun) }} × factor {{ ivaMes.factor.toFixed(3) }})
          </span>
          <span v-if="ivaMes.sinCredito !== 0" class="detalle">
            ${{ fm(ivaMes.sinCredito) }} de IVA pagado SIN derecho a crédito, que no se descuenta
          </span>
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
          <div v-if="exposicionCobrar.length > 0" class="exposicion">
            <strong>En moneda extranjera</strong>
            <div v-for="fila in exposicionCobrar" :key="fila.moneda" class="exposicion-fila">
              <span>{{ formatMonto(fila.monto, fila.moneda) }}</span>
              <span class="detalle">${{ fm(fila.clp) }} al cambio de emisión</span>
            </div>
            <span class="detalle">
              Ya está incluido en el total de arriba. Se muestra aparte porque esos pesos se fijaron el día de
              emisión: lo que finalmente cobres depende de cómo se mueva la moneda.
            </span>
          </div>

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
          <template v-if="creditosSinAplicar.length > 0">
            <h3>Notas de crédito sin aplicar</h3>
            <p class="detalle">
              No se descuentan del total de arriba porque no se pudieron asociar a un saldo por cobrar. Vale la pena
              revisarlas.
            </p>
            <table class="tabla-ranking">
              <tbody>
                <tr v-for="credito in creditosSinAplicar" :key="credito.id">
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

      <!-- El IVA que la empresa financió. Va antes del desglose de deudas
           porque es el hallazgo menos evidente de toda la pantalla: el IVA de
           una venta se entera al SII con la EMISIÓN, no con el cobro, así que
           una factura impaga significa plata puesta de tu bolsillo. -->
      <section class="panel">
        <h2>IVA que estás financiando</h2>
        <p class="detalle">
          El IVA de tus ventas se declara y se paga por la fecha de emisión, no por la de cobro. Lo de abajo es
          el IVA de facturas que emitiste y todavía no te pagan.
        </p>

        <div class="iva-tarjetas">
          <!-- El color de alarma solo cuando hay algo que alarmar: un cero
               en naranja hace dudar de una cifra que en realidad es buena. -->
          <div class="iva-tarjeta" :class="ivaFinanciado.enterado > 0 ? 'grave' : 'sano'">
            <span class="etiqueta">Ya enterado al SII y no cobrado</span>
            <span class="valor">${{ fm(ivaFinanciado.enterado) }}</span>
            <span v-if="ivaFinanciado.enterado > 0" class="detalle">
              De meses ya declarados: esta plata salió de tu caja y no ha vuelto.
            </span>
            <span v-else class="detalle">
              Todo lo que emitiste con IVA en meses anteriores ya está cobrado.
            </span>
          </div>
          <div class="iva-tarjeta">
            <span class="etiqueta">Débito de facturas del mes aún no cobradas</span>
            <span class="valor">${{ fm(ivaFinanciado.porEnterar) }}</span>
            <!-- OJO: esto NO es lo que se va a pagar. El F29 se paga por el
                 NETO del mes, que el crédito de las compras rebaja. Decir
                 "es lo que tienes que tener el mes que viene" contradecía
                 la tarjeta de IVA estimado de más arriba, en la misma
                 pantalla. -->
            <span class="detalle">Es el IVA de esas facturas, que todavía no le pagas al SII.</span>

            <!-- El neto va como CIFRA y no dentro del texto: es el número que
                 el usuario realmente necesita —lo que sale de la caja— y
                 enterrarlo en una frase obliga a leer para encontrarlo. El de
                 arriba se queda porque responde otra pregunta: cuánto de ese
                 débito depende de que te paguen. -->
            <div class="iva-a-pagar">
              <span class="etiqueta">A pagar al SII este mes</span>
              <span class="valor-secundario">${{ fm(ivaMes.neto) }}</span>
            </div>
            <span class="detalle">
              El crédito de tus compras (${{ fm(ivaMes.credito) }}) rebaja el débito del mes
              (${{ fm(ivaMes.debito) }}). Ese neto es lo que se declara en el F29.
            </span>
          </div>
        </div>

        <template v-if="ivaFinanciado.enterado > 0">
          <h3>Hace cuánto que no vuelve</h3>
          <table class="tabla-aging">
            <tbody>
              <tr><td>Por vencer</td><td class="num sano">${{ fm(ivaFinanciado.aging.porVencer) }}</td></tr>
              <tr><td>Vencido 1–30 días</td><td class="num">${{ fm(ivaFinanciado.aging.v1a30) }}</td></tr>
              <tr><td>Vencido 31–60 días</td><td class="num alerta">${{ fm(ivaFinanciado.aging.v31a60) }}</td></tr>
              <tr><td>Vencido 61–90 días</td><td class="num alerta">${{ fm(ivaFinanciado.aging.v61a90) }}</td></tr>
              <tr><td>Vencido +90 días</td><td class="num critico">${{ fm(ivaFinanciado.aging.vMas90) }}</td></tr>
            </tbody>
          </table>
        </template>

        <!-- Se señalan para REVISAR, sin afirmar que califican: recuperar el
             IVA de una deuda incobrable ante el SII tiene requisitos que esta
             app no puede evaluar. La decisión es del contador. -->
        <div v-if="paraRevisar.length > 0" class="iva-revisar">
          <strong><i class="pi pi-exclamation-triangle" /> ${{ fm(ivaParaRevisar) }} en facturas con más de {{ DIAS_PARA_REVISAR_INCOBRABLE }} días de mora</strong>
          <span>
            Vale la pena revisarlas con tu contador. Bajo ciertas condiciones el SII permite recuperar el IVA de
            deudas incobrables, pero los requisitos (plazos y gestiones de cobranza acreditables) hay que
            evaluarlos caso a caso — la app no puede determinarlo por ti.
          </span>
        </div>

        <template v-if="ivaFinanciado.lineas.length > 0">
          <h3>Factura por factura</h3>
          <table class="tabla-ranking">
            <thead>
              <tr>
                <th>Documento</th><th>Cliente</th><th class="num">Por cobrar</th><th class="num">IVA</th><th>Mora</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="linea in ivaFinanciado.lineas" :key="linea.id">
                <td>{{ linea.descripcion }}</td>
                <td>{{ linea.contraparte }}</td>
                <td class="num">${{ fm(linea.saldo) }}</td>
                <td class="num" :class="{ critico: linea.diasVencido > DIAS_PARA_REVISAR_INCOBRABLE }">${{ fm(linea.iva) }}</td>
                <td class="detalle">
                  <span v-if="!linea.enterado">del mes en curso</span>
                  <span v-else-if="linea.diasVencido === 0">al día</span>
                  <span v-else>{{ linea.diasVencido }} días</span>
                </td>
              </tr>
            </tbody>
          </table>
        </template>
        <p v-else class="vacio">No tienes IVA financiado: todo lo que emitiste con IVA está cobrado 🎉</p>
      </section>

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
.grupo-cabecera { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 0.6rem; }
.grupo-cabecera .grupo-titulo { margin: 0; }
.atenuado { opacity: 0.5; transition: opacity 0.15s; }
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
.iva-tarjetas { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 1rem; margin: 1rem 0; }
.iva-tarjeta { display: flex; flex-direction: column; gap: 0.25rem; padding: 1rem 1.1rem; border-radius: 10px; background: #f8fafc; border: 1px solid #e2e8f0; }
.iva-tarjeta.grave { background: #fff7ed; border-color: #fdba74; }
.iva-tarjeta.sano { background: #f0fdf4; border-color: #86efac; }
.iva-tarjeta.sano .valor { color: #15803d; }
.iva-a-pagar {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
  margin-top: 0.55rem;
  padding-top: 0.55rem;
  border-top: 1px solid #e2e8f0;
}
.valor-secundario {
  font-size: 1.1rem;
  font-weight: 750;
  font-variant-numeric: tabular-nums;
  color: #1e293b;
}
.iva-tarjeta .valor { font-size: 1.45rem; font-weight: 750; }
.iva-tarjeta.grave .valor { color: #c2410c; }
.iva-revisar { display: flex; flex-direction: column; gap: 0.35rem; margin-top: 1rem; padding: 0.85rem 1rem; border-radius: 8px; background: #fef2f2; border-left: 3px solid #ef4444; font-size: 0.83rem; color: #7f1d1d; }
.iva-revisar strong { display: flex; align-items: center; gap: 0.4rem; }
.exposicion { margin-top: 1rem; padding: 0.75rem; border-radius: 8px; background: #f8fafc; display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.85rem; }
.exposicion-fila { display: flex; justify-content: space-between; gap: 1rem; font-variant-numeric: tabular-nums; }
</style>
