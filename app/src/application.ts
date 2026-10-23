import { getApiBaseUrl } from './config';
import { createHealthClient } from './features/health/index';
import { uniTransport } from './platform/uni-request';
import { createHttpClient } from './shared/http';

const request = createHttpClient({ baseUrl: getApiBaseUrl(), transport: uniTransport });
export const health = createHealthClient(request);
