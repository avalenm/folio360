import { onUnmounted, ref, shallowRef } from 'vue'
import { feathersClient } from '@/services/feathers'
import type { Paginated } from '@/types'

// Wrapper delgado sobre un servicio Feathers, compartido por las ~6 pantallas
// CRUD casi idénticas (customers/products/caf/certificates/documents/...):
// mantiene la lista reactiva sincronizada con find/create/patch/remove.
// shallowRef (no ref) porque siempre reemplazamos el array completo — evita
// además un problema conocido de TS con Ref<T> cuando T es un genérico
// acotado por una interfaz.
//
// También se suscribe a los eventos en vivo del servicio (created/patched/
// updated/removed, ver server/src/channels.ts) — así una tabla se actualiza
// sola cuando un proceso en segundo plano (worker de estado SII, poller de
// la Casilla de Intercambio) cambia algo, no solo cuando el propio usuario
// hace una acción. `onUnmounted` es seguro acá porque useResource() siempre
// se llama de forma síncrona dentro del setup() de un componente (misma
// regla que cualquier otro composable con lifecycle hooks).
export function useResource<T extends { _id: string }>(serviceName: string) {
  const items = shallowRef<T[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  const service = feathersClient.service(serviceName)

  function upsert(item: T): void {
    const exists = items.value.some((i) => i._id === item._id)
    items.value = exists ? items.value.map((i) => (i._id === item._id ? item : i)) : [item, ...items.value]
  }

  function drop(item: T): void {
    items.value = items.value.filter((i) => i._id !== item._id)
  }

  service.on('created', upsert)
  service.on('patched', upsert)
  service.on('updated', upsert)
  service.on('removed', drop)

  onUnmounted(() => {
    service.removeListener('created', upsert)
    service.removeListener('patched', upsert)
    service.removeListener('updated', upsert)
    service.removeListener('removed', drop)
  })

  async function fetchAll(): Promise<void> {
    loading.value = true
    error.value = null

    try {
      // Más recientes primero, SIEMPRE: sin $sort Mongo devuelve orden de
      // inserción (los más antiguos), y con más de 100 documentos los
      // recién creados quedaban fuera del corte — un borrador nuevo
      // "desaparecía" de la tabla al recargar (encontrado en vivo cuando
      // los documentos de certificación acumulados pasaron los 200).
      const result = (await feathersClient
        .service(serviceName)
        .find({ query: { $limit: 100, $sort: { createdAt: -1 } } })) as T[] | Paginated<T>
      items.value = Array.isArray(result) ? result : result.data
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Error desconocido'
    } finally {
      loading.value = false
    }
  }

  async function create(data: Partial<T>): Promise<T> {
    const created = (await feathersClient.service(serviceName).create(data)) as T
    // upsert, no prepend a ciegas: el evento en vivo 'created' puede llegar
    // ANTES de que esta promesa resuelva, y con ambos agregando el mismo
    // documento la tabla lo mostraba dos veces (encontrado en vivo).
    upsert(created)
    return created
  }

  async function update(id: string, data: Partial<T>): Promise<T> {
    const updated = (await feathersClient.service(serviceName).patch(id, data)) as T
    items.value = items.value.map((item) => (item._id === id ? updated : item))
    return updated
  }

  async function remove(id: string): Promise<void> {
    await feathersClient.service(serviceName).remove(id)
    items.value = items.value.filter((item) => item._id !== id)
  }

  return { items, loading, error, fetchAll, create, update, remove }
}
