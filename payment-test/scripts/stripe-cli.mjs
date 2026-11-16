import {spawn} from 'node:child_process';
import {ROOT,privateDirs} from '../src/config.mjs';
import path from 'node:path';
export const cliArgs=['exec','--yes','--package=@stripe/cli@1.55.8','--','stripe','--config',path.join(ROOT,'.secrets/stripe-cli.toml'),'--project-name','goome-payments-test','--color','off'];
export async function cli(args,extra={}) {
  await privateDirs();
  return spawn('npm',[...cliArgs,...args],{cwd:ROOT,stdio:['ignore','pipe','pipe'],...extra});
}
export async function capture(args) {
  const child=await cli(args);let output='';
  child.stdout.on('data',b=>output+=b.toString());child.stderr.on('data',b=>output+=b.toString());
  const code=await new Promise(r=>child.on('exit',r));if(code!==0)throw new Error('STRIPE_CLI_FAILED');return output;
}
