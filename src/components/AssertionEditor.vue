<script setup lang="ts">
import { useId } from 'vue'
// Keep the component instance suffix unique, including recursive and repeated components.
const divId = useId()

import { computed, ref, watch } from 'vue'
import type { StepDraft } from '../task-editor'
import { useDialogFocus } from '../useDialogFocus'
import UiIcon from './UiIcon.vue'
import IconAction from './IconAction.vue'
const props = defineProps<{ step: StepDraft; busy: boolean; issues: string[] }>()
const emit = defineEmits<{ change: [] }>()
const example = 'def assert(responseBody, globalParam):\n    return responseBody.get("code") == 0\n'
const open = ref(false)
const code = ref('')
const configured = computed(() => !!props.step.assertion_code?.trim())
const rememberTrigger = useDialogFocus(() => open.value)
function edit() {
  rememberTrigger()
  code.value = props.step.assertion_code ?? ''
  open.value = true
}
function confirm() {
  if (props.busy) return
  if (code.value !== (props.step.assertion_code ?? '')) {
    props.step.assertion_code = code.value
    emit('change')
  }
  open.value = false
}
watch(() => props.step.key, () => { open.value = false })
</script>

<template>
  <IconAction :disabled="busy" @click="edit" icon="code" :label="configured ? '编辑断言' : '添加断言'"/>
  <Teleport to="body">
    <div :id="'assertion-editor-overlay-' + divId" v-if="open" class="overlay assertion-overlay" @click.self="open = false" @keydown.esc.stop="open = false">
      <section class="dialog assertion-dialog" role="dialog" aria-modal="true" :aria-labelledby="'assertion-title-'+step.key" tabindex="-1">
        <div :id="'assertion-editor-dialog-heading-' + divId" class="dialog-heading"><h2 :id="'assertion-title-'+step.key">{{ configured ? '编辑断言' : '添加断言' }}</h2><button type="button" class="icon-button" aria-label="关闭断言编辑" @click="open = false"><UiIcon name="close"/></button></div>
        <div :id="'assertion-editor-actions-' + divId" class="actions"><button type="button" :disabled="busy || !!code.trim()" @click="code = example">填入示例</button><button type="button" :disabled="busy || !code" @click="code = ''">清除断言</button></div>
        <label :for="'assertion-code-'+step.key">完整断言代码<textarea :id="'assertion-code-'+step.key" v-model="code" :disabled="busy" rows="10" autofocus spellcheck="false" autocapitalize="off" autocomplete="off" :placeholder="example" :aria-invalid="issues.length > 0" :aria-describedby="'assertion-help-'+step.key"></textarea></label>
        <p :id="'assertion-help-'+step.key" class="muted">入口为 def assert(responseBody, globalParam):，返回 True 或 False。清空并确认会移除断言；确认后请保存任务。</p>
        <p v-for="(issue,index) in issues" :key="index" class="step-error" role="alert">{{ issue }}</p>
        <div :id="'assertion-editor-dialog-actions-' + divId" class="dialog-actions"><button type="button" @click="open = false">取消</button><button type="button" class="primary" :disabled="busy" @click="confirm">确认</button></div>
      </section>
    </div>
  </Teleport>
</template>
