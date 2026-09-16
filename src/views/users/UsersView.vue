<script setup lang="ts">
import AyudaPagina from '@/components/AyudaPagina.vue'
import { AYUDA_USUARIOS } from '@/ayudaContenidos'
import { computed, reactive, ref } from 'vue'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Password from 'primevue/password'
import Tag from 'primevue/tag'
import { useToast } from 'primevue/usetoast'
import { feathersClient } from '@/services/feathers'
import { useAuthStore } from '@/stores/auth'
import type { Membership, Organization, Role } from '@/types'

// El servicio de control-plane `users` no filtra por organización (los
// usuarios son globales) — listar "todos los usuarios" expondría emails de
// toda la plataforma a cualquier organización. Sin un endpoint de gestión de
// membresías (ver memoria "facturacion-sii-progress"), esta pantalla se
// limita al perfil del usuario logueado.
const auth = useAuthStore()
const toast = useToast()

const saving = ref(false)
const draft = reactive({ nombre: auth.user?.nombre ?? '', email: auth.user?.email ?? '', password: '' })

// Mismas etiquetas que en Miembros: el rol en crudo ("owner") es jerga del
// servidor, no algo que el usuario deba leer.
const ROLE_LABEL: Record<Role, string> = {
  owner: 'Propietario',
  admin: 'Administrador',
  contador: 'Contador',
  vendedor: 'Vendedor'
}

// Iniciales para el avatar: primera letra del primer y del último nombre.
const iniciales = computed(() => {
  const partes = (auth.user?.nombre ?? '').trim().split(/\s+/).filter(Boolean)
  if (partes.length === 0) return '?'
  const primera = partes[0][0]
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] : ''
  return (primera + ultima).toUpperCase()
})

const miembroDesde = computed(() => {
  if (!auth.user?.createdAt) return null
  return new Date(auth.user.createdAt).toLocaleDateString('es-CL', { month: 'long', year: 'numeric' })
})

function organizacionDe(m: Membership): Organization | undefined {
  return auth.organizations.find((o) => o._id === m.organizationId)
}

function esActual(m: Membership): boolean {
  return auth.currentOrganization?._id === m.organizationId
}

// Sin cambios, no hay nada que guardar: el botón se apaga en vez de mandar
// un patch vacío que igual mostraría "Perfil actualizado".
const hayCambios = computed(
  () =>
    draft.nombre.trim() !== (auth.user?.nombre ?? '') ||
    draft.email.trim() !== (auth.user?.email ?? '') ||
    draft.password.length > 0
)

function descartar(): void {
  draft.nombre = auth.user?.nombre ?? ''
  draft.email = auth.user?.email ?? ''
  draft.password = ''
}

async function handleSave(): Promise<void> {
  if (!auth.user) return

  saving.value = true
  try {
    const data: Record<string, unknown> = { nombre: draft.nombre, email: draft.email }
    if (draft.password) data.password = draft.password

    const updated = (await feathersClient.service('users').patch(auth.user._id, data)) as typeof auth.user
    auth.user = updated
    draft.password = ''
    toast.add({ severity: 'success', summary: 'Perfil actualizado', life: 2500 })
  } catch (e) {
    toast.add({
      severity: 'error',
      summary: 'Error al guardar',
      detail: e instanceof Error ? e.message : undefined,
      life: 4000
    })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="perfil">
    <div class="page-header">
      <div>
        <h1 class="page-title">Mi perfil <AyudaPagina titulo="Usuarios" :secciones="AYUDA_USUARIOS" /></h1>
        <p class="page-subtitle">Tus datos de acceso y las organizaciones a las que perteneces.</p>
      </div>
    </div>

    <div class="perfil-grid">
      <!-- Columna principal: identidad + formulario -->
      <form class="surface-card perfil-card" @submit.prevent="handleSave">
        <header class="perfil-identidad">
          <span class="perfil-avatar">{{ iniciales }}</span>
          <div class="perfil-quien">
            <div class="perfil-nombre">{{ auth.user?.nombre }}</div>
            <div class="perfil-email">{{ auth.user?.email }}</div>
          </div>
          <span v-if="miembroDesde" class="perfil-desde">Usuario desde {{ miembroDesde }}</span>
        </header>

        <section class="perfil-seccion">
          <div class="seccion-titulo">
            <h2>Datos personales</h2>
            <p>Tu nombre aparece en la cabecera y en los registros de quién emitió cada documento.</p>
          </div>
          <div class="seccion-campos">
            <label class="field">
              <span>Nombre</span>
              <InputText v-model="draft.nombre" required autocomplete="name" />
            </label>
            <label class="field">
              <span>Email</span>
              <InputText v-model="draft.email" type="email" required autocomplete="email" />
              <small class="field-hint">Es tu usuario para iniciar sesión.</small>
            </label>
          </div>
        </section>

        <section class="perfil-seccion">
          <div class="seccion-titulo">
            <h2>Contraseña</h2>
            <p>Déjala vacía si no quieres cambiarla.</p>
          </div>
          <div class="seccion-campos">
            <label class="field">
              <span>Nueva contraseña</span>
              <Password
                v-model="draft.password"
                :feedback="false"
                toggle-mask
                fluid
                autocomplete="new-password"
                placeholder="••••••••"
              />
            </label>
          </div>
        </section>

        <footer class="perfil-acciones">
          <span v-if="hayCambios" class="acciones-aviso">Tienes cambios sin guardar</span>
          <span v-else class="acciones-aviso muted">Todo guardado</span>
          <div class="acciones-botones">
            <Button label="Descartar" text :disabled="!hayCambios || saving" type="button" @click="descartar" />
            <Button type="submit" label="Guardar cambios" :loading="saving" :disabled="!hayCambios" />
          </div>
        </footer>
      </form>

      <!-- Columna lateral: membresías -->
      <aside class="surface-card membresias-card">
        <div class="membresias-titulo">
          <h2>Organizaciones</h2>
          <span class="membresias-conteo">{{ auth.user?.memberships.length ?? 0 }}</span>
        </div>
        <p class="membresias-hint">Dónde tienes acceso y con qué permisos.</p>

        <ul class="membresias-lista">
          <li v-for="m in auth.user?.memberships" :key="m.organizationId" class="membresia" :class="{ actual: esActual(m) }">
            <img
              v-if="organizacionDe(m)?.logoPng"
              :src="`data:image;base64,${organizacionDe(m)?.logoPng}`"
              alt=""
              class="membresia-logo"
            />
            <span v-else class="membresia-inicial">{{ organizacionDe(m)?.razonSocial?.[0] ?? '?' }}</span>
            <div class="membresia-texto">
              <span class="membresia-nombre">{{ organizacionDe(m)?.razonSocial ?? m.organizationId }}</span>
              <span class="membresia-meta">
                <span v-if="organizacionDe(m)?.rut">{{ organizacionDe(m)?.rut }}</span>
                <span v-if="esActual(m)" class="membresia-actual"><i class="pi pi-check" /> Actual</span>
                <span v-else-if="m.estado === 'invitado'" class="membresia-invitado">Invitación pendiente</span>
              </span>
            </div>
            <Tag :value="ROLE_LABEL[m.role] ?? m.role" :severity="m.role === 'owner' ? 'info' : 'secondary'" />
          </li>
        </ul>

        <router-link :to="{ name: 'organizations' }" class="membresias-link">
          Ver mis organizaciones <i class="pi pi-arrow-right" />
        </router-link>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.perfil-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 400px;
  gap: 1.25rem;
  align-items: start;
}

@media (max-width: 960px) {
  .perfil-grid {
    grid-template-columns: 1fr;
  }
}

/* ---------- Tarjeta principal ---------- */
.perfil-card {
  display: flex;
  flex-direction: column;
}

.perfil-identidad {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1.5rem 1.75rem;
  border-bottom: 1px solid var(--card-border);
  flex-wrap: wrap;
}

.perfil-avatar {
  width: 56px;
  height: 56px;
  flex-shrink: 0;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-lg);
  font-weight: 700;
  letter-spacing: 0.02em;
}

.perfil-quien {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.perfil-nombre {
  font-size: var(--text-lg);
  font-weight: 650;
  letter-spacing: -0.01em;
  color: var(--text-primary);
}

.perfil-email {
  font-size: var(--text-base);
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}

.perfil-desde {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  white-space: nowrap;
}

/* Cada sección: explicación a la izquierda, campos a la derecha */
.perfil-seccion {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: 1.5rem;
  padding: 1.5rem 1.75rem;
  border-bottom: 1px solid var(--card-border);
}

@media (max-width: 700px) {
  .perfil-seccion {
    grid-template-columns: 1fr;
    gap: 0.75rem;
  }
}

.seccion-titulo h2 {
  margin: 0;
  font-size: var(--text-md);
  font-weight: 650;
  letter-spacing: -0.01em;
  color: var(--text-primary);
}

.seccion-titulo p {
  margin: 0.3rem 0 0;
  font-size: var(--text-sm);
  color: var(--text-secondary);
  line-height: 1.45;
}

.seccion-campos {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  max-width: 560px;
}

.field-hint {
  font-size: var(--text-xs);
  font-weight: 400;
  color: var(--text-tertiary);
}

.perfil-acciones {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 1.75rem;
  background: #fcfcfd;
  border-radius: 0 0 var(--radius-lg) var(--radius-lg);
  flex-wrap: wrap;
}

.acciones-aviso {
  font-size: var(--text-sm);
  color: var(--warning);
  font-weight: 550;
}

.acciones-aviso.muted {
  color: var(--text-tertiary);
  font-weight: 400;
}

.acciones-botones {
  display: flex;
  gap: 0.5rem;
  margin-left: auto;
}

/* ---------- Tarjeta de membresías ---------- */
.membresias-card {
  padding: 1.25rem 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.membresias-titulo {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.membresias-titulo h2 {
  margin: 0;
  font-size: var(--text-md);
  font-weight: 650;
  letter-spacing: -0.01em;
}

.membresias-conteo {
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--text-secondary);
  background: var(--neutral-soft);
  border-radius: 999px;
  padding: 0.05rem 0.5rem;
}

.membresias-hint {
  margin: -0.5rem 0 0;
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.membresias-lista {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.membresia {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.7rem 0.75rem;
  border: 1px solid var(--card-border);
  border-radius: var(--radius-md);
}

.membresia.actual {
  border-color: rgb(79 70 229 / 0.35);
  background: rgb(238 241 255 / 0.5);
}

.membresia-logo,
.membresia-inicial {
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  border-radius: var(--radius-sm);
}

.membresia-logo {
  object-fit: contain;
  border: 1px solid var(--card-border);
  background: #fff;
  padding: 2px;
}

.membresia-inicial {
  background: var(--accent-soft);
  color: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
}

.membresia-texto {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
  line-height: 1.3;
}

.membresia-nombre {
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.membresia-meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: var(--text-xs);
  color: var(--text-secondary);
  white-space: nowrap;
}

.membresia .p-tag {
  flex-shrink: 0;
}

.membresia-actual {
  color: var(--accent);
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
}

.membresia-actual .pi {
  font-size: 0.65rem;
}

.membresia-invitado {
  color: var(--warning);
  font-weight: 550;
}

.membresias-link {
  margin-top: 0.25rem;
  font-size: var(--text-sm);
  font-weight: 550;
  color: var(--link-color);
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  align-self: flex-start;
}

.membresias-link .pi {
  font-size: 0.7rem;
}

.membresias-link:hover {
  color: var(--accent-hover);
  text-decoration: underline;
}
</style>
