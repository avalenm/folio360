<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import InputNumber from 'primevue/inputnumber'
import Select from 'primevue/select'
import DatePicker from 'primevue/datepicker'
import Textarea from 'primevue/textarea'
import Tag from 'primevue/tag'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { useResource } from '@/composables/useResource'
import type { Caf } from '@/types'

const { items, loading, fetchAll, create, remove } = useResource<Caf>('caf')
const confirm = useConfirm()
const toast = useToast()

const ambientes = [
  { label: 'Certificación', value: 'certificacion' },
  { label: 'Producción', value: 'produccion' }
]

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
  return { tipoDte: 33, ambiente: 'certificacion', folioDesde: null, folioHasta: null, xmlRaw: '', fechaAutorizacion: new Date() }
}

const draft = reactive<CafDraft>(emptyDraft())

function openCreate(): void {
  Object.assign(draft, emptyDraft())
  dialogVisible.value = true
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
      <h1 class="page-title">CAF (folios)</h1>
      <Button label="Cargar CAF" icon="pi pi-plus" @click="openCreate" />
    </div>

    <DataTable :value="items" :loading="loading" data-key="_id" striped-rows>
      <Column field="tipoDte" header="Tipo DTE" />
      <Column header="Ambiente">
        <template #body="{ data }">
          <Tag :severity="data.ambiente === 'produccion' ? 'danger' : 'info'" :value="data.ambiente" />
        </template>
      </Column>
      <Column header="Rango folios">
        <template #body="{ data }">{{ data.folioDesde }} – {{ data.folioHasta }}</template>
      </Column>
      <Column field="folioActual" header="Folio actual" />
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
          <span>XML del CAF</span>
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
