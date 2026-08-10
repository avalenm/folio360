<template>
  <div class="not-found">
    <h1>404</h1>
    <p>Página no encontrada.</p>
    <router-link to="/">Volver al inicio</router-link>
  </div>
</template>

<style scoped>
.not-found {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  color: #334155;
}
</style>
