<script setup lang="ts">
import AyudaPagina from '@/components/AyudaPagina.vue'
import { AYUDA_CERTIFICADOS } from '@/ayudaContenidos'
import { onMounted, reactive, ref } from 'vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Password from 'primevue/password'
import DatePicker from 'primevue/datepicker'
import Tag from 'primevue/tag'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { useResource } from '@/composables/useResource'
import type { Certificate } from '@/types'

const { items, loading, fetchAll, create, remove } = useResource<Certificate>('certificates')
const confirm = useConfirm()
const toast = useToast()

const dialogVisible = ref(false)
const saving = ref(false)
const pfxFile = ref<File | null>(null)

interface CertificateDraft {
  alias: string
  rut: string
  validFrom: Date | null
  validTo: Date | null
  password: string
}

function emptyDraft(): CertificateDraft {
  return { alias: '', rut: '', validFrom: new Date(), validTo: null, password: '' }
}

const draft = reactive<CertificateDraft>(emptyDraft())

function openCreate(): void {
  Object.assign(draft, emptyDraft())
  pfxFile.value = null
  dialogVisible.value = true
}

function handleFileChange(event: Event): void {
  const input = event.target as HTMLInputElement
  pfxFile.value = input.files?.[0] ?? null
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '')
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

async function handleSave(): Promise<void> {
  if (!pfxFile.value) {
    toast.add({ severity: 'warn', summary: 'Selecciona el archivo .pfx', life: 3000 })
    return
  }

  saving.value = true
  try {
    const pfx = await readFileAsBase64(pfxFile.value)
    await create({
      alias: draft.alias,
      rut: draft.rut,
      validFrom: (draft.validFrom ?? new Date()).toISOString() as unknown as string,
      validTo: (draft.validTo ?? new Date()).toISOString() as unknown as string,
      pfx,
      password: draft.password
    } as unknown as Partial<Certificate>)
    dialogVisible.value = false
    toast.add({ severity: 'success', summary: 'Certificado cargado', life: 2500 })
  } catch (e) {
    toast.add({
      severity: 'error',
      summary: 'Error al cargar el certificado',
      detail: e instanceof Error ? e.message : undefined,
      life: 4000
    })
  } finally {
    saving.value = false
  }
}

function confirmDelete(certificate: Certificate): void {
  confirm.require({
    message: `¿Eliminar el certificado "${certificate.alias}"?`,
    header: 'Confirmar eliminación',
    icon: 'pi pi-exclamation-triangle',
    acceptProps: { severity: 'danger' },
    accept: async () => {
      try {
        await remove(certificate._id)
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
      <h1 class="page-title">Certificados digitales <AyudaPagina titulo="Certificados" :secciones="AYUDA_CERTIFICADOS" /></h1>
      <Button label="Cargar certificado" icon="pi pi-plus" @click="openCreate" />
    </div>

    <DataTable :value="items" :loading="loading" data-key="_id" striped-rows>
      <Column field="alias" header="Alias" />
      <Column field="rut" header="RUT" />
      <Column header="Vigencia">
        <template #body="{ data }">
          {{ new Date(data.validFrom).toLocaleDateString('es-CL') }} –
          {{ new Date(data.validTo).toLocaleDateString('es-CL') }}
        </template>
      </Column>
      <Column header="Estado">
        <template #body="{ data }">
          <Tag :severity="data.estado === 'activo' ? 'success' : 'danger'" :value="data.estado" />
        </template>
      </Column>
      <Column header="" style="width: 3rem">
        <template #body="{ data }">
          <Button icon="pi pi-trash" text severity="danger" @click="confirmDelete(data)" />
        </template>
      </Column>
    </DataTable>

    <Dialog v-model:visible="dialogVisible" modal header="Cargar certificado" style="width: 480px">
      <form class="form-grid" @submit.prevent="handleSave">
        <label class="field">
          <span>Alias</span>
          <InputText v-model="draft.alias" required />
        </label>
        <label class="field">
          <span>RUT</span>
          <InputText v-model="draft.rut" required />
        </label>
        <label class="field">
          <span>Vigente desde</span>
          <DatePicker v-model="draft.validFrom" date-format="dd/mm/yy" />
        </label>
        <label class="field">
          <span>Vigente hasta</span>
          <DatePicker v-model="draft.validTo" date-format="dd/mm/yy" />
        </label>
        <label class="field">
          <span>Archivo .pfx</span>
          <input type="file" accept=".pfx,.p12" @change="handleFileChange" />
        </label>
        <label class="field">
          <span>Password del certificado</span>
          <Password v-model="draft.password" :feedback="false" toggle-mask required fluid />
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
