<script setup lang="ts">
import { computed } from 'vue'
import type { Customer, DteDocument, Organization, Supplier } from '@/types'

const props = defineProps<{
  document: DteDocument
  // Cliente para la mayoría de los tipos; proveedor para Factura de Compra
  // (46) — ver document.model.ts en el servidor.
  customer: Customer | Supplier | undefined
  organization: Organization | undefined
}>()

function formatMoney(value: number): string {
  return value.toLocaleString('es-CL')
}

const fechaEmision = computed(() => {
  const raw = props.document.fechaEmision ?? props.document.createdAt
  return new Date(raw).toLocaleDateString('es-CL')
})

const itemRows = computed(() =>
  props.document.items.map((item) => ({
    ...item,
    montoItem: Math.round(item.cantidad * item.precioUnit - (item.descuento ?? 0))
  }))
)

const tipoDteLabel: Record<number, string> = {
  33: 'FACTURA ELECTRÓNICA',
  34: 'FACTURA NO AFECTA O EXENTA ELECTRÓNICA',
  46: 'FACTURA DE COMPRA ELECTRÓNICA',
  52: 'GUÍA DE DESPACHO ELECTRÓNICA',
  56: 'NOTA DE DÉBITO ELECTRÓNICA',
  61: 'NOTA DE CRÉDITO ELECTRÓNICA'
}
</script>

<template>
  <div class="factura">
    <div v-if="document.estado === 'draft'" class="draft-watermark">BORRADOR — no es un documento tributario válido</div>

    <div class="factura-header">
      <div class="emisor">
        <div class="emisor-nombre">{{ organization?.razonSocial }}</div>
        <div>RUT: {{ organization?.rut }}</div>
        <div v-if="organization?.giro">Giro: {{ organization.giro }}</div>
        <div v-if="organization?.direccion?.calle">
          {{ organization.direccion.calle }}<span v-if="organization.direccion.comuna">, {{ organization.direccion.comuna }}</span>
        </div>
      </div>

      <div class="folio-box">
        <div class="folio-tipo">{{ tipoDteLabel[document.tipoDte] ?? `DTE TIPO ${document.tipoDte}` }}</div>
        <div class="folio-numero">N° {{ document.folio ?? 'sin folio (borrador)' }}</div>
        <div class="folio-rut">R.U.T.: {{ organization?.rut }}</div>
      </div>
    </div>

    <div class="factura-receptor">
      <div><strong>{{ document.tipoDte === 46 ? 'Señor(es) (Proveedor):' : 'Señor(es):' }}</strong> {{ customer?.razonSocial }}</div>
      <div class="receptor-grid">
        <div>RUT: {{ customer?.rut }}</div>
        <div v-if="customer?.giro">Giro: {{ customer.giro }}</div>
        <div v-if="customer?.direccion">Dirección: {{ customer.direccion }}</div>
        <div v-if="customer?.comuna">Comuna: {{ customer.comuna }}</div>
        <div>Fecha emisión: {{ fechaEmision }}</div>
      </div>
    </div>

    <table class="factura-items">
      <thead>
        <tr>
          <th>Descripción</th>
          <th class="num">Cantidad</th>
          <th class="num">P. Unitario</th>
          <th class="num">Descuento</th>
          <th class="num">Total</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(item, index) in itemRows" :key="index">
          <td>{{ item.descripcion }}<span v-if="item.exento" class="exento-tag">EXENTO</span></td>
          <td class="num">{{ item.cantidad }}</td>
          <td class="num">{{ formatMoney(item.precioUnit) }}</td>
          <td class="num">{{ formatMoney(item.descuento) }}</td>
          <td class="num">{{ formatMoney(item.montoItem) }}</td>
        </tr>
      </tbody>
    </table>

    <div class="factura-totales">
      <div class="totales-box">
        <!-- Factura No Afecta o Exenta (34): el Manual de Muestras Impresas
        exige no informar Neto ni IVA, solo Exento y Total — igual que en
        dte-pdf.ts's buildTotales, ver signing/dte-xml.ts. -->
        <template v-if="document.tipoDte === 34">
          <div class="totales-row"><span>Monto Exento</span><span>${{ formatMoney(document.montos.total) }}</span></div>
        </template>
        <template v-else>
          <div class="totales-row"><span>Monto Neto</span><span>${{ formatMoney(document.montos.neto) }}</span></div>
          <div v-if="document.montos.exento > 0" class="totales-row">
            <span>Monto Exento</span><span>${{ formatMoney(document.montos.exento) }}</span>
          </div>
          <div class="totales-row"><span>I.V.A. (19%)</span><span>${{ formatMoney(document.montos.iva) }}</span></div>
        </template>
        <div class="totales-row totales-total"><span>Total</span><span>${{ formatMoney(document.montos.total) }}</span></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.factura {
  position: relative;
  background: #fff;
  border: 1px solid var(--card-border);
  border-radius: 8px;
  padding: 1.75rem;
  font-size: 0.85rem;
  color: #1e293b;
}

.draft-watermark {
  position: absolute;
  top: 0.75rem;
  right: 1.75rem;
  color: #dc2626;
  font-weight: 700;
  font-size: 0.7rem;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}

.factura-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 2px solid #1e293b;
}

.emisor-nombre {
  font-weight: 700;
  font-size: 1rem;
  margin-bottom: 0.25rem;
}

.folio-box {
  border: 1px solid #1e293b;
  border-radius: 4px;
  padding: 0.75rem 1.25rem;
  text-align: center;
  min-width: 220px;
}

.folio-tipo {
  font-weight: 700;
  font-size: 0.8rem;
  letter-spacing: 0.02em;
}

.folio-numero {
  font-weight: 700;
  font-size: 1.1rem;
  margin: 0.25rem 0;
}

.folio-rut {
  font-size: 0.78rem;
  color: #64748b;
}

.factura-receptor {
  padding: 1rem 0;
  border-bottom: 1px solid var(--card-border);
}

.receptor-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.25rem 1.5rem;
  margin-top: 0.4rem;
  color: #475569;
}

.factura-items {
  width: 100%;
  border-collapse: collapse;
  margin-top: 1rem;
}

.factura-items th {
  text-align: left;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: #64748b;
  border-bottom: 1px solid var(--card-border);
  padding: 0.4rem 0.3rem;
}

.factura-items td {
  padding: 0.45rem 0.3rem;
  border-bottom: 1px solid #f1f4f8;
}

.factura-items .num {
  text-align: right;
}

.exento-tag {
  margin-left: 0.5rem;
  font-size: 0.65rem;
  font-weight: 700;
  color: #b45309;
}

.factura-totales {
  display: flex;
  justify-content: flex-end;
  margin-top: 1rem;
}

.totales-box {
  min-width: 240px;
}

.totales-row {
  display: flex;
  justify-content: space-between;
  padding: 0.25rem 0;
}

.totales-total {
  border-top: 1px solid #1e293b;
  margin-top: 0.25rem;
  padding-top: 0.5rem;
  font-weight: 700;
  font-size: 0.95rem;
}
</style>
