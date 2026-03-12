import { load } from '../../index.mjs';

const binding = load(import.meta.dirname, () => ({
  'linux-x64': () =>
    require('xml2json-napi/prebuilds/linux-x64+ia32/xml2json-napi.node'),
}));

console.log(binding.xml2json);
