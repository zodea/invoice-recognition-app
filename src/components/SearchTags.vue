<script setup>
import {computed} from 'vue';
import SearchSelect from './SearchSelect.vue';
import UiTag from './UiTag.vue';
import {splitTags} from '../lib/expense-options';
const props=defineProps({modelValue:{type:String,default:''},options:{type:Array,default:()=>[]}});const emit=defineEmits(['update:modelValue']);
const selected=computed(()=>splitTags(props.modelValue));const available=computed(()=>props.options.filter(v=>!selected.value.includes(v)));
function add(value){if(value)emit('update:modelValue',[...selected.value,value].join('、'));}
function remove(value){emit('update:modelValue',selected.value.filter(v=>v!==value).join('、'));}
</script><template><div class="search-tags"><div v-if="selected.length" class="selected-tags"><UiTag v-for="tag in selected" :key="tag" tone="blue">{{ tag }}<button type="button" :aria-label="'移除标签 '+tag" @click="remove(tag)">×</button></UiTag></div><SearchSelect :options="available" label="搜索自定义标签" placeholder="搜索并添加标签" @update:model-value="add" /></div></template><style scoped>.selected-tags{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}.selected-tags button{margin-left:5px;border:0;background:none;color:inherit;cursor:pointer}</style>
