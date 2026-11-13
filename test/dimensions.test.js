import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {publicPackage} from '../src/package.js';
import catalog from '../src/catalog.json' with {type:'json'};

function png(width, height) {
  function chunk(name, data) {
    const bytes = Buffer.alloc(data.length + 12);
    bytes.writeUInt32BE(data.length); bytes.write(name, 4); data.copy(bytes, 8);
    let crc = 0xffffffff;
    for (const byte of bytes.subarray(4, -4)) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    bytes.writeUInt32BE((crc ^ 0xffffffff) >>> 0, bytes.length - 4);
    return bytes;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.alloc((width * 4 + 1) * height))), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}

for (const ratio of [1, 2]) {
  test(`publisher accepts supported ${ratio}:1 resolutions, not exact original dimensions`, async () => {
    const entry = Object.entries(catalog.materials).find(([key, value]) =>
      catalog.models[key.split('|')[0]] && value.width === value.height * ratio);
    assert.ok(entry, 'Trusted catalog must include the tested aspect ratio');
    const [key, material] = entry, [modelPath, vmtPath] = key.split('|');
    const input = {
      title:'Resolution regression', preview:png(1, 1),
      draft:{modelPath, slotSelections:{}, textures:[
        {partPath:modelPath, vmtPath, vtfPath:material.vtf, png:''},
      ]},
    };
    for (const width of [256, 512, 1024, 4096]) {
      input.draft.textures[0].png = png(width, width / ratio);
      const prepared = await publicPackage(input);
      assert.equal(prepared.draft.textures.length, 1);
      const output = Buffer.from(prepared.draft.textures[0].png.split(',')[1], 'base64');
      assert.equal(output.readUInt32BE(16), width);
      assert.equal(output.readUInt32BE(20), width / ratio);
    }
    for (const [width, height] of [[300, 300 / ratio], [512, 512 / ratio / 2], [8192, 8192 / ratio]]) {
      input.draft.textures[0].png = png(width, height);
      await assert.rejects(() => publicPackage(input), /power-of-two dimensions|up to 4096/);
    }
  });
}
