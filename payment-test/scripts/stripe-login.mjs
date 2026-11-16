import {readFile,writeFile,chmod} from 'node:fs/promises';
import path from 'node:path';
import {ROOT,ACCOUNT,credentials} from '../src/config.mjs';
import {TestStripe} from '../src/stripe.mjs';
import {capture,cli} from './stripe-cli.mjs';

const pending=path.join(ROOT,'.secrets/login-pending.json');
try {
  if(process.argv.includes('--complete')) {
    const data=JSON.parse(await readFile(pending,'utf8'));
    // Do not execute the returned shell command. Only pass its validated polling URL as one argument.
    const device=data.next_step==='stripe login --complete-device';
    const complete=data.next_step?.match(/--complete\s+['"]?(https:\/\/dashboard\.stripe\.com\/[^\s'"]+)/)?.[1];
    if(!device&&!complete)throw new Error('INVALID_STRIPE_LOGIN_RESPONSE');
    if(complete){const url=new URL(complete);if(url.hostname!=='dashboard.stripe.com'||url.protocol!=='https:')throw new Error('INVALID_STRIPE_LOGIN_RESPONSE');}
    console.log('Waiting for approval for the Goöme TEST sandbox only…');
    const child=await cli(device?['login','--complete-device']:['login','--complete',complete]);
    for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>child.kill(signal));
    // CLI login may print credential values. Keep them out of terminal/chat/log output.
    child.stdout.resume();child.stderr.resume();
    const code=await new Promise(r=>child.on('exit',r));if(code!==0)throw new Error('STRIPE_LOGIN_NOT_COMPLETED');
    const config=path.join(ROOT,'.secrets/stripe-cli.toml');let content=await readFile(config,'utf8');
    // The app can only use test keys. Remove any live fields defensively, without displaying them.
    content=content.split('\n').filter(l=>!/^\s*live_mode_/.test(l)).join('\n');await writeFile(config,content,{mode:0o600});await chmod(config,0o600);
    const {key}=await credentials();if(!key)throw new Error('TEST_KEY_NOT_FOUND');
    await new TestStripe(key).verify();
    console.log(`Connected to ${ACCOUNT}, TEST only. Restart the local server and run npm run stripe:listen.`);
  } else {
    const output=await capture(['login','--non-interactive']);
    const start=output.indexOf('{'),end=output.lastIndexOf('}');if(start<0)throw new Error('INVALID_STRIPE_LOGIN_RESPONSE');
    const data=JSON.parse(output.slice(start,end+1));
    const url=new URL(data.browser_url);if(!['dashboard.stripe.com','access.stripe.com'].includes(url.hostname)||url.protocol!=='https:')throw new Error('INVALID_STRIPE_LOGIN_RESPONSE');
    await writeFile(pending,JSON.stringify(data),{mode:0o600});await chmod(pending,0o600);
    console.log(`Authorize ONLY “environnement de test Goöme” (${ACCOUNT}). Do not select a live account.`);
    console.log(`Stripe authorization: ${url.href}`);
    console.log(`Verification code: ${data.verification_code}`);
    console.log('Then run: npm run stripe:login -- --complete');
  }
}catch(e){console.error(/^[A-Z_]+$/.test(e.message)?e.message:'STRIPE_LOGIN_FAILED');process.exitCode=1;}
