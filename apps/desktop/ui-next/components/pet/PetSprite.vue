<template>
  <div class="sprite-wrap" aria-hidden="true">
    <div class="mirror" :class="{ flip: facing === 'left' }">
      <div class="sprite" :class="[rowClass, `pet-${sprite}`, sheetClass]" />
    </div>
    <div class="shadow" :class="`is-${state}`" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { AwogPetModel, AwogPetSprite, AwogPetState } from '~/types/awog-bridge'

// The pet itself (docs/features/desktop-pet.md).
//
// Artwork: pzUH's "Cute Girl - Free Sprites" (CC0 — public domain, no attribution
// required; credited anyway in public/pet/CREDITS.md, which also documents how the
// sheet is generated from the original PNG sequence).
// Every sheet shares the CELL, so adding a pet is a PNG plus one class here — and one
// entry in SHEET_12 if it was cut by tools/sprite-cutter.
//
// Sheet geometry — one ROW per state, frames left to right:
//   cell 132x128 → rendered at half size, cell 66x64
//   two column counts: legacy packs 10/8 (1320x896), sprite-cutter packs 12 (1584x896)
//   row 0 idle · 1 working · 2 awaiting · 3 done · 4 offline
//   row 5 working-alt · 6 idle-alt — the "scene changes" (see `alt`)
// `done` owns a row: packs that have something celebratory (a wink, an "OK!" sign) get
// to use it, and packs that don't just repeat a calm frame there.
//
// Motion budget, cheapest → busiest: `done`/`offline` are single still frames;
// `idle` loops slowly (this is what makes it read as a pet rather than a status
// icon); `working` runs; `awaiting` jumps to actually catch the eye. Only
// background-position animates — no layout, no JS, no requestAnimationFrame.
// `html[data-reduced-motion]` disables all of it.
const props = defineProps<{
  state: AwogPetState
  sprite: AwogPetSprite
  // Every pack's artwork faces RIGHT, so 'left' is the mirrored one.
  facing: AwogPetModel['facing']
  // Play the state's SECOND animation (walk instead of run, a stroll instead of the
  // breathing idle). The page swaps this on a timer so a long turn is not one loop
  // forever. States with no alternative just ignore it.
  alt?: boolean
}>()

const ALT_ROW: Partial<Record<AwogPetState, string>> = {
  working: 'is-working-alt',
  idle: 'is-idle-alt',
}

// Packs cut by tools/sprite-cutter: 12 frames per row instead of the legacy 10/8, so they
// need their own sheet width and row timings. One class rather than per-pack rules —
// nothing about the timings is pack-specific, only the column count is.
const SHEET_12: AwogPetSprite[] = ['shiba', 'dino', 'miku']

const rowClass = computed(() =>
  props.alt ? (ALT_ROW[props.state] ?? `is-${props.state}`) : `is-${props.state}`,
)
const sheetClass = computed(() => (SHEET_12.includes(props.sprite) ? 'sheet12' : ''))
</script>

<style scoped>
.sprite-wrap {
  position: relative;
  width: 66px;
  height: 68px;
  display: flex;
  justify-content: center;
}

.mirror {
  position: relative;
  width: 66px;
  height: 64px;
}
/* Mirror to face the other way. Safe alongside the background animation: the
   background is painted first, then the whole element is transformed. */
.flip {
  transform: scaleX(-1);
}

/* Two animations run together on the sprite: one steps through the FRAMES
   (background-position), the other adds body MOTION (transform). They touch different
   properties, so they compose.
   This layer is what makes a pet look alive rather than like a flip-book: these packs
   are drawn frame-by-frame by hand/AI, so they have no consistent volume of their own —
   the breathing and bobbing supply the continuity the artwork lacks. */
.sprite {
  transform-origin: bottom center;
  width: 66px;
  height: 64px;
  background-repeat: no-repeat;
  /* Half of the 1320x896 source → the extra pixels are the retina headroom. */
  background-size: 660px 448px;
  background-position: 0 0;
}
.pet-girl {
  background-image: url('/pet/girl.png');
}
.pet-dino {
  background-image: url('/pet/dino.png');
}
/* The only sheet built from an artwork set drawn for THIS purpose (one labelled block
   per animation), so every row is a real animation instead of a semantic stand-in:
   she runs to work, jumps to get your attention, lays an egg when a turn lands, and
   pecks the ground while idle. */
.pet-chicken {
  background-image: url('/pet/chicken.png');
}
/* PIXEL ART: the sheet is 1:1 with no resampling, so the browser must not smooth it
   on the way down to the display size — nearest-neighbour keeps the pixel grid.
   Local-only (gitignored): the pack allows USE but not redistribution, and this repo
   is public — see public/pet/CREDITS.md. */
.pet-bichon {
  background-image: url('/pet/bichon.png');
  image-rendering: pixelated;
}

.pet-shiba {
  background-image: url('/pet/shiba.png');
}
/* The only pack that is not an animal, so it is also the only one whose `awaiting` reads
   as a person waving rather than a creature hopping — same rows, different reading. */
.pet-miku {
  background-image: url('/pet/miku.png');
}

/* Row selection + per-state loop. The `to` offset is frames × cell width. */
.is-idle {
  background-position-y: 0;
  animation:
    play10 1.4s steps(10) infinite,
    pet-breathe 4.2s ease-in-out infinite;
}
.is-working {
  background-position-y: -64px;
  /* Bob at HALF the frame cycle: two bounces per stride is what a run reads as. */
  animation:
    play8 0.7s steps(8) infinite,
    pet-bob 0.35s ease-in-out infinite;
}
.is-awaiting {
  background-position-y: -128px;
  animation:
    play8 0.9s steps(8) infinite,
    pet-shake 0.9s ease-in-out infinite;
}
.is-done {
  background-position-y: -192px;
  animation:
    play8 1.1s steps(8) infinite,
    pet-breathe 3s ease-in-out infinite;
}
.is-offline {
  background-position-y: -256px;
  opacity: 0.45;
}
/* Scene changes: same state, different animation. */
.is-working-alt {
  background-position-y: -320px;
  animation:
    play8 0.9s steps(8) infinite,
    pet-bob 0.45s ease-in-out infinite;
}
.is-idle-alt {
  background-position-y: -384px;
  animation:
    play8 1.1s steps(8) infinite,
    pet-breathe 3.2s ease-in-out infinite;
}

/* ── 12-frame sheets (tools/sprite-cutter) ──────────────────────────────────────
   Same cell, same row order, more columns: the AI sources hold 13–19 poses per row and
   halving them to fit the legacy 10/8 layout would be a downgrade for no gain. Only two
   things change — the sheet width, and the frame count in each row's `animation`. Two
   classes beat the one-class rules above, so these win without !important, and
   `background-position-y` still comes from them. */
.sheet12 {
  /* Half of the 1584×896 source. */
  background-size: 792px 448px;
}
.sheet12.is-idle {
  /* These idle rows are a slow turn-round-and-back, so they want a long cycle — played
     at the run's tempo it looks like the animal is pacing. */
  animation:
    play12 2.6s steps(12) infinite,
    pet-breathe 4.2s ease-in-out infinite;
}
.sheet12.is-working {
  animation:
    play12 0.75s steps(12) infinite,
    pet-bob 0.375s ease-in-out infinite;
}
/* The jump arc is drawn INTO these frames, so no rotation is layered on top — the
   artwork already does the attention-grabbing that pet-shake was standing in for. */
.sheet12.is-awaiting {
  animation: play12 0.95s steps(12) infinite;
}
.sheet12.is-done {
  animation:
    play12 2.2s steps(12) infinite,
    pet-breathe 3s ease-in-out infinite;
}
.sheet12.is-working-alt {
  animation:
    play12 1.1s steps(12) infinite,
    pet-bob 0.55s ease-in-out infinite;
}
.sheet12.is-idle-alt {
  animation: play12 1.6s steps(12) infinite;
}

@keyframes pet-breathe {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.035);
  }
}
@keyframes pet-bob {
  0%,
  100% {
    transform: translateY(0) scaleY(1);
  }
  50% {
    transform: translateY(-2.5px) scaleY(1.02);
  }
}
@keyframes pet-shake {
  0%,
  60%,
  100% {
    transform: rotate(0deg);
  }
  70% {
    transform: rotate(-4deg);
  }
  85% {
    transform: rotate(4deg);
  }
}

@keyframes play10 {
  to {
    background-position-x: -660px;
  }
}
@keyframes play8 {
  to {
    background-position-x: -528px;
  }
}
/* 12 × the 66px display cell — the shiba sheet's row length. */
@keyframes play12 {
  to {
    background-position-x: -792px;
  }
}

/* ── Still kits: no frames to play, so animate the sprite itself. Two classes beat the
   one-class row rules above, so these win without !important. ── */

/* Grounding shadow — the artwork has none, and without it the pet looks pasted on
   top of the desktop rather than sitting on it. */
.shadow {
  position: absolute;
  bottom: 0;
  width: 34px;
  height: 5px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.3);
  filter: blur(2px);
}
.shadow.is-offline {
  opacity: 0.4;
}
/* The shadow tightens as the pet lifts — without it the bob reads as the whole
   sticker sliding up, not the animal pushing off the ground. */
.shadow.is-working {
  animation: pet-shadow 0.35s ease-in-out infinite;
}
@keyframes pet-shadow {
  0%,
  100% {
    transform: scaleX(1);
    opacity: 1;
  }
  50% {
    transform: scaleX(0.86);
    opacity: 0.75;
  }
}
</style>
