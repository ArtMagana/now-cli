import chalk from 'chalk';
import psl from 'psl';

import { NowContext } from '../../types';
import { Output } from '../../util/output';
import * as ERRORS from '../../util/errors-ts';
import Client from '../../util/client';
import cmd from '../../util/output/cmd';
import getScope from '../../util/get-scope';
import param from '../../util/output/param';
import transferInDomain from '../../util/domains/transfer-in-domain';
import stamp from '../../util/output/stamp';
import getAuthCode from '../../util/domains/get-auth-code';
import withSpinner from '../../util/with-spinner';

type Options = {
  '--debug': boolean;
  '--code': string;
};

export default async function transferIn(
  ctx: NowContext,
  opts: Options,
  args: string[],
  output: Output
) {
  const { authConfig: { token }, config } = ctx;
  const { currentTeam } = config;
  const { apiUrl } = ctx;
  const debug = opts['--debug'];
  const client = new Client({ apiUrl, token, currentTeam, debug });
  let contextName = null;

  try {
    ({ contextName } = await getScope(client));
  } catch (err) {
    if (err.code === 'not_authorized') {
      output.error(err.message);
      return 1;
    }

    throw err;
  }

  const [domainName] = args;
  if (!domainName) {
    output.error(`Missing domain name. Run ${cmd('now domains --help')}`);
    return 1;
  }

  const { domain: rootDomain, subdomain } = psl.parse(domainName);
  if (subdomain || !rootDomain) {
    output.error(
      `Invalid domain name "${domainName}". Run ${cmd('now domains --help')}`
    );
    return 1;
  }

  const authCode = await getAuthCode(opts['--code']);

  const transferStamp = stamp();
  const transferInResult = await withSpinner('Initiating transfer', () =>
    transferInDomain(client, domainName, authCode)
  );

  if (transferInResult instanceof ERRORS.InvalidDomain) {
    output.error(`The domain ${transferInResult.meta.domain} is not valid.`);
    return 1;
  }

  if (
    transferInResult instanceof ERRORS.DomainNotAvailable ||
    transferInResult instanceof ERRORS.DomainNotTransferable
  ) {
    output.error(
      `The domain "${transferInResult.meta.domain}" is not transferable.`
    );
    return 1;
  }

  console.log(
    `${chalk.cyan('> Success!')} Domain ${param(
      domainName
    )} transfer started ${transferStamp()}`
  );

  output.print(`We have initiated a transfer for ${domainName}.\n`);
  output.print(
    `To finalize the transfer, we are waiting for approval from your current registrar.\n`
  );
  output.print(`You will receive an email upon completion.`);
  return 0;
}
