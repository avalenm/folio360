<script setup lang="ts">
import AyudaPagina from '@/components/AyudaPagina.vue'
import { AYUDA_CASILLA } from '@/ayudaContenidos'
import { onMounted, reactive, ref } from 'vue'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import Password from 'primevue/password'
import ToggleSwitch from 'primevue/toggleswitch'
import Tag from 'primevue/tag'
import Message from 'primevue/message'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { feathersClient } from '@/services/feathers'
import type { MailboxConfig } from '@/types'

const confirm = useConfirm()
const toast = useToast()

const loading = ref(false)
const saving = ref(false)
const current = ref<MailboxConfig | null>(null)
const editing = ref(false)

interface Draft {
  email: string
  imapHost: string
  imapPort: number
  imapSecure: boolean
  imapUsuario: string
  password: string
  smtpHost: string
  smtpPort: number | null
  smtpUsuario: string
  smtpPassword: string
  activo: boolean
}

function emptyDraft(): Draft {
  return {
    email: '',
    imapHost: '',
    imapPort: 993,
    imapSecure: true,
    imapUsuario: '',
    password: '',
    smtpHost: '',
    smtpPort: null,
    smtpUsuario: '',
    smtpPassword: '',
    activo: true
  }
}

function draftFromCurrent(config: MailboxConfig): Partial<Draft> {
  return {
    email: config.email,
    imapHost: config.imapHost,
    imapPort: config.imapPort,
    imapSecure: config.imapSecure,
    imapUsuario: config.imapUsuario,
    password: '',
    smtpHost: config.smtpHost ?? '',
    smtpPort: config.smtpPort ?? null,
    smtpUsuario: config.smtpUsuario ?? '',
    smtpPassword: '',
    activo: config.activo
  }
}

const draft = reactive<Draft>(emptyDraft())

async function fetchCurrent(): Promise<void> {
  loading.value = true
  try {
    const result = await feathersClient.service('mailbox-config').find()
    current.value = (Array.isArray(result) ? result : result.data)[0] ?? null
    if (current.value) Object.assign(draft, draftFromCurrent(current.value))
  } finally {
    loading.value = false
  }
}

function startEdit(): void {
  editing.value = true
}

function cancelEdit(): void {
  editing.value = false
  if (current.value) Object.assign(draft, draftFromCurrent(current.value))
  else Object.assign(draft, emptyDraft())
}

async function handleSave(): Promise<void> {
  saving.value = true
  try {
    await feathersClient.service('mailbox-config').create({
      email: draft.email,
      imapHost: draft.imapHost,
      imapPort: draft.imapPort,
      imapSecure: draft.imapSecure,
      imapUsuario: draft.imapUsuario,
      password: draft.password,
      // El relay de salida es opcional: los campos vacíos no se envían y el
      // servidor vuelve al SMTP derivado del IMAP.
      smtpHost: draft.smtpHost || undefined,
      smtpPort: draft.smtpPort ?? undefined,
      smtpUsuario: draft.smtpUsuario || undefined,
      smtpPassword: draft.smtpPassword || undefined,
      activo: draft.activo
    })
    editing.value = false
    await fetchCurrent()
    toast.add({ severity: 'success', summary: 'Configuración guardada', life: 2500 })
  } catch (e) {
    toast.add({
      severity: 'error',
      summary: 'Error al guardar',
      detail: e instanceof Error ? e.message : undefined,
      life: 5000
    })
  } finally {
    saving.value = false
  }
}

function confirmRemove(): void {
  confirm.require({
    message: 'Esto elimina la configuración de la Casilla de Intercambio — se dejará de detectar facturas recibidas automáticamente. ¿Continuar?',
    header: 'Eliminar configuración',
    icon: 'pi pi-exclamation-triangle',
    acceptProps: { severity: 'danger' },
    accept: async () => {
      try {
        await feathersClient.service('mailbox-config').remove(null)
        current.value = null
        editing.value = false
        Object.assign(draft, emptyDraft())
        toast.add({ severity: 'success', summary: 'Configuración eliminada', life: 2500 })
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

onMounted(fetchCurrent)
</script>

<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">Casilla de Intercambio <AyudaPagina titulo="Casilla de Intercambio" :secciones="AYUDA_CASILLA" /></h1>
    </div>

    <p class="page-hint">
      La Casilla de Intercambio es el correo que la organización ya registró ante el SII ("Mail Contacto Empresas",
      menú Factura Electrónica del portal SII). Por Ley 19.983 cada proveedor que le emite un documento a esta
      empresa debe mandar una copia del XML a esa casilla — conectando acá ese buzón, Folio360 revisa
      automáticamente las facturas nuevas cada 15 minutos y las deja listas para revisar en
      <router-link to="/facturas-recibidas">Facturas recibidas</router-link>.
    </p>

    <div v-if="current && !editing" class="surface-card status-card">
      <div class="status-row">
        <div>
          <strong>{{ current.email }}</strong>
          <span class="muted">{{ current.imapHost }}:{{ current.imapPort }} ({{ current.imapUsuario }})</span>
          <span v-if="current.smtpHost" class="muted">
            Salida por relay: {{ current.smtpHost }}:{{ current.smtpPort ?? 465 }} ({{ current.smtpUsuario ?? current.imapUsuario }})
          </span>
        </div>
        <Tag :severity="current.activo ? 'success' : 'secondary'" :value="current.activo ? 'Activo' : 'Desactivado'" />
      </div>

      <p v-if="current.ultimoPolling" class="polling-info">
        Última revisión: {{ new Date(current.ultimoPolling).toLocaleString('es-CL') }}
      </p>
      <p v-else class="polling-info muted">Aún no se ha ejecutado ninguna revisión.</p>

      <Message v-if="current.ultimoError" severity="error" :closable="false">{{ current.ultimoError }}</Message>

      <div class="form-actions">
        <Button label="Eliminar" severity="danger" text @click="confirmRemove" />
        <Button label="Editar" icon="pi pi-pencil" @click="startEdit" />
      </div>
    </div>

    <div v-if="!current || editing" class="surface-card">
      <form class="form-grid" @submit.prevent="handleSave">
        <label class="field">
          <span>Correo de la casilla</span>
          <InputText v-model="draft.email" type="email" required placeholder="dte@miempresa.cl" />
        </label>

        <div class="form-row">
          <label class="field field-grow">
            <span>Servidor IMAP</span>
            <InputText v-model="draft.imapHost" required placeholder="imap.miproveedor.cl" />
          </label>
          <label class="field">
            <span>Puerto</span>
            <InputNumber v-model="draft.imapPort" :use-grouping="false" :min="1" :max="65535" />
          </label>
        </div>

        <label class="field toggle-field">
          <ToggleSwitch v-model="draft.imapSecure" />
          <span>Conexión segura (TLS / IMAPS)</span>
        </label>

        <div class="form-row">
          <label class="field field-grow">
            <span>Usuario IMAP</span>
            <InputText v-model="draft.imapUsuario" required />
          </label>
          <label class="field field-grow">
            <span>Contraseña</span>
            <Password v-model="draft.password" :feedback="false" toggle-mask required />
          </label>
        </div>

        <fieldset class="smtp-relay">
          <legend>Servidor de salida (SMTP) — opcional</legend>
          <p class="relay-hint">
            Déjalo vacío para usar el servidor del mismo proveedor de la casilla. Configúralo solo si el envío
            directo está bloqueado (por ejemplo, el servidor de Folio360 corre en un datacenter que bloquea los
            puertos SMTP estándar) usando un relay transaccional con el dominio verificado.
          </p>
          <div class="form-row">
            <label class="field field-grow">
              <span>Servidor SMTP</span>
              <InputText v-model="draft.smtpHost" placeholder="mail.smtp2go.com" />
            </label>
            <label class="field">
              <span>Puerto</span>
              <InputNumber v-model="draft.smtpPort" :use-grouping="false" :min="1" :max="65535" placeholder="2525" />
            </label>
          </div>
          <div class="form-row">
            <label class="field field-grow">
              <span>Usuario SMTP</span>
              <InputText v-model="draft.smtpUsuario" />
            </label>
            <label class="field field-grow">
              <span>Contraseña SMTP</span>
              <Password v-model="draft.smtpPassword" :feedback="false" toggle-mask />
            </label>
          </div>
        </fieldset>

        <label class="field toggle-field">
          <ToggleSwitch v-model="draft.activo" />
          <span>Revisar automáticamente</span>
        </label>

        <div class="form-actions">
          <Button v-if="current" label="Cancelar" text @click="cancelEdit" />
          <Button type="submit" label="Guardar" :loading="saving" />
        </div>
      </form>
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
  max-width: 68ch;
}

.status-card,
.form-grid {
  padding: 1.25rem;
}

.status-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.polling-info {
  margin: 0.75rem 0 0;
  font-size: 0.85rem;
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

.toggle-field {
  flex-direction: row;
  align-items: center;
  gap: 0.6rem;
}

.smtp-relay {
  border: 1px solid var(--surface-border, #e2e8f0);
  border-radius: 6px;
  padding: 0.9rem;
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.smtp-relay legend {
  font-size: 0.85rem;
  font-weight: 600;
  color: #334155;
  padding: 0 0.3rem;
}

.relay-hint {
  margin: 0;
  font-size: 0.8rem;
  font-weight: 400;
  color: var(--text-secondary);
}

.muted {
  display: block;
  font-size: 0.8rem;
  font-weight: 400;
  color: var(--text-secondary);
  margin-top: 0.15rem;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.5rem;
}
</style>
