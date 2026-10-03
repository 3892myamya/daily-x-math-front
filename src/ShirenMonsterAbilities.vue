<script setup>
defineProps({ monster: { type: Object, required: true } })
</script>

<template>
  <div class="monster-ability-content">
    <p v-if="monster.actionSpeed" class="monster-action-speed">行動速度：{{ monster.actionSpeed }}</p>
    <ul class="ability-list"><li v-for="ability in monster.abilities" :key="ability">{{ ability }}</li></ul>
  </div>
</template>

<style>
.shiren-app .monster-ability-content .monster-action-speed{margin:0 0 5px;font-size:11px;color:#475348;line-height:1.5}
.shiren-app .monster-ability-content .ability-list{margin:0;padding-left:16px;font-size:11px;line-height:1.5;color:#475348}
.shiren-app .monster-ability-content .ability-list li+li{margin-top:2px}
</style>
