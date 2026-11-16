import {writeFile,readFile,chmod} from 'node:fs/promises';
import path from 'node:path';
import {ROOT,credentials} from '../src/config.mjs';
import {TestStripe} from '../src/stripe.mjs';
import {cli} from './stripe-cli.mjs';

try {
  const {key}=await credentials();if(!key)throw new Error('CONNECT_TEST_STRIPE_FIRST');
  await new TestStripe(key).verify();
  // No --live, no tunnel, no public endpoint. Only test platform events are forwarded.
  const child=await cli(['listen','--events','checkout.session.completed,checkout.session.expired,payment_intent.amount_capturable_updated,payment_intent.succeeded,payment_intent.payment_failed,payment_intent.canceled,charge.refunded,charge.dispute.created,transfer.created,transfer.reversed,refund.updated','--forward-to','http://127.0.0.1:4189/stripe/webhook'],{env:{...process.env,STRIPE_API_KEY:key}});
  let saved=false,buffer='';
  const output=async chunk=>{
    buffer=(buffer+chunk.toString()).slice(-10000);
    const secret=buffer.match(/whsec_[A-Za-z0-9]+/)?.[0];
    if(secret&&!saved){saved=true;const file=path.join(ROOT,'.secrets/stripe.env');let existing='';try{existing=await readFile(file,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
      const lines=existing.split('\n').filter(l=>l&&!l.startsWith('STRIPE_WEBHOOK_SECRET='));lines.push(`STRIPE_WEBHOOK_SECRET=${secret}`);await writeFile(file,lines.join('\n')+'\n',{mode:0o600});await chmod(file,0o600);
      console.log('Signed TEST webhook forwarding ready. Restart the local Goöme server to load its signing secret.');
    }
    // Event payloads and keys are deliberately not echoed.
  };
  child.stdout.on('data',b=>output(b).catch(()=>{console.error('WEBHOOK_SECRET_SAVE_FAILED');child.kill();}));child.stderr.on('data',b=>output(b).catch(()=>child.kill()));
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>child.kill(signal));
  const code=await new Promise(r=>child.on('exit',r));if(code)throw new Error('STRIPE_LISTENER_STOPPED');
}catch(e){console.error(/^[A-Z_]+$/.test(e.message)?e.message:'STRIPE_LISTENER_FAILED');process.exitCode=1;}
