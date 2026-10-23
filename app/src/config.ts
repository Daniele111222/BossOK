export function getApiBaseUrl(): string {
  let baseUrl = import.meta.env.VITE_API_BASE_URL;
  // #ifdef H5
  baseUrl ||= '/api';
  // #endif
  return baseUrl ?? '';
}
