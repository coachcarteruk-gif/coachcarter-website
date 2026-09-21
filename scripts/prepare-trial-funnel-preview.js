// Creates an isolated LOCAL Vercel workspace. Never deploy this test wrapper.
const fs=require('fs');
const path=require('path');
const os=require('os');
const root=path.resolve(__dirname,'..');
const preview=path.join(os.tmpdir(),'coachcarter-trial-funnel-preview');
async function main(){
  const helper=require('../tests/helpers/trial-funnel-fixture');
  await helper.bootstrap();const {sql,pool}=helper.database();
  let fixture;try{fixture=await helper.seed(sql,'preview-'+Date.now());await helper.enableQuestionnaire(sql);await sql`DELETE FROM rate_limits`;}finally{await pool.end();}
  fs.mkdirSync(path.join(preview,'api'),{recursive:true});
  fs.mkdirSync(path.join(preview,'.vercel'),{recursive:true});
  for(const dir of ['public','node_modules'])if(!fs.existsSync(path.join(preview,dir)))fs.symlinkSync(path.join(root,dir),path.join(preview,dir),'junction');
  fs.copyFileSync(path.join(root,'.vercel/project.json'),path.join(preview,'.vercel/project.json'));
  fs.copyFileSync(path.join(root,'middleware.js'),path.join(preview,'middleware.js'));
  const config=JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));
  delete config.crons; // No automation exists in the isolated runtime.
  config.buildCommand='';config.devCommand='';config.framework=null;config.outputDirectory='public';
  fs.writeFileSync(path.join(preview,'vercel.json'),JSON.stringify(config,null,2));
  fs.writeFileSync(path.join(preview,'package.json'),JSON.stringify({name:'isolated-trial-funnel-preview',private:true,engines:{node:'22.x'}}));
  for(const name of ['slots','learner','instructor','admin','schools','trial-requests'])fs.writeFileSync(path.join(preview,'api',name+'.js'),
    `require(${JSON.stringify(path.join(root,'tests/helpers/trial-funnel-fixture'))}).installMocks();\nmodule.exports = require(${JSON.stringify(path.join(root,'api',name+'.js'))});\n`);
  // Never call a real consent collector, notification/payment or auth-code service.
  fs.writeFileSync(path.join(preview,'api/config.js'),"module.exports=(req,res)=>res.json({ok:true});\n");
  fs.writeFileSync(path.join(preview,'fixture.json'),JSON.stringify(fixture));
  console.log(JSON.stringify({preview,fixture,command:'vercel dev --yes --listen 3107 --cwd '+preview}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
