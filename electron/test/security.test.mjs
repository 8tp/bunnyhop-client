import test from 'node:test';
import assert from 'node:assert/strict';
import {deepLinkTarget,downloadDecision,sanitizeRunSummary,isArchivableRun,settingsAssetName} from '../security.mjs';
import {isGameUrl,isAllowedNavigation,buildFlags} from '../policy.mjs';
import {sanitizeSettings,applyPreset} from '../settings.mjs';
test('trusted navigation rejects spoofed hosts, credentials and local files',()=>{
 for(const u of ['https://bunnyhop.lol.evil.test','http://bunnyhop.lol/','file:///etc/passwd','https://user@bunnyhop.lol/']) assert.equal(isGameUrl(u),false);
 assert.equal(isAllowedNavigation('https://discord.com/oauth2/authorize'),true);
 assert.equal(isAllowedNavigation('https://example.com'),false);
});
test('deep links map only game routes and never escape origin',()=>{
 assert.equal(deepLinkTarget('bunnyhop://map/bhop_arcane'),'https://bunnyhop.lol/?map=bhop_arcane');
 assert.equal(deepLinkTarget('bunnyhop://replay/abc123'),'https://bunnyhop.lol/replay/abc123');
 for(const u of ['bunnyhop://map/../evil','bunnyhop://open?url=https://evil.test','bunnyhop://replay/%2fetc','bunnyhop://user@map/foo']) assert.equal(deepLinkTarget(u),null);
});
test('replay downloads have a user-selected destination and executable downloads refused',()=>{
 assert.equal(downloadDecision({pageUrl:'https://bunnyhop.lol',downloadUrl:'blob:https://bunnyhop.lol/id',filename:'run.bhr'}).filename,'run.bhr');
 assert.equal(downloadDecision({pageUrl:'https://evil.test',downloadUrl:'data:text/plain,x',filename:'run.bhr'}),null);
 assert.equal(downloadDecision({pageUrl:'https://bunnyhop.lol',downloadUrl:'https://bunnyhop.lol/run.exe',filename:'run.exe'}),null);
});
test('summaries are bounded data and do not grant score authority',()=>{
 const s=sanitizeRunSummary({mapId:'x'.repeat(200),mapName:'Test',timeMs:1000,ticks:128,tickRate:128,verified:'true',mode:'invalid',secret:'x'});
 assert.equal(s.mapId.length,80);assert.equal(s.verified,false);assert.equal(s.mode,'solo');assert.equal('secret' in s,false);
 assert.equal(isArchivableRun(s),true);assert.equal(isArchivableRun({...s,timeMs:null}),false);
 assert.equal(sanitizeRunSummary({timeMs:Infinity,ticks:-1}).timeMs,null);
});
test('settings assets have an exact allowlist and balanced defaults avoid rendering flags',()=>{
 assert.equal(settingsAssetName('bunnyhop-settings://app/../../secret'),null);
 assert.equal(settingsAssetName('bunnyhop-settings://app/index.html'),'index.html');
 assert.deepEqual(buildFlags(sanitizeSettings()),['--force_high_performance_gpu']);
 assert.equal(sanitizeSettings().discordApplicationId,'1556467060916224040');
 for(const profile of ['competitive','balanced','compatibility']) assert.equal(buildFlags(applyPreset({},profile)).includes('--disable-frame-rate-limit'),false);
 assert.equal('sidecarMode' in sanitizeSettings({sidecarMode:'complete'}),false);
});
