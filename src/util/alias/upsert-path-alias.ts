import { Output } from '../output';
import { PathRule } from '../../types';
import * as ERRORS from '../errors-ts';
import Client from '../client';
import createCertForAlias from '../certs/create-cert-for-alias';
import setupDomain from '../domains/setup-domain';
import wait from '../output/wait';

const NOW_SH_REGEX = /\.now\.sh$/;

type AliasRecord = {
  uid: string;
  alias: string;
  created?: string;
  oldDeploymentId?: string;
};

export default async function upsertPathAlias(
  output: Output,
  client: Client,
  rules: PathRule[],
  alias: string,
  contextName: string
) {
  let externalDomain = false;

  if (!NOW_SH_REGEX.test(alias)) {
    const domainInfo = await setupDomain(output, client, alias, contextName);
    if (
      domainInfo instanceof ERRORS.CDNNeedsUpgrade ||
      domainInfo instanceof ERRORS.DomainAlreadyExists ||
      domainInfo instanceof ERRORS.DomainNotAvailable ||
      domainInfo instanceof ERRORS.DomainNotFound ||
      domainInfo instanceof ERRORS.DomainPermissionDenied ||
      domainInfo instanceof ERRORS.DomainPurchasePending ||
      domainInfo instanceof ERRORS.DomainServiceNotAvailable ||
      domainInfo instanceof ERRORS.DomainVerificationFailed ||
      domainInfo instanceof ERRORS.InvalidDomain ||
      domainInfo instanceof ERRORS.SourceNotFound ||
      domainInfo instanceof ERRORS.UnexpectedDomainPurchaseError ||
      domainInfo instanceof ERRORS.UnsupportedTLD ||
      domainInfo instanceof ERRORS.UserAborted
    ) {
      return domainInfo;
    }

    externalDomain = domainInfo.serviceType === 'external';
  }

  const result = await performUpsertPathAlias(
    client,
    alias,
    rules,
    contextName
  );
  if (result instanceof ERRORS.CertMissing) {
    const cert = await createCertForAlias(
      output,
      client,
      contextName,
      alias,
      !externalDomain
    );
    if (
      cert instanceof ERRORS.CantSolveChallenge ||
      cert instanceof ERRORS.DomainConfigurationError ||
      cert instanceof ERRORS.DomainPermissionDenied ||
      cert instanceof ERRORS.DomainsShouldShareRoot ||
      cert instanceof ERRORS.DomainValidationRunning ||
      cert instanceof ERRORS.TooManyCertificates ||
      cert instanceof ERRORS.TooManyRequests
    ) {
      return cert;
    }

    return performUpsertPathAlias(client, alias, rules, contextName);
  }

  return result;
}

async function performUpsertPathAlias(
  client: Client,
  alias: string,
  rules: PathRule[],
  contextName: string
) {
  const cancelMessage = wait(`Updating path alias rules for ${alias}`);
  try {
    const record = await client.fetch<AliasRecord>(`/now/aliases`, {
      body: { alias, rules },
      method: 'POST'
    });
    cancelMessage();
    return record;
  } catch (error) {
    cancelMessage();
    if (error.code === 'cert_missing' || error.code === 'cert_expired') {
      return new ERRORS.CertMissing(alias);
    }
    if (error.status === 409) {
      return { uid: error.uid, alias: error.alias } as AliasRecord;
    }
    if (error.code === 'rule_validation_failed') {
      return new ERRORS.RuleValidationFailed(error.serverMessage);
    }
    if (error.code === 'invalid_alias') {
      return new ERRORS.InvalidAlias(alias);
    }
    if (error.status === 403) {
      if (error.code === 'alias_in_use') {
        console.log(error);
        return new ERRORS.AliasInUse(alias);
      }
      if (error.code === 'forbidden') {
        return new ERRORS.DomainPermissionDenied(alias, contextName);
      }
    }
    throw error;
  }
}
