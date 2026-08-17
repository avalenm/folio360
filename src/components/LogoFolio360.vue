<script setup lang="ts">
// El logo de Folio360, en SVG y no como imagen, por dos razones: se ve nítido
// en cualquier tamaño y pantalla, y los colores se pueden adaptar al fondo
// donde va. El original es azul marino sobre blanco; sobre la barra lateral
// oscura (#0f1b2d) ese azul marino sería invisible, así que la variante
// `oscuro` invierte lo que sería tinta y deja el azul solo como acento.
//
// Los tres colores salen de props para no tener dos copias del dibujo.
const props = withDefaults(
  defineProps<{
    variante?: 'claro' | 'oscuro'
    alto?: number
  }>(),
  { variante: 'oscuro', alto: 34 }
)

// `tinta` es lo que en el original es azul marino (el trazo del documento y
// la palabra), `acento` el azul, y `apagado` el gris del "36".
const colores = {
  // Sobre fondo claro: los del original.
  claro: { tinta: '#1e293b', acento: '#2563eb', apagado: '#94a3b8' },
  // Sobre fondo oscuro: la tinta pasa a blanco y el azul se aclara, porque
  // el #2563eb del original no llega a 4.5:1 contra el navy de la barra.
  oscuro: { tinta: '#ffffff', acento: '#60a5fa', apagado: '#94a3b8' }
} as const

const c = () => colores[props.variante]
</script>

<template>
  <svg
    :height="alto"
    viewBox="0 0 288 78"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label="Folio360"
  >
    <!-- Documento con la esquina doblada. El trazo abierto arriba a la
         derecha es lo que deja ver el doblez. -->
    <path
      d="M8 16a8 8 0 0 1 8-8h22l16 16v38a8 8 0 0 1-8 8H16a8 8 0 0 1-8-8V16Z"
      fill="none"
      :stroke="c().tinta"
      stroke-width="5"
      stroke-linejoin="round"
    />
    <!-- El doblez: el triángulo de la esquina, en azul. -->
    <path d="M38 8l16 16H38V8Z" :fill="c().acento" />
    <!-- Las líneas de texto del documento, decrecientes. -->
    <path
      d="M20 38h22M20 47h22M20 56h13"
      fill="none"
      :stroke="c().acento"
      stroke-width="4.5"
      stroke-linecap="round"
    />

    <!-- La palabra. Se compone con la tipografía de la app en vez de ir como
         trazos: así hereda el renderizado del sistema y no se ve pixelada ni
         desalineada entre plataformas. -->
    <text
      x="78"
      y="56"
      :fill="c().tinta"
      font-size="50"
      font-weight="700"
      letter-spacing="-1.5"
      font-family="Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    >
      folio
    </text>

    <!-- La regla azul bajo la palabra, que en el original la separa del 360. -->
    <path d="M80 66h132" :stroke="c().acento" stroke-width="5" stroke-linecap="round" />

    <!-- Anclado por su borde DERECHO: así la separación con el cero no
         depende de cuánto mida "36" en la fuente que le toque al sistema. -->
    <text
      x="255"
      y="70"
      text-anchor="end"
      :fill="c().apagado"
      font-size="26"
      font-weight="600"
      font-family="Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    >
      36
    </text>

    <!-- El cero es una flecha circular: el "360" de dar la vuelta completa.
         El arco abre 50° arriba a la derecha y termina justo arriba, donde la
         punta de flecha apunta hacia la derecha — que es lo que hace que se
         lea como un giro y no como un cero cualquiera. -->
    <path
      d="M277.3 54.9A9.5 9.5 0 1 1 270 51.5"
      fill="none"
      :stroke="c().acento"
      stroke-width="4"
      stroke-linecap="round"
    />
    <path d="M268 47.9l7 3.6-7 3.6v-7.2Z" :fill="c().acento" />
  </svg>
</template>
