import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'ops-sandbox-'));
process.env.SANDBOX_DIR=path.join(temporary,'sandbox');
const {resolveSandboxPath,ensureSandboxDirExists}=require('../src/tools/sandbox');
const {writeLocalFile}=require('../src/tools/writeLocalFile');

test('new files cannot escape through symlinked parents',async()=>{
  try {
    ensureSandboxDirExists();
    const outside=path.join(temporary,'outside');fs.mkdirSync(outside);
    fs.symlinkSync(outside,path.join(process.env.SANDBOX_DIR!,'escape'),'dir');
    const result=await writeLocalFile({path:'escape/new/deep.txt',content:'must not escape'});
    assert.equal(result.ok,false);
    assert.deepEqual(fs.readdirSync(outside),[]);
    assert.throws(()=>resolveSandboxPath(path.join(process.env.SANDBOX_DIR!,'absolute.txt')));
    const valid=await writeLocalFile({path:'nested/new.txt',content:'inside'});
    assert.equal(valid.ok,true);
    assert.equal(fs.readFileSync(path.join(process.env.SANDBOX_DIR!,'nested/new.txt'),'utf8'),'inside');
    assert.ok(resolveSandboxPath('..notes.txt').startsWith(process.env.SANDBOX_DIR!));
  }finally{fs.rmSync(temporary,{recursive:true,force:true});}
});
