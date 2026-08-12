<script setup lang="ts">
import { computed, ref } from 'vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'
import DatePicker from 'primevue/datepicker'
import InputNumber from 'primevue/inputnumber'
import SelectButton from 'primevue/selectbutton'
import Message from 'primevue/message'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { feathersClient } from '@/services/feathers'
import type { LibroResumenTipo, LibroResumenGuias } from '@/types'

const toast = useToast()
const confirm = useConfirm()

type TipoLibro = 'ventas' | 'compras' | 'guias'

const tipoOptions: { label: string; value: TipoLibro }[] = [
  { label: 'Libro de Ventas', value: 'ventas' },
  { label: 'Libro de Compras', value: 'compras' },
  { label: 'Libro de Guías', value: 'guias' }
]

const tipo = ref<TipoLibro>('ventas')
const periodoDate = ref<Date>(new Date())

// El servicio espera "AAAA-MM" (ver generate-libro.service.ts) — el
// DatePicker en modo mes solo trabaja con Date, así que se arma acá.
const periodo = computed(() => {
  const y = periodoDate.value.getFullYear()
  const m = String(periodoDate.value.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
})

// Un libro que el SII pide por notificación va marcado como ESPECIAL y lleva
// el folio de esa notificación; sin folio sale el libro MENSUAL de siempre,
// que es el uso normal.
const folioNotificacion = ref<number | null>(null)

// Qué proporción del IVA de uso común se puede usar como crédito. Si se deja
// vacío, el server lo calcula desde las ventas del período (ver
// generate-libro.service.ts) — se completa a mano cuando el cálculo real del
// contribuyente difiere, porque legalmente se acumula desde enero.
const factorProporcionalidad = ref<number | null>(null)

const generating = ref(false)
const enviando = ref(false)
const resultado = ref<{
  filename: string
  xmlBase64: string
  resumen: LibroResumenTipo[]
  resumenGuias?: LibroResumenGuias
  trackId?: string
} | null>(null)
const errorMsg = ref<string | null>(null)

// El Libro de Guías no agrupa por tipo de documento (todas sus líneas son
// guías), así que trae su propio resumen y el conteo sale de ahí.
const guias = computed(() => resultado.value?.resumenGuias)

// Las tres categorías del resumen son excluyentes entre sí: una guía anulada
// no cuenta como guía de venta ni entra en la tabla de traslados (así lo
// define el formato, ver libro-builder.ts en el servidor), así que hay que
// sumar las tres o el total queda corto.
const totalDocumentos = computed(() => {
  const g = guias.value
  if (g) {
    return (
      g.totGuiaVenta +
      (g.totGuiaAnulada ?? 0) +
      (g.totFolAnulado ?? 0) +
      (g.totTraslado?.reduce((sum, t) => sum + t.cantGuia, 0) ?? 0)
    )
  }
  return resultado.value?.resumen.reduce((sum, r) => sum + r.totDoc, 0) ?? 0
})

const totalGeneral = computed(() => {
  const g = guias.value
  if (g) return g.totMntGuiaVta + (g.totTraslado?.reduce((sum, t) => sum + (t.mntGuia ?? 0), 0) ?? 0)
  return resultado.value?.resumen.reduce((sum, r) => sum + r.totMntTotal, 0) ?? 0
})

// Glosa de cada <TpoTraslado> del resumen (los que no son venta) — ver
// server/src/sii/libro-guias.ts.
const TRASLADO_LABELS: Record<number, string> = {
  2: 'Ventas por efectuar',
  3: 'Consignaciones',
  4: 'Productos en demostración',
  5: 'Traslados internos',
  6: 'Otros traslados no venta',
  7: 'Guías de devolución'
}

function trasladoLabel(tpo: number): string {
  return TRASLADO_LABELS[tpo] ?? `Traslado tipo ${tpo}`
}

// El factor que terminó usando el libro — importa mostrarlo porque cuando el
// campo se deja vacío lo calcula el server, y quien declara tiene que ver
// con qué número quedó.
const factorUsado = computed(() => resultado.value?.resumen.find((r) => r.fctProp !== undefined)?.fctProp)

// El Libro de Guías solo existe pedido por notificación del SII, así que sin
// folio no hay nada que generar (el server lo rechaza igual).
const faltaFolioNotificacion = computed(() => tipo.value === 'guias' && folioNotificacion.value === null)

function parametros(enviar: boolean) {
  return {
    periodo: periodo.value,
    tipo: tipo.value,
    folioNotificacion: folioNotificacion.value ?? undefined,
    // Solo tiene sentido en el libro de compras; mandarlo en uno de ventas
    // sería ruido.
    factorProporcionalidadIva:
      tipo.value === 'compras' ? (factorProporcionalidad.value ?? undefined) : undefined,
    enviar
  }
}

async function generar(): Promise<void> {
  generating.value = true
  errorMsg.value = null
  resultado.value = null
  try {
    resultado.value = await feathersClient.service('generate-libro').create(parametros(false))
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Error desconocido'
  } finally {
    generating.value = false
  }
}

// Enviar rearma el libro con los mismos parámetros y lo sube: el XML que se
// manda es el que se acaba de revisar, no uno guardado de antes.
function enviar(): void {
  confirm.require({
    message:
      'Se enviará el libro al SII. Un libro enviado no se puede deshacer: corregirlo después exige un libro RECTIFICA con código de autorización.',
    header: '¿Enviar el libro al SII?',
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Enviar',
    accept: async () => {
      enviando.value = true
      errorMsg.value = null
      try {
        resultado.value = await feathersClient.service('generate-libro').create(parametros(true))
        toast.add({
          severity: 'success',
          summary: 'Libro enviado',
          detail: `N° Envío ${resultado.value?.trackId}`,
          life: 6000
        })
      } catch (e) {
        errorMsg.value = e instanceof Error ? e.message : 'Error desconocido'
      } finally {
        enviando.value = false
      }
    }
  })
}

// El XML viaja en base64 dentro del JSON (mismo patrón que
// document-pdf.service.ts) — acá solo se decodifica a Blob para disparar la
// descarga.
function descargar(): void {
  if (!resultado.value) return
  const bytes = Uint8Array.from(atob(resultado.value.xmlBase64), (c) => c.charCodeAt(0))
  const blob = new Blob([bytes], { type: 'application/xml' })
  const url = URL.createObjectURL(blob)
  const link = window.document.createElement('a')
  link.href = url
  link.download = resultado.value.filename
  link.click()
  URL.revokeObjectURL(url)
  toast.add({ severity: 'success', summary: 'Archivo descargado', life: 2500 })
}
</script>

<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">Libros electrónicos</h1>
    </div>

    <p class="page-hint">
      Genera y firma el libro del período seleccionado a partir de los documentos ya registrados. Primero se genera
      para revisar el resumen, y recién ahí se envía al SII: un libro enviado no se puede deshacer.
    </p>

    <p v-if="tipo === 'guias'" class="page-hint">
      El Libro de Guías declara qué pasó con cada Guía de Despacho del período: cuáles se facturaron —indicando qué
      factura las reemplazó— y cuáles se anularon. Eso se marca en cada guía desde Documentos. Solo existe pedido por
      notificación del SII, así que el folio de notificación es obligatorio.
    </p>

    <div class="filters surface-card">
      <label class="field">
        <span>Libro</span>
        <SelectButton v-model="tipo" :options="tipoOptions" option-label="label" option-value="value" />
      </label>
      <label class="field">
        <span>Período</span>
        <DatePicker v-model="periodoDate" view="month" date-format="mm/yy" />
      </label>
      <label class="field">
        <span>Folio de notificación</span>
        <InputNumber
          v-model="folioNotificacion"
          :min="1"
          :use-grouping="false"
          :invalid="faltaFolioNotificacion"
          :placeholder="tipo === 'guias' ? 'Obligatorio' : 'Solo si el SII lo pidió'"
        />
      </label>
      <label v-if="tipo === 'compras'" class="field">
        <span>Factor de proporcionalidad IVA</span>
        <InputNumber
          v-model="factorProporcionalidad"
          :min="0"
          :max="1"
          :min-fraction-digits="2"
          :max-fraction-digits="3"
          placeholder="Se calcula solo"
        />
      </label>
      <Button
        label="Generar"
        icon="pi pi-cog"
        :loading="generating"
        :disabled="faltaFolioNotificacion"
        @click="generar"
      />
    </div>

    <Message v-if="errorMsg" severity="error" :closable="false">{{ errorMsg }}</Message>

    <div v-if="resultado" class="surface-card result-card">
      <div class="result-header">
        <div>
          <strong>{{ resultado.filename }}</strong>
          <span class="muted">
            {{ totalDocumentos }} documento(s) — total ${{ totalGeneral.toLocaleString('es-CL') }}
            <template v-if="factorUsado !== undefined"> — factor de proporcionalidad {{ factorUsado }}</template>
          </span>
          <span v-if="resultado.trackId" class="track-id">Enviado al SII — N° Envío {{ resultado.trackId }}</span>
        </div>
        <div class="result-actions">
          <Button label="Descargar XML" icon="pi pi-download" outlined @click="descargar" />
          <Button
            v-if="!resultado.trackId"
            label="Enviar al SII"
            icon="pi pi-send"
            :loading="enviando"
            @click="enviar"
          />
        </div>
      </div>

      <div v-if="guias" class="resumen-guias">
        <div class="dato">
          <span class="dato-label">Guías de venta</span>
          <span class="dato-valor">{{ guias.totGuiaVenta }} — ${{ guias.totMntGuiaVta.toLocaleString('es-CL') }}</span>
        </div>
        <div v-if="guias.totMntModificado" class="dato">
          <span class="dato-label">Monto modificado</span>
          <span class="dato-valor">${{ guias.totMntModificado.toLocaleString('es-CL') }}</span>
          <span class="dato-hint">facturado o anulado en el período</span>
        </div>
        <div v-if="guias.totGuiaAnulada" class="dato">
          <span class="dato-label">Guías anuladas</span>
          <span class="dato-valor">{{ guias.totGuiaAnulada }}</span>
        </div>
        <div v-if="guias.totFolAnulado" class="dato">
          <span class="dato-label">Folios anulados</span>
          <span class="dato-valor">{{ guias.totFolAnulado }}</span>
        </div>
        <div v-for="t in guias.totTraslado" :key="t.tpoTraslado" class="dato">
          <span class="dato-label">{{ trasladoLabel(t.tpoTraslado) }}</span>
          <span class="dato-valor">{{ t.cantGuia }} — ${{ (t.mntGuia ?? 0).toLocaleString('es-CL') }}</span>
        </div>
      </div>

      <DataTable v-else :value="resultado.resumen" data-key="tipoDoc" size="small">
        <Column field="tipoDoc" header="Tipo doc" />
        <Column field="totDoc" header="N° docs" />
        <Column header="Exento">
          <template #body="{ data }">${{ (data.totMntExe as number).toLocaleString('es-CL') }}</template>
        </Column>
        <Column header="Neto">
          <template #body="{ data }">${{ (data.totMntNeto as number).toLocaleString('es-CL') }}</template>
        </Column>
        <Column header="IVA">
          <template #body="{ data }">${{ (data.totMntIVA as number).toLocaleString('es-CL') }}</template>
        </Column>
        <Column header="Total">
          <template #body="{ data }">${{ (data.totMntTotal as number).toLocaleString('es-CL') }}</template>
        </Column>
      </DataTable>
    </div>
  </div>
</template>

<style scoped>
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}

.page-title {
  margin: 0;
  font-size: 1.4rem;
}

.page-hint {
  margin: 0 0 1.25rem;
  font-size: 0.85rem;
  color: var(--text-secondary);
  max-width: 62ch;
}

.filters {
  display: flex;
  align-items: flex-end;
  gap: 1.25rem;
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

.result-card {
  padding: 1.25rem;
}

.result-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
}

.muted {
  display: block;
  font-size: 0.8rem;
  font-weight: 400;
  color: var(--text-secondary);
  margin-top: 0.15rem;
}

.result-actions {
  display: flex;
  gap: 0.5rem;
}

.resumen-guias {
  display: flex;
  flex-wrap: wrap;
  gap: 1.5rem 2.5rem;
}

.dato {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.dato-label {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--text-secondary);
}

.dato-valor {
  font-size: 1.05rem;
  font-weight: 600;
}

.dato-hint {
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.track-id {
  display: block;
  margin-top: 0.35rem;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--p-primary-color, #2563eb);
}
</style>
