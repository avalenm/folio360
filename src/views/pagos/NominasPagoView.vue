<script setup lang="ts">
import AyudaPagina from '@/components/AyudaPagina.vue'
import type { SeccionAyuda } from '@/components/AyudaPagina.vue'
import { onMounted, onUnmounted, ref } from 'vue'
import Button from 'primevue/button'
import Column from 'primevue/column'
import DataTable from 'primevue/datatable'
import Menu from 'primevue/menu'
import Tag from 'primevue/tag'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import type { MenuItem } from 'primevue/menuitem'
import { feathersClient } from '@/services/feathers'
import type { NominaPago } from '@/types'
import { descargarArchivoTexto, nombreBanco, nombreTipoCuenta } from '@/pagos'
import { fechaCorta } from '@/compras-sii'

// Nóminas de pago masivo generadas desde Compras: acá se vuelven a bajar,
// se confirman como pagadas (recién ahí se registran los abonos en cada
// factura) o se anulan. Ver server/src/services/pagos/nominas-pago.service.ts.
const toast = useToast()
const confirm = useConfirm()

const nominas = ref<NominaPago[]>([])
const loading = ref(true)
const expandidas = ref<NominaPago[]>([])

async function cargar(): Promise<void> {
  loading.value = true
  try {
    nominas.value = (await feathersClient.service('nominas-pago').find()) as NominaPago[]
  } catch (e) {
    toast.add({ severity: 'error', summary: 'No se pudieron cargar las nóminas', detail: e instanceof Error ? e.message : undefined, life: 5000 })
  } finally {
    loading.value = false
  }
}

async function descargar(nomina: NominaPago): Promise<void> {
  try {
    const completa = (await feathersClient.service('nominas-pago').get(nomina._id)) as NominaPago
    if (!completa.archivoContenido) throw new Error('La nómina no tiene archivo guardado')
    descargarArchivoTexto(completa.archivoNombre, completa.archivoContenido, completa.archivoMimeType)
  } catch (e) {
    toast.add({ severity: 'error', summary: 'No se pudo descargar', detail: e instanceof Error ? e.message : undefined, life: 5000 })
  }
}

function confirmarPagada(nomina: NominaPago): void {
  confirm.require({
    header: `Confirmar pago de la nómina N° ${nomina.numero}`,
    message: `Esto registra un abono de $${nomina.total.toLocaleString('es-CL')} repartido en ${nomina.items.length} documento(s), con fecha ${fechaCorta(nomina.fechaPago)}. Hazlo solo cuando el banco haya ejecutado la nómina. No se puede deshacer desde aquí.`,
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'El banco ya pagó, registrar abonos',
    acceptProps: { severity: 'success' },
    accept: () => cambiarEstado(nomina, 'pagada')
  })
}

function confirmarAnular(nomina: NominaPago): void {
  confirm.require({
    header: `Anular la nómina N° ${nomina.numero}`,
    message: 'La nómina queda anulada y sus facturas vuelven a estar disponibles para otra nómina. No se toca ningún abono. Si ya subiste el archivo al banco, anúlalo también allá.',
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Anular',
    acceptProps: { severity: 'danger' },
    accept: () => cambiarEstado(nomina, 'anulada')
  })
}

async function cambiarEstado(nomina: NominaPago, estado: 'pagada' | 'anulada'): Promise<void> {
  try {
    await feathersClient.service('nominas-pago').patch(nomina._id, { estado })
    toast.add({ severity: 'success', summary: estado === 'pagada' ? 'Abonos registrados' : 'Nómina anulada', life: 3000 })
    await cargar()
  } catch (e) {
    toast.add({ severity: 'error', summary: 'No se pudo cambiar el estado', detail: e instanceof Error ? e.message : undefined, life: 6000 })
  }
}

const rowMenu = ref()
const menuNomina = ref<NominaPago | null>(null)
const rowMenuItems = ref<MenuItem[]>([])

function toggleRowMenu(event: Event, nomina: NominaPago): void {
  menuNomina.value = nomina
  const items: MenuItem[] = [{ label: 'Descargar archivo', icon: 'pi pi-download', command: () => descargar(nomina) }]
  if (nomina.estado === 'generada') {
    items.push({ label: 'El banco ya pagó: registrar abonos', icon: 'pi pi-check', command: () => confirmarPagada(nomina) })
    items.push({ label: 'Anular', icon: 'pi pi-times', command: () => confirmarAnular(nomina) })
  }
  rowMenuItems.value = items
  rowMenu.value?.toggle(event)
}

const ESTADO: Record<NominaPago['estado'], { label: string; severity: 'warn' | 'success' | 'secondary' }> = {
  generada: { label: 'Generada, sin confirmar', severity: 'warn' },
  pagada: { label: 'Pagada', severity: 'success' },
  anulada: { label: 'Anulada', severity: 'secondary' }
}

const AYUDA: SeccionAyuda[] = [
  {
    titulo: '¿Qué es una nómina de pago?',
    texto:
      'Un archivo con varias transferencias a proveedores que se sube al portal del banco para pagarlas todas de una vez. Se arma en Compras seleccionando facturas con saldo; acá quedan las nóminas generadas.'
  },
  {
    titulo: 'El flujo',
    items: [
      { nombre: '1. Datos bancarios', descripcion: 'Cada proveedor necesita banco, tipo y número de cuenta en su ficha (Proveedores). El RUT del titular tiene que calzar con la cuenta: el banco lo valida.' },
      { nombre: '2. Generar', descripcion: 'En Compras, selecciona las facturas y usa "Nómina de pago". Se paga el saldo de cada una. Eliges el banco (formato), la fecha de pago y descargas el archivo.' },
      { nombre: '3. Subir al banco', descripcion: 'El archivo se carga en el portal del banco, donde lo aprueban los apoderados. Folio360 no mueve dinero: solo prepara el archivo.' },
      { nombre: '4. Confirmar', descripcion: 'Cuando el banco ejecutó la nómina, márcala como pagada: recién ahí se registra el abono en cada factura, con la fecha de pago de la nómina.' },
      { nombre: 'Anular', descripcion: 'Si no la subiste o el banco la rechazó, anúlala: las facturas quedan libres para otra nómina y no se registra ningún abono.' },
      { nombre: 'Doble pago', descripcion: 'Una factura que está en una nómina generada no puede entrar a otra hasta que esa se confirme o se anule.' }
    ]
  }
]

let unsubscribe: (() => void) | null = null
onMounted(() => {
  void cargar()
  const service = feathersClient.service('nominas-pago')
  const refrescar = (): void => void cargar()
  service.on('created', refrescar)
  service.on('patched', refrescar)
  unsubscribe = () => {
    service.removeListener('created', refrescar)
    service.removeListener('patched', refrescar)
  }
})
onUnmounted(() => unsubscribe?.())
</script>

<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">Nóminas de pago <AyudaPagina titulo="Nóminas de pago" :secciones="AYUDA" /></h1>
    </div>
    <p class="intro">
      Las nóminas se generan desde <RouterLink to="/purchases">Compras</RouterLink>, seleccionando las facturas con saldo.
      Aquí se vuelven a descargar, se confirman cuando el banco pagó, o se anulan.
    </p>

    <DataTable v-model:expanded-rows="expandidas" :value="nominas" :loading="loading" data-key="_id" striped-rows>
      <template #empty>Todavía no hay nóminas de pago.</template>
      <Column expander style="width: 3rem" />
      <Column header="N°">
        <template #body="{ data }"><strong>{{ data.numero }}</strong></template>
      </Column>
      <Column header="Banco">
        <template #body="{ data }">{{ data.banco }}</template>
      </Column>
      <Column header="Fecha de pago">
        <template #body="{ data }">{{ fechaCorta(data.fechaPago) }}</template>
      </Column>
      <Column header="Documentos">
        <template #body="{ data }">{{ data.items.length }}</template>
      </Column>
      <Column header="Total">
        <template #body="{ data }">${{ data.total.toLocaleString('es-CL') }}</template>
      </Column>
      <Column header="Estado">
        <template #body="{ data }">
          <div class="stacked-cell">
            <Tag :severity="ESTADO[data.estado as NominaPago['estado']].severity" :value="ESTADO[data.estado as NominaPago['estado']].label" />
            <span v-if="data.pagadaEn" class="muted">abonos con fecha {{ fechaCorta(data.fechaPago) }}</span>
          </div>
        </template>
      </Column>
      <Column header="Generada">
        <template #body="{ data }">{{ new Date(data.createdAt).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' }) }}</template>
      </Column>
      <Column header="" style="width: 3.5rem">
        <template #body="{ data }">
          <Button icon="pi pi-ellipsis-v" text @click="toggleRowMenu($event, data)" />
        </template>
      </Column>

      <template #expansion="{ data }">
        <table class="detalle">
          <thead>
            <tr><th>Proveedor</th><th>Documento</th><th>Titular</th><th>Banco y cuenta</th><th class="num">Monto</th></tr>
          </thead>
          <tbody>
            <tr v-for="item in data.items" :key="item.purchaseId">
              <td>{{ item.razonSocial }}</td>
              <td>{{ item.tipoDocumento === 'factura' ? 'Factura' : item.tipoDocumento }} {{ item.folio }}</td>
              <td>{{ item.nombreTitular }} <span class="muted">{{ item.rutTitular }}</span></td>
              <td>{{ nombreBanco(item.banco) }} · {{ nombreTipoCuenta(item.tipoCuenta) }} {{ item.numeroCuenta }}</td>
              <td class="num">${{ item.monto.toLocaleString('es-CL') }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="data.glosa" class="muted">Glosa: {{ data.glosa }}</p>
      </template>
    </DataTable>

    <Menu ref="rowMenu" :model="rowMenuItems" :popup="true" />
  </div>
</template>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; }
.intro { color: #64748b; font-size: 0.9rem; margin: 0 0 1rem; }
.stacked-cell { display: flex; flex-direction: column; gap: 0.2rem; }
.muted { color: #64748b; font-size: 0.8rem; }
.detalle { width: 100%; border-collapse: collapse; font-size: 0.85rem; margin: 0.25rem 0 0.5rem 3rem; }
.detalle th, .detalle td { text-align: left; padding: 0.3rem 0.5rem; border-bottom: 1px solid #f1f4f8; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
</style>
