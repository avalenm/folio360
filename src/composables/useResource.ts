import { ref, shallowRef } from 'vue'
import { feathersClient } from '@/services/feathers'
import type { Paginated } from '@/types'

// Wrapper delgado sobre un servicio Feathers, compartido por las ~6 pantallas
// CRUD casi idénticas (customers/products/caf/certificates/documents/...):
// mantiene la lista reactiva sincronizada con find/create/patch/remove.
// shallowRef (no ref) porque siempre reemplazamos el array completo — evita
// además un problema conocido de TS con Ref<T> cuando T es un genérico
// acotado por una interfaz.
export function useResource<T extends { _id: string }>(serviceName: string) {
  const items = shallowRef<T[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function fetchAll(): Promise<void> {
    loading.value = true
    error.value = null

    try {
      const result = (await feathersClient.service(serviceName).find({ query: { $limit: 100 } })) as
        | T[]
        | Paginated<T>
      items.value = Array.isArray(result) ? result : result.data
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Error desconocido'
    } finally {
      loading.value = false
    }
  }

  async function create(data: Partial<T>): Promise<T> {
    const created = (await feathersClient.service(serviceName).create(data)) as T
    items.value = [created, ...items.value]
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
