<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import Button from 'primevue/button'
import Message from 'primevue/message'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const auth = useAuthStore()
const loadingId = ref<string | null>(null)
const error = ref<string | null>(null)

async function handleSelect(organizationId: string): Promise<void> {
  loadingId.value = organizationId
  error.value = null

  try {
    await auth.selectOrganization(organizationId)
    router.push('/')
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudo seleccionar la organización'
  } finally {
    loadingId.value = null
  }
}
</script>

<template>
  <div class="select-org-page">
    <div class="select-org-card">
      <h1>Elige una organización</h1>

      <Message v-if="error" severity="error" :closable="false">{{ error }}</Message>

      <Message v-if="auth.organizations.length === 0" severity="warn" :closable="false">
        Tu usuario todavía no tiene membresías activas en ninguna organización.
      </Message>

      <ul class="org-list">
        <li v-for="org in auth.organizations" :key="org._id">
          <div class="org-item" role="button" tabindex="0" @click="handleSelect(org._id)">
            <div>
              <div class="org-name">{{ org.razonSocial }}</div>
              <div class="org-rut">{{ org.rut }}</div>
            </div>
            <Button icon="pi pi-arrow-right" text :loading="loadingId === org._id" @click.stop="handleSelect(org._id)" />
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.select-org-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--page-bg);
}

.select-org-card {
  width: 420px;
  background: #fff;
  border-radius: 12px;
  padding: 2rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.select-org-card h1 {
  margin: 0;
  font-size: 1.25rem;
}

.org-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.org-item {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--page-bg);
  border: 1px solid #e5e9f0;
  border-radius: 8px;
  padding: 0.75rem 1rem;
  cursor: pointer;
  text-align: left;
}

.org-item:hover {
  border-color: #94a3b8;
}

.org-name {
  font-weight: 600;
  font-size: 0.95rem;
}

.org-rut {
  font-size: 0.8rem;
  color: #64748b;
}
</style>
