import { shallowRef } from 'vue'
import { feathersClient } from '@/services/feathers'
import type { Paginated } from '@/types'

// La lista COMPLETA de una colección, pero con solo los campos que un
// selector necesita para armar su etiqueta.
//
// Existe por lo que la paginación rompe: los selectores de "documento que
// corrige" (en una nota de crédito) y de "qué factura facturó esta guía"
// tienen que poder apuntar a cualquier documento, no solo a los de la página
// que se está mirando. Una nota de crédito sobre una factura de hace tres
// meses es el caso normal, no el raro.
//
// Traerlo completo es viable justamente porque va proyectado: sin `$select`
// cada documento viaja con su XML firmado y sus ítems (decenas de KB); con él
// son cuatro campos por fila. Se carga cuando el diálogo lo necesita, no al
// abrir la pantalla.
const POR_PAGINA = 100

export function useCatalogoReferencias<T>(serviceName: string, campos: string[]) {
  const items = shallowRef<T[]>([])
  const cargando = shallowRef(false)
  let cargado = false

  async function cargar(forzar = false): Promise<void> {
    if ((cargado && !forzar) || cargando.value) return
    cargando.value = true

    try {
      const query = (skip: number): Record<string, unknown> => ({
        $limit: POR_PAGINA,
        $skip: skip,
        $sort: { createdAt: -1 },
        $select: campos
      })

      const primera = (await feathersClient.service(serviceName).find({ query: query(0) })) as Paginated<T> | T[]

      if (Array.isArray(primera)) {
        items.value = primera
      } else {
        const acumulado = [...primera.data]
        const pendientes: Promise<Paginated<T> | T[]>[] = []
        for (let skip = POR_PAGINA; skip < primera.total; skip += POR_PAGINA) {
          pendientes.push(feathersClient.service(serviceName).find({ query: query(skip) }) as Promise<Paginated<T> | T[]>)
        }
        for (const pagina of await Promise.all(pendientes)) {
          acumulado.push(...(Array.isArray(pagina) ? pagina : pagina.data))
        }
        items.value = acumulado
      }

      cargado = true
    } finally {
      cargando.value = false
    }
  }

  // Tras emitir o registrar algo, lo recién creado tiene que aparecer entre
  // los referenciables.
  function invalidar(): void {
    cargado = false
  }

  return { items, cargando, cargar, invalidar }
}
