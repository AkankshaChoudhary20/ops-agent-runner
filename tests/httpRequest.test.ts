import {test} from 'node:test';
import assert from 'node:assert/strict';
import {httpRequest} from '../src/tools/httpRequest';
test('large responses are cancelled before buffering the entire stream',async()=>{
 const original=globalThis.fetch; let cancelled=false,reads=0;
 globalThis.fetch=async()=>new Response(new ReadableStream({pull(c){reads++;if(reads>10){c.close();return;}c.enqueue(new TextEncoder().encode('x'.repeat(4000)));},cancel(){cancelled=true;}}));
 try {const result=await httpRequest({url:'https://example.com'});assert.equal(result.ok,true);assert.equal(result.body,'x'.repeat(8000)+'\n...[truncated]');assert.equal(cancelled,true);assert.ok(reads<=4);}finally{globalThis.fetch=original;}
});
test('UTF-8 split across chunks is decoded without corruption',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async()=>new Response(new ReadableStream({start(c){for(const b of new TextEncoder().encode('€'))c.enqueue(new Uint8Array([b]));c.close();}}));
 try {assert.equal((await httpRequest({url:'https://example.com'})).body,'€');}finally{globalThis.fetch=original;}
});
