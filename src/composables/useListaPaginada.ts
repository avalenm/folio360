import { onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { feathersClient } from '@/services/feathers'
import type { Paginated } from '@/types'

// Lista paginada en el SERVIDOR, para las pantallas cuyo volumen crece sin
// techo (documentos y compras).
//
// La diferencia con useResource no es solo de dónde sale la página: es que
// filtrar y buscar dejan de ser cosa del cliente. Antes se cargaban los 100
// más recientes y se filtraba sobre eso, así que buscar un folio antiguo
// respondía "no hay resultados" cuando el documento existía — la lista no
// mentía sobre lo que mostraba, mentía sobre lo que NO mostraba.
//
// Los filtros viajan como parámetros propios (`folio`, `receptor`, `desde`,
// `hasta`) y el servidor los traduce a consultas de Mongo; ver
// server/src/services/lista-filtros.ts.

// Cuánto esperar antes de consultar mientras alguien escribe en un filtro:
// suficiente para no mandar una consulta por tecla, poco para que no se sienta
// lento.
const ESPERA_TIPEO_MS = 300

export interface OpcionesLista {
  // Los filtros activos, como getter para que se recalculen solos.
  filtros?: () => Record<string, unknown>
  porPagina?: number
}

export function useListaPaginada<T extends { _id: string }>(serviceName: string, opciones: OpcionesLista = {}) {
  const porPagina = opciones.porPagina ?? 25
  const items = shallowRef<T[]>([])
  const total = ref(0)
  const desde = ref(0)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const service = feathersClient.service(serviceName)

  async function cargar(): Promise<void> {
    loading.value = true
    error.value = null

    try {
      // Los filtros vacíos no se mandan: un `folio: ''` en la consulta haría
      // que el servidor buscara folios que contienen la cadena vacía.
      const filtros = Object.fromEntries(
        Object.entries(opciones.filtros?.() ?? {}).filter(
          ([, valor]) => valor !== null && valor !== undefined && valor !== ''
        )
      )

      const resultado = (await service.find({
        query: { $limit: porPagina, $skip: desde.value, $sort: { createdAt: -1 }, ...filtros }
      })) as Paginated<T> | T[]

      if (Array.isArray(resultado)) {
        items.value = resultado
        total.value = resultado.length
      } else {
        items.value = resultado.data
        total.value = resultado.total
      }

      // La última página puede quedar vacía si mientras tanto se borraron
      // documentos: se retrocede en vez de mostrar una tabla vacía con un
      // paginador que dice que hay resultados.
      if (items.value.length === 0 && desde.value > 0 && total.value > 0) {
        desde.value = Math.max(0, (Math.ceil(total.value / porPagina) - 1) * porPagina)
        await cargar()
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Error desconocido'
    } finally {
      loading.value = false
    }
  }

  let temporizador: ReturnType<typeof setTimeout> | undefined

  function recargarPronto(): void {
    clearTimeout(temporizador)
    temporizador = setTimeout(() => void cargar(), ESPERA_TIPEO_MS)
  }

  // Cambiar un filtro vuelve a la primera página: quedarse en la 7 tras
  // acotar la búsqueda mostraría una tabla vacía por una razón que no tiene
  // nada que ver con lo que se buscó.
  //
  // El watch se registra en onMounted y NO durante el setup: `watch` evalúa
  // su fuente de inmediato para saber de qué depende, y la vista suele
  // declarar sus filtros DESPUÉS de llamar acá (son decenas de líneas más
  // abajo). Evaluarlos antes de que existan revienta con un ReferenceError
  // que ni el build ni el typecheck ven, porque es del orden de ejecución.
  // En onMounted ya está todo declarado, y un filtro no puede cambiar antes.
  if (opciones.filtros) {
    onMounted(() => {
      watch(opciones.filtros!, () => {
        desde.value = 0
        recargarPronto()
      })
    })
  }

  function irA(nuevoDesde: number): void {
    desde.value = nuevoDesde
    void cargar()
  }

  // Con la lista paginada, insertar en el arreglo local a partir del evento
  // corrompería la página (un documento nuevo aparecería sobre la página 7).
  // Se vuelve a pedir la página actual, que es la única forma de que el orden
  // y el total sigan siendo los del servidor. Ver la nota de useResource.ts
  // sobre por qué escuchamos estos eventos.
  const refrescar = (): void => recargarPronto()

  service.on('created', refrescar)
  service.on('patched', refrescar)
  service.on('updated', refrescar)
  service.on('removed', refrescar)

  onUnmounted(() => {
    clearTimeout(temporizador)
    service.removeListener('created', refrescar)
    service.removeListener('patched', refrescar)
    service.removeListener('updated', refrescar)
    service.removeListener('removed', refrescar)
  })

  async function create(data: Partial<T>): Promise<T> {
    const creado = (await service.create(data)) as T
    await cargar()
    return creado
  }

  async function update(id: string, data: Partial<T>): Promise<T> {
    const actualizado = (await service.patch(id, data)) as T
    await cargar()
    return actualizado
  }

  async function remove(id: string): Promise<void> {
    await service.remove(id)
    await cargar()
  }

  return { items, total, desde, porPagina, loading, error, cargar, irA, create, update, remove }
}
