import type {
  ApiInitialArgs,
  ApiOnProgress,
  OnApiUpdate,
} from '../../types';
import type { LocalDb } from '../localDb';
import type { MethodArgs, MethodResponse, Methods } from './types';

import Deferred from '../../../util/Deferred';
import { updateFullLocalDb } from '../localDb';
import { init as initUpdateEmitter } from '../updates/apiUpdateEmitter';
import { init as initClient } from './client';
import * as methods from './index';

export function initApi(_onUpdate: OnApiUpdate, initialArgs: ApiInitialArgs, initialLocalDb?: LocalDb) {
  initUpdateEmitter(_onUpdate);

  if (initialLocalDb) updateFullLocalDb(initialLocalDb);
return Promise.resolve();
}

export function callApi<T extends keyof Methods>(fnName: T, ...args: MethodArgs<T>): MethodResponse<T> {
  const method = methods[fnName] as ((...args: MethodArgs<T>) => MethodResponse<T>) | undefined;

  if (method) {
    return method(...args);
  }

  switch (String(fnName)) {
    case 'loadAllChats':
    case 'loadConfig':
    case 'loadAppConfig':
    case 'loadContactList':
      return true as MethodResponse<T>;

    default:
      console.warn('Worker method missing:', fnName);
      return undefined as MethodResponse<T>;
  }
}

export function cancelApiProgress(progressCallback: ApiOnProgress) {
  progressCallback.isCanceled = true;
}
