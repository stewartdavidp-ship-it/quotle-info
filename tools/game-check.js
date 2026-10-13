// node tools/game-check.js <todo.json> <enriched.json>  → validates enrichment output against the brief
const fs=require('fs');const [todoF,outF]=process.argv.slice(2);
const todo=new Map(JSON.parse(fs.readFileSync(todoF)).map(t=>[t.slug,t]));const out=JSON.parse(fs.readFileSync(outF));
const CAT=['Speech','Literature','Philosophy','Science','Activism','Business','Art','Film','Music','Sports'];
const PER=['Ancient','1200s','1300s','1400s','1500s','1600s','1700s','1800s','1900s','2000s'];
let bad=0;const byAuthor={};
for(const o of out){const t=todo.get(o.slug);const e=[];
 if(!t)e.push('unknown slug');
 if(!['Male','Female'].includes(o.gender))e.push('gender '+o.gender);
 if(!CAT.includes(o.category))e.push('category '+o.category);
 if(!PER.includes(o.period))e.push('period '+o.period);
 if(!(Number.isInteger(o.difficulty)&&o.difficulty>=2&&o.difficulty<=9))e.push('difficulty '+o.difficulty);
 if(!o.hint||o.hint.length>115)e.push('hint length '+(o.hint||'').length);
 if(t){const parts=t.author.split(/\s+/).filter(w=>w.length>3&&!/^(the|von|van|de)$/i.test(w));if(parts.some(w=>new RegExp('\\b'+w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\b','i').test(o.hint||'')))e.push('hint names author');}
 if(!o.location||o.location.length<3)e.push('location');
 if(!o.year||!/^(\d{1,4}s?|\d{1,4}s? (BCE|CE)|Ancient)$/.test(o.year))e.push('year '+o.year);
 if(t&&t.knownAuthor){for(const k of ['gender','category','period'])if(o[k]!==t.knownAuthor[k])e.push(k+' differs from game: '+o[k]+' vs '+t.knownAuthor[k]);}
 if(t){const a=byAuthor[t.authorSlug]=byAuthor[t.authorSlug]||{};for(const k of ['gender','category','period']){a[k]=a[k]||new Set();a[k].add(o[k]);}}
 if(e.length){bad++;console.log('✗',o.slug,'—',e.join('; '));}}
for(const [s,a] of Object.entries(byAuthor))for(const k in a)if(a[k].size>1){bad++;console.log('✗ author',s,k,'inconsistent:',[...a[k]].join(','));}
const missing=[...todo.keys()].filter(s=>!out.some(o=>o.slug===s));
console.log(`${out.length} checked, ${bad} problems, ${missing.length} of the batch missing`);process.exit(bad?1:0);
