<script setup lang="ts">
import AyudaPagina from '@/components/AyudaPagina.vue'
import { AYUDA_ORGANIZACIONES } from '@/ayudaContenidos'
import { computed, reactive, ref } from 'vue'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Tag from 'primevue/tag'
import { useToast } from 'primevue/usetoast'
import { feathersClient } from '@/services/feathers'
import { useAuthStore } from '@/stores/auth'
import type { Ambiente, Organization } from '@/types'

// El servicio de control-plane `organizations` ahora filtra por membership
// (ver hooks de organizations.service.ts en el servidor) — esta pantalla de
// todos modos solo muestra las organizaciones a las que el usuario
// pertenece (vía auth.organizations), no depende de esa protección para su
// propio comportamiento.
const auth = useAuthStore()
const toast = useToast()

const dialogVisible = ref(false)
const editingId = ref<string | null>(null)
const saving = ref(false)
const draft = reactive<Partial<Organization>>({})

// Editar una organización exige admin+ EN ESA organización puntual — no
// necesariamente la que está activa ahora mismo (un usuario puede ser
// vendedor en una organización y owner en otra; auth.currentRole solo
// refleja la seleccionada). Se cruza contra las memberships del propio
// usuario en vez de asumir el rol activo.
function rolEn(org: Organization): string | undefined {
  return auth.user?.memberships.find((m) => m.organizationId === org._id)?.role
}

function canEdit(org: Organization): boolean {
  const role = rolEn(org)
  return role === 'owner' || role === 'admin'
}

// Pasar a producción es la decisión con más consecuencias de toda la app: la
// deja solo el dueño de la organización.
function puedeCambiarAmbiente(org: Organization): boolean {
  return rolEn(org) === 'owner'
}

const ESTADO_LABEL: Record<string, string> = {
  onboarding: 'En configuración',
  activo: 'Activa',
  suspendido: 'Suspendida'
}

const AMBIENTE_LABEL: Record<Ambiente, string> = {
  certificacion: 'Certificación',
  produccion: 'Producción'
}

function openEdit(org: Organization): void {
  editingId.value = org._id
  Object.assign(draft, org)
  dialogVisible.value = true
}

// El logo viaja como base64 dentro del documento de la organización y se
// dibuja en la esquina superior izquierda de la representación impresa
// (máximo 1/5 del documento según el Manual de Muestras Impresas — el PDF
// lo escala a 3x2 cm). Se limita el archivo para no inflar el documento.
const MAX_LOGO_BYTES = 300 * 1024

function onLogoChange(event: Event): void {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return

  if (file.size > MAX_LOGO_BYTES) {
    toast.add({ severity: 'warn', summary: 'Logo muy pesado', detail: 'Máximo 300 KB (PNG o JPEG)', life: 4000 })
    return
  }

  const reader = new FileReader()
  reader.onload = () => {
    // El data URL trae el prefijo "data:image/png;base64," — se guarda solo
    // el base64, que es lo que el generador de PDF espera.
    draft.logoPng = String(reader.result).split(',')[1]
  }
  reader.readAsDataURL(file)
}

function quitarLogo(): void {
  draft.logoPng = ''
}

async function guardar(id: string, cambios: Partial<Organization>, mensaje: string): Promise<boolean> {
  saving.value = true
  try {
    const updated = (await feathersClient.service('organizations').patch(id, cambios)) as Organization
    const index = auth.organizations.findIndex((o) => o._id === updated._id)
    if (index !== -1) auth.organizations[index] = updated
    toast.add({ severity: 'success', summary: mensaje, life: 2500 })
    return true
  } catch (e) {
    toast.add({
      severity: 'error',
      summary: 'Error al guardar',
      detail: e instanceof Error ? e.message : undefined,
      life: 4000
    })
    return false
  } finally {
    saving.value = false
  }
}

async function handleSave(): Promise<void> {
  if (!editingId.value) return
  if (await guardar(editingId.value, draft, 'Guardado')) dialogVisible.value = false
}

// ---- Cambio de ambiente ----
// No va como un campo más del formulario de edición a propósito. Cambiar de
// ambiente no es editar un dato: es decidir si lo que la empresa emita desde
// ahora tiene validez tributaria. Va como una acción aparte, explicada, y con
// una confirmación que enumera lo que cambia.
const ambienteDialogVisible = ref(false)
const orgAmbiente = ref<Organization | null>(null)

const ambienteDestino = computed<Ambiente>(() =>
  orgAmbiente.value?.ambiente === 'produccion' ? 'certificacion' : 'produccion'
)

const vaAProduccion = computed(() => ambienteDestino.value === 'produccion')

function abrirCambioAmbiente(org: Organization): void {
  orgAmbiente.value = org
  ambienteDialogVisible.value = true
}

async function confirmarCambioAmbiente(): Promise<void> {
  const org = orgAmbiente.value
  if (!org) return

  const ok = await guardar(
    org._id,
    { ambiente: ambienteDestino.value },
    `Ahora estás en ${AMBIENTE_LABEL[ambienteDestino.value].toLowerCase()}`
  )
  if (ok) ambienteDialogVisible.value = false
}
</script>

<template>
  <div>
    <h1 class="page-title">Mis organizaciones <AyudaPagina titulo="Organizaciones" :secciones="AYUDA_ORGANIZACIONES" /></h1>

    <div class="org-lista">
      <section v-for="org in auth.organizations" :key="org._id" class="org-card">
        <header class="org-header">
          <div class="org-identidad">
            <img v-if="org.logoPng" :src="`data:image;base64,${org.logoPng}`" alt="" class="org-logo" />
            <span v-else class="org-inicial">{{ org.razonSocial?.[0] ?? '?' }}</span>
            <div>
              <div class="org-name">{{ org.razonSocial }}</div>
              <div class="org-rut">{{ org.rut }}</div>
            </div>
          </div>
          <div class="org-tags">
            <Tag
              :severity="org.ambiente === 'produccion' ? 'success' : 'warn'"
              :value="AMBIENTE_LABEL[org.ambiente]"
            />
            <Tag :severity="org.estado === 'activo' ? 'success' : 'info'" :value="ESTADO_LABEL[org.estado] ?? org.estado" />
          </div>
        </header>

        <dl class="org-datos">
          <div><dt>Giro</dt><dd>{{ org.giro || '—' }}</dd></div>
          <div><dt>Unidad del SII</dt><dd>{{ org.unidadSii || '—' }}</dd></div>
          <div><dt>Resolución</dt><dd>N° {{ org.resolucionNumero ?? 0 }}</dd></div>
          <div><dt>Tu rol</dt><dd>{{ rolEn(org) ?? '—' }}</dd></div>
        </dl>

        <!-- El ambiente va en su propio bloque, no como un dato más: es lo que
             decide si lo que emitas tiene validez tributaria. -->
        <div class="ambiente-bloque" :class="org.ambiente">
          <div class="ambiente-texto">
            <strong>
              <i :class="org.ambiente === 'produccion' ? 'pi pi-check-circle' : 'pi pi-exclamation-triangle'" />
              {{ AMBIENTE_LABEL[org.ambiente] }}
            </strong>
            <span v-if="org.ambiente === 'certificacion'">
              Todo lo que emitas va al servidor de pruebas del SII y no tiene validez tributaria. Es donde se hace
              la certificación.
            </span>
            <span v-else>
              Los documentos que emitas van al SII real y tienen validez tributaria.
            </span>
          </div>
          <Button
            v-if="puedeCambiarAmbiente(org)"
            :label="org.ambiente === 'produccion' ? 'Volver a certificación' : 'Pasar a producción'"
            :severity="org.ambiente === 'produccion' ? 'secondary' : 'success'"
            :text="org.ambiente === 'produccion'"
            size="small"
            @click="abrirCambioAmbiente(org)"
          />
        </div>

        <footer class="org-acciones">
          <Button v-if="canEdit(org)" label="Editar datos" icon="pi pi-pencil" text @click="openEdit(org)" />
        </footer>
      </section>
    </div>

    <Dialog v-model:visible="dialogVisible" modal header="Editar organización" style="width: 460px">
      <form class="form-grid" @submit.prevent="handleSave">
        <label class="field">
          <span>Razón social</span>
          <InputText v-model="draft.razonSocial" required />
        </label>
        <label class="field">
          <span>Giro</span>
          <InputText v-model="draft.giro" />
        </label>
        <label class="field">
          <span>Unidad del SII (para la representación impresa)</span>
          <InputText v-model="draft.unidadSii" placeholder="Ej: SANTIAGO ORIENTE" />
        </label>
        <label class="field">
          <span>Logo (PNG o JPEG, máx. 300 KB)</span>
          <input type="file" accept="image/png,image/jpeg" @change="onLogoChange" />
        </label>
        <div v-if="draft.logoPng" class="logo-preview">
          <img :src="`data:image;base64,${draft.logoPng}`" alt="Logo de la empresa" />
          <Button label="Quitar logo" icon="pi pi-times" text size="small" type="button" @click="quitarLogo" />
        </div>

        <p class="nota">
          El ambiente no se edita acá: se cambia desde la tarjeta, con su propia confirmación.
        </p>

        <div class="form-actions">
          <Button label="Cancelar" text @click="dialogVisible = false" />
          <Button type="submit" label="Guardar" :loading="saving" />
        </div>
      </form>
    </Dialog>

    <!-- Confirmación del cambio de ambiente: enumera lo que cambia, porque es
         lo que uno querría haber leído antes y no después. -->
    <Dialog
      v-model:visible="ambienteDialogVisible"
      modal
      :header="vaAProduccion ? 'Pasar a producción' : 'Volver a certificación'"
      style="width: 540px"
    >
      <div v-if="orgAmbiente" class="ambiente-confirmacion">
        <p>
          <strong>{{ orgAmbiente.razonSocial }}</strong> pasará de
          {{ AMBIENTE_LABEL[orgAmbiente.ambiente].toLowerCase() }} a
          <strong>{{ AMBIENTE_LABEL[ambienteDestino].toLowerCase() }}</strong>.
        </p>

        <template v-if="vaAProduccion">
          <p class="ambiente-que-cambia">Desde ese momento:</p>
          <ul>
            <li>Los DTE que emitas se enviarán al <strong>SII real</strong> y tendrán validez tributaria.</li>
            <li>
              Los folios saldrán de tus <strong>CAF de producción</strong>. Si no los has cargado, la emisión va a
              fallar — cárgalos antes en la sección CAF.
            </li>
            <li>
              Tus documentos y compras de certificación <strong>dejan de contarse</strong> en el Panorama, en
              Finanzas y en los Libros. No se borran: quedan como respaldo de la certificación.
            </li>
            <li>El aviso de "ambiente de prueba" desaparece de la pantalla.</li>
          </ul>
          <p class="ambiente-ojo">
            Hazlo solo cuando el SII ya te haya autorizado como emisor electrónico.
          </p>
        </template>

        <template v-else>
          <p class="ambiente-que-cambia">
            Volverás a emitir contra el servidor de pruebas. Los documentos de producción que ya emitiste
            <strong>no se borran</strong>, pero dejan de aparecer en tus totales y en los Libros mientras estés en
            certificación.
          </p>
          <p class="ambiente-ojo">
            Si ya emitiste documentos reales, esto no revierte nada ante el SII.
          </p>
        </template>

        <div class="form-actions">
          <Button label="Cancelar" text @click="ambienteDialogVisible = false" />
          <Button
            :label="vaAProduccion ? 'Sí, pasar a producción' : 'Sí, volver a certificación'"
            :severity="vaAProduccion ? 'success' : 'warn'"
            :loading="saving"
            @click="confirmarCambioAmbiente"
          />
        </div>
      </div>
    </Dialog>
  </div>
</template>

<style scoped>
.page-title {
  margin: 0 0 1.25rem;
  font-size: 1.4rem;
}

.org-lista {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  max-width: 760px;
}

.org-card {
  background: #fff;
  border-radius: 12px;
  padding: 1.25rem 1.4rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.org-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}

.org-identidad {
  display: flex;
  align-items: center;
  gap: 0.85rem;
}

.org-logo {
  width: 44px;
  height: 44px;
  object-fit: contain;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
  background: #fff;
  padding: 3px;
}

.org-inicial {
  width: 44px;
  height: 44px;
  border-radius: 8px;
  background: #eef2ff;
  color: #4f46e5;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 750;
  font-size: 1.1rem;
}

.org-name {
  font-weight: 700;
  font-size: 1.02rem;
}

.org-rut {
  font-size: 0.82rem;
  color: #64748b;
  font-variant-numeric: tabular-nums;
}

.org-tags {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
}

.org-datos {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 0.75rem 1rem;
  margin: 0;
}

.org-datos dt {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #94a3b8;
  font-weight: 700;
}

.org-datos dd {
  margin: 0.15rem 0 0;
  font-size: 0.88rem;
  color: #1e293b;
}

.ambiente-bloque {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.85rem 1rem;
  border-radius: 10px;
  flex-wrap: wrap;
}

.ambiente-bloque.certificacion {
  background: #fffbeb;
  border: 1px solid #fcd34d;
}

.ambiente-bloque.produccion {
  background: #f0fdf4;
  border: 1px solid #86efac;
}

.ambiente-texto {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: 0.83rem;
  color: #475569;
  max-width: 62ch;
}

.ambiente-texto strong {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.9rem;
  color: #1e293b;
}

.org-acciones {
  display: flex;
  justify-content: flex-end;
  border-top: 1px solid #f1f5f9;
  padding-top: 0.5rem;
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

.nota {
  margin: 0;
  font-size: 0.78rem;
  color: #64748b;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.logo-preview {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.logo-preview img {
  max-height: 56px;
  max-width: 160px;
  object-fit: contain;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 4px;
  background: #fff;
}

.ambiente-confirmacion {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  font-size: 0.88rem;
  color: #334155;
}

.ambiente-confirmacion p {
  margin: 0;
}

.ambiente-confirmacion ul {
  margin: 0;
  padding-left: 1.1rem;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.ambiente-que-cambia {
  font-weight: 650;
}

.ambiente-ojo {
  background: #fffbeb;
  border-left: 3px solid #f59e0b;
  padding: 0.5rem 0.75rem;
  border-radius: 0 6px 6px 0;
  color: #78350f;
}
</style>
