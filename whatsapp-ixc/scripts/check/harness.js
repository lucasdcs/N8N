// Mini-harness do n8n: roda o jsCode de um no com $json, $input, $('No') e $getWorkflowStaticData
const fs = require('fs'), vm = require('vm');
function run(code, { item, items, nodes = {}, static_ = {} }) {
  items = items || [item];
  const $ = (name) => { const its = nodes[name]; if (!its) throw new Error('no sem dados: ' + name); return { first: () => its[0], all: () => its, item: its[0], itemMatching: (i) => its[i] }; };
  const ctx = { $json: items[0].json, $input: { all: () => items, first: () => items[0], item: items[0] }, $: $, $getWorkflowStaticData: () => static_, console };
  return vm.runInNewContext(`(function(){\n${code}\n})()`, ctx);
}
module.exports = { run };
