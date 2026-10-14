import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
function walk(dir) { return readdirSync(dir,{withFileTypes:true}).flatMap(e=> e.isDirectory()?walk(`${dir}/${e.name}`): [`${dir}/${e.name}`]); }
for (const file of [...walk('electron'), ...walk('scripts')].filter(f=>/\.(mjs|cjs|js)$/.test(f))) {
 const result=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});
 if(result.status) process.exit(result.status);
}
