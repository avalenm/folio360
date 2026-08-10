<script setup lang="ts">
import { computed, ref } from 'vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'
import DatePicker from 'primevue/datepicker'
import SelectButton from 'primevue/selectbutton'
import Message from 'primevue/message'
import { useToast } from 'primevue/usetoast'
import { feathersClient } from '@/services/feathers'
import type { LibroResumenTipo } from '@/types'

const toast = useToast()

const tipoOptions: { label: string; value: 'ventas' | 'compras' }[] = [
  { label: 'Libro de Ventas', value: 'ventas' },
  { label: 'Libro de Compras', value: 'compras' }
]

const tipo = ref<'ventas' | 'compras'>('ventas')
const periodoDate = ref<Date>(new Date())

// El servicio espera "AAAA-MM" (ver generate-libro.service.ts) — el
// DatePicker en modo mes solo trabaja con Date, así que se arma acá.
const periodo = computed(() => {
  const y = periodoDate.value.getFullYear()
  const m = String(periodoDate.value.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
})

const generating = ref(false)
const resultado = ref<{ filename: string; xmlBase64: string; resumen: LibroResumenTipo[] } | null>(null)
const errorMsg = ref<string | null>(null)

const totalDocumentos = computed(() => resultado.value?.resumen.reduce((sum, r) => sum + r.totDoc, 0) ?? 0)
const totalGeneral = computed(() => resultado.value?.resumen.reduce((sum, r) => sum + r.totMntTotal, 0) ?? 0)

async function generar(): Promise<void> {
  generating.value = true
  errorMsg.value = null
  resultado.value = null
  try {
    resultado.value = await feathersClient.service('generate-libro').create({ periodo: periodo.value, tipo: tipo.value })
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Error desconocido'
  } finally {
    generating.value = false
  }
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
      <h1 class="page-title">Libros de Compra-Venta</h1>
    </div>

    <p class="page-hint">
      Genera y firma la Información Electrónica de Compras y Ventas (IECV) del período seleccionado a partir de los
      documentos ya registrados. La subida al SII sigue siendo manual, por el portal de "Envío de Información de
      Compra y Venta" (Certificación o Producción según corresponda) — este paso solo arma y firma el archivo.
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
      <Button label="Generar" icon="pi pi-cog" :loading="generating" @click="generar" />
    </div>

    <Message v-if="errorMsg" severity="error" :closable="false">{{ errorMsg }}</Message>

    <div v-if="resultado" class="surface-card result-card">
      <div class="result-header">
        <div>
          <strong>{{ resultado.filename }}</strong>
          <span class="muted">{{ totalDocumentos }} documento(s) — total ${{ totalGeneral.toLocaleString('es-CL') }}</span>
        </div>
        <Button label="Descargar XML" icon="pi pi-download" @click="descargar" />
      </div>

      <DataTable :value="resultado.resumen" data-key="tipoDoc" size="small">
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
</style>
