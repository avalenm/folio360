<script setup lang="ts">
import { ref } from 'vue'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'

// Ayuda contextual de cada página: un ícono junto al título que abre un
// modal con la explicación de qué se muestra ahí y qué hace cada botón.
// El contenido lo aporta cada vista (secciones tipadas, sin HTML libre).
export interface SeccionAyuda {
  titulo: string
  // Párrafo introductorio de la sección.
  texto?: string
  // Lista "elemento — explicación" (botones, columnas, estados...).
  items?: { nombre: string; descripcion: string }[]
}

defineProps<{
  titulo: string
  secciones: SeccionAyuda[]
}>()

const visible = ref(false)
</script>

<template>
  <Button
    icon="pi pi-question-circle"
    text
    rounded
    severity="secondary"
    title="Ayuda de esta página"
    aria-label="Ayuda de esta página"
    @click="visible = true"
  />

  <Dialog v-model:visible="visible" modal :header="`Ayuda — ${titulo}`" style="width: min(680px, 92vw)">
    <div class="ayuda-body">
      <section v-for="seccion in secciones" :key="seccion.titulo" class="ayuda-seccion">
        <h3>{{ seccion.titulo }}</h3>
        <p v-if="seccion.texto">{{ seccion.texto }}</p>
        <dl v-if="seccion.items?.length">
          <template v-for="item in seccion.items" :key="item.nombre">
            <dt>{{ item.nombre }}</dt>
            <dd>{{ item.descripcion }}</dd>
          </template>
        </dl>
      </section>
    </div>
  </Dialog>
</template>

<style scoped>
.ayuda-body {
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
}

.ayuda-seccion h3 {
  margin: 0 0 0.35rem;
  font-size: 0.95rem;
}

.ayuda-seccion p {
  margin: 0 0 0.5rem;
  font-size: 0.88rem;
  color: var(--text-secondary, #475569);
}

.ayuda-seccion dl {
  margin: 0;
  display: grid;
  grid-template-columns: minmax(140px, max-content) 1fr;
  gap: 0.3rem 0.9rem;
  font-size: 0.86rem;
}

.ayuda-seccion dt {
  font-weight: 650;
}

.ayuda-seccion dd {
  margin: 0;
  color: var(--text-secondary, #475569);
}
</style>
