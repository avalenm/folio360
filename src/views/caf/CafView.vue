<script setup lang="ts">
import AyudaPagina from '@/components/AyudaPagina.vue'
import { AYUDA_CAF } from '@/ayudaContenidos'
import { computed, onMounted, reactive, ref } from 'vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import InputNumber from 'primevue/inputnumber'
import Select from 'primevue/select'
import DatePicker from 'primevue/datepicker'
import Textarea from 'primevue/textarea'
import Tag from 'primevue/tag'
import ToggleSwitch from 'primevue/toggleswitch'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { useResource } from '@/composables/useResource'
import { useAuthStore } from '@/stores/auth'
import type { Caf } from '@/types'
import { nombreTipoDte } from '@/tiposDte'

const { items, loading, fetchAll, create, remove } = useResource<Caf>('caf')
const auth = useAuthStore()
const confirm = useConfirm()
const toast = useToast()

// El ambiente en que está la organización: es el único cuyos folios se pueden
// usar hoy (reserve-folio.ts busca por ambiente, ver el servidor).
const ambienteActual = computed(() => auth.currentOrganization?.ambiente ?? 'certificacion')

// Los CAF del OTRO ambiente se ocultan por defecto. No es solo orden: en el
// balance, ver folios que no se pueden usar invita a creer que hay folios
// cuando no los hay, y el error aparecería recién al intentar emitir. Se
// pueden destapar, porque siguen existiendo y a veces hay que revisarlos.
const mostrarOtroAmbiente = ref(false)

const cafsDelAmbiente = computed(() =>
  mostrarOtroAmbiente.value ? items.value : items.value.filter((caf) => caf.ambiente === ambienteActual.value)
)

const hayOtroAmbiente = computed(() => items.value.some((caf) => caf.ambiente !== ambienteActual.value))

const ambientes = [
  { label: 'Certificación', value: 'certificacion' },
  { label: 'Producción', value: 'produccion' }
]

// Mismos nombres que usan documents/DocumentsView.vue y pdf/dte-pdf.ts —
// tipos de DTE ya implementados (ver signing/dte-xml.ts).

// Un CAF queda sin folios cuando folioActual llega a folioHasta (reserve-folio.ts
// nunca lo deja pasar de ahí). Una vez agotado ya no aporta nada a la vista del
// día a día, así que se oculta de la tabla en cuanto se completa — se puede
// destapar con el switch para efectos de auditoría, pero no se borra de la BD.
const mostrarAgotados = ref(false)

function folioDisponibles(caf: Caf): number {
  return caf.folioHasta - caf.folioActual
}

const visibleItems = computed(() =>
  mostrarAgotados.value ? cafsDelAmbiente.value : cafsDelAmbiente.value.filter((caf) => folioDisponibles(caf) > 0)
)

// Balance de folios disponibles por tipo de DTE + ambiente. Separados por
// ambiente porque un folio de certificación jamás puede usarse en producción
// (ver caf.model.ts) — mezclarlos en un solo total sería engañoso.
const balanceFolios = computed(() => {
  const porGrupo = new Map<string, { key: string; tipoDte: number; ambiente: Caf['ambiente']; disponibles: number }>()

  for (const caf of cafsDelAmbiente.value) {
    if (caf.estado !== 'activo') continue
    const key = `${caf.tipoDte}-${caf.ambiente}`
    const grupo = porGrupo.get(key) ?? { key, tipoDte: caf.tipoDte, ambiente: caf.ambiente, disponibles: 0 }
    grupo.disponibles += folioDisponibles(caf)
    porGrupo.set(key, grupo)
  }

  return [...porGrupo.values()].sort((a, b) => a.tipoDte - b.tipoDte || a.ambiente.localeCompare(b.ambiente))
})

const dialogVisible = ref(false)
const saving = ref(false)

interface CafDraft {
  tipoDte: number | null
  ambiente: 'certificacion' | 'produccion'
  folioDesde: number | null
  folioHasta: number | null
  xmlRaw: string
  fechaAutorizacion: Date | null
}

function emptyDraft(): CafDraft {
  // Sigue a la organización, pero SE PUEDE cambiar: hay que poder cargar los
  // CAF de producción mientras todavía se está en certificación, que es el
  // orden natural (el SII recién te los entrega cuando te autoriza).
  return { tipoDte: 33, ambiente: ambienteActual.value, folioDesde: null, folioHasta: null, xmlRaw: '', fechaAutorizacion: new Date() }
}

const draft = reactive<CafDraft>(emptyDraft())

function openCreate(): void {
  Object.assign(draft, emptyDraft())
  dialogVisible.value = true
}

// Antes esto era copiar/pegar el XML a mano — un error real llevó a un CAF
// con la llave RSA truncada (512 bits en vez de los 2048 que exige el SII,
// cortada al seleccionar el texto), que el SII rechazó en el upload real sin
// dar mayor detalle ("HA OCURRIDO UN ERROR EN EL UPLOAD..."). Leer el
// archivo directo evita el copy/paste por completo, y de paso se completan
// los campos del formulario parseando el propio XML — un solo lugar de
// verdad, no dos copias que puedan desincronizarse.
async function handleFileUpload(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  const text = await file.text()
  draft.xmlRaw = text

  try {
    const doc = new DOMParser().parseFromString(text, 'text/xml')
    if (doc.querySelector('parsererror')) throw new Error('XML inválido')

    const td = doc.querySelector('TD')?.textContent
    const folioD = doc.querySelector('RNG > D')?.textContent
    const folioH = doc.querySelector('RNG > H')?.textContent
    const fa = doc.querySelector('FA')?.textContent

    if (td) draft.tipoDte = Number(td)
    if (folioD) draft.folioDesde = Number(folioD)
    if (folioH) draft.folioHasta = Number(folioH)
    if (fa) draft.fechaAutorizacion = new Date(fa)
  } catch {
    toast.add({
      severity: 'warn',
      summary: 'No se pudo leer el XML automáticamente',
      detail: 'Completa los campos manualmente, el archivo igual se adjuntó',
      life: 4000
    })
  }
}

async function handleSave(): Promise<void> {
  saving.value = true
  try {
    await create({
      tipoDte: draft.tipoDte ?? undefined,
      ambiente: draft.ambiente,
      folioDesde: draft.folioDesde ?? undefined,
      folioHasta: draft.folioHasta ?? undefined,
      xmlRaw: draft.xmlRaw,
      fechaAutorizacion: (draft.fechaAutorizacion ?? new Date()).toISOString() as unknown as string
    } as Partial<Caf>)
    dialogVisible.value = false
    toast.add({ severity: 'success', summary: 'CAF cargado', life: 2500 })
  } catch (e) {
    toast.add({
      severity: 'error',
      summary: 'Error al cargar el CAF',
      detail: e instanceof Error ? e.message : undefined,
      life: 4000
    })
  } finally {
    saving.value = false
  }
}

function confirmDelete(caf: Caf): void {
  confirm.require({
    message: `¿Eliminar el CAF tipo ${caf.tipoDte} (folios ${caf.folioDesde}-${caf.folioHasta})?`,
    header: 'Confirmar eliminación',
    icon: 'pi pi-exclamation-triangle',
    acceptProps: { severity: 'danger' },
    accept: async () => {
      try {
        await remove(caf._id)
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

onMounted(fetchAll)
</script>

<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">CAF (folios) <AyudaPagina titulo="CAF" :secciones="AYUDA_CAF" /></h1>
      <Button label="Cargar CAF" icon="pi pi-plus" @click="openCreate" />
    </div>

    <div class="surface-card balance-card">
      <div class="balance-header">
        <strong>Balance de folios disponibles</strong>
        <span class="muted">Por tipo de documento y ambiente, según los CAF activos</span>
      </div>

      <DataTable :value="balanceFolios" data-key="key" size="small">
        <Column header="Tipo DTE">
          <template #body="{ data }">{{ nombreTipoDte(data.tipoDte) }} ({{ data.tipoDte }})</template>
        </Column>
        <Column header="Ambiente">
          <template #body="{ data }">
            <Tag :severity="data.ambiente === 'produccion' ? 'danger' : 'info'" :value="data.ambiente" />
          </template>
        </Column>
        <Column header="Folios disponibles">
          <template #body="{ data }">{{ (data.disponibles as number).toLocaleString('es-CL') }}</template>
        </Column>
        <template #empty>Sin CAF activos cargados.</template>
      </DataTable>
    </div>

    <div class="table-toolbar">
      <label class="toggle-agotados">
        <ToggleSwitch v-model="mostrarAgotados" />
        <span>Mostrar CAF agotados</span>
      </label>
      <!-- Aparece solo si hay algo del otro ambiente que mostrar. -->
      <label v-if="hayOtroAmbiente" class="toggle-agotados">
        <ToggleSwitch v-model="mostrarOtroAmbiente" />
        <span>Mostrar también los del otro ambiente</span>
      </label>
    </div>

    <DataTable :value="visibleItems" :loading="loading" data-key="_id" striped-rows>
      <Column field="tipoDte" header="Tipo DTE">
        <template #body="{ data }">{{ nombreTipoDte(data.tipoDte) }} ({{ data.tipoDte }})</template>
      </Column>
      <Column header="Ambiente">
        <template #body="{ data }">
          <Tag :severity="data.ambiente === 'produccion' ? 'danger' : 'info'" :value="data.ambiente" />
        </template>
      </Column>
      <Column header="Rango folios">
        <template #body="{ data }">{{ data.folioDesde }} – {{ data.folioHasta }}</template>
      </Column>
      <Column field="folioActual" header="Folio actual" />
      <Column header="Disponibles">
        <template #body="{ data }">{{ folioDisponibles(data) }}</template>
      </Column>
      <Column header="Estado">
        <template #body="{ data }">
          <Tag :severity="data.estado === 'activo' ? 'success' : 'warn'" :value="data.estado" />
        </template>
      </Column>
      <Column header="" style="width: 3rem">
        <template #body="{ data }">
          <Button icon="pi pi-trash" text severity="danger" @click="confirmDelete(data)" />
        </template>
      </Column>
    </DataTable>

    <Dialog v-model:visible="dialogVisible" modal header="Cargar CAF" style="width: 520px">
      <form class="form-grid" @submit.prevent="handleSave">
        <label class="field">
          <span>Tipo DTE</span>
          <InputNumber v-model="draft.tipoDte" :min="1" />
        </label>
        <label class="field">
          <span>Ambiente</span>
          <Select v-model="draft.ambiente" :options="ambientes" option-label="label" option-value="value" />
          <!-- El caso normal es cargar los CAF de producción ANTES de pasar la
               organización a producción, así que esto no es un error. Pero
               un CAF del ambiente equivocado no lo encuentra nadie: la
               emisión falla con "no hay folios disponibles" y la causa no se
               ve por ninguna parte. -->
          <small v-if="draft.ambiente !== ambienteActual" class="aviso-ambiente">
            <i class="pi pi-info-circle" />
            Estos folios quedarán guardados para
            <strong>{{ draft.ambiente === 'produccion' ? 'producción' : 'certificación' }}</strong>, y hoy estás
            en {{ ambienteActual === 'produccion' ? 'producción' : 'certificación' }}: no se van a usar hasta que
            cambies de ambiente.
          </small>
        </label>
        <label class="field">
          <span>Folio desde</span>
          <InputNumber v-model="draft.folioDesde" :min="1" />
        </label>
        <label class="field">
          <span>Folio hasta</span>
          <InputNumber v-model="draft.folioHasta" :min="1" />
        </label>
        <label class="field">
          <span>Fecha de autorización</span>
          <DatePicker v-model="draft.fechaAutorizacion" date-format="dd/mm/yy" />
        </label>
        <label class="field">
          <span>Archivo XML del CAF</span>
          <input type="file" accept=".xml,text/xml" @change="handleFileUpload" />
        </label>
        <label class="field">
          <span>XML del CAF (se completa solo al elegir el archivo)</span>
          <Textarea v-model="draft.xmlRaw" rows="4" required />
        </label>

        <div class="form-actions">
          <Button label="Cancelar" text @click="dialogVisible = false" />
          <Button type="submit" label="Guardar" :loading="saving" />
        </div>
      </form>
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

.page-title {
  margin: 0;
  font-size: 1.4rem;
}

.balance-card {
  padding: 1.25rem;
  margin-bottom: 1.25rem;
}

.balance-header {
  margin-bottom: 1rem;
}

.balance-header strong {
  display: block;
}

.muted {
  display: block;
  font-size: 0.8rem;
  font-weight: 400;
  color: #64748b;
  margin-top: 0.15rem;
}

.aviso-ambiente {
  display: flex;
  align-items: flex-start;
  gap: 0.4rem;
  margin-top: 0.35rem;
  padding: 0.5rem 0.65rem;
  border-radius: 6px;
  background: #eff6ff;
  color: #1e40af;
  font-weight: 500;
  line-height: 1.35;
}

.table-toolbar {
  display: flex;
  justify-content: flex-end;
  gap: 1.5rem;
  flex-wrap: wrap;
  margin-bottom: 0.75rem;
}

.toggle-agotados {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: #334155;
}

.form-grid {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: #334155;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.5rem;
}
</style>
